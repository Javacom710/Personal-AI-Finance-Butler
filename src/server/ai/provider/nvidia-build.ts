import 'server-only';

/**
 * NVIDIA Build — the only NVIDIA-aware file in the codebase
 * ([ADR-09](../../../../docs/DECISIONS.md#adr-09--nvidia-build-as-the-model-provider-behind-a-provider-abstraction)).
 *
 * Everything NVIDIA-specific lives here and nowhere else: the OpenAI-compatible
 * wire shapes, `Authorization: Bearer nvapi-…`, `/chat/completions`, `/models`,
 * and NVIDIA's error bodies. Replacing the provider is editing this file and one
 * line of configuration — which is the claim the abstraction exists to keep true,
 * so it is asserted by a source scan rather than left as an intention.
 *
 * ## Two decisions worth stating
 *
 * **`fetch`, not the `openai` client** ([ADR-40](../../../../docs/DECISIONS.md#adr-40--the-nvidia-adapter-is-written-over-fetch-the-openai-client-is-deferred-to-the-phase-that-needs-streaming)).
 * `AI-SYSTEM.md` §2.2 chose the `openai` npm client, for two stated reasons: SSE
 * parsing and retries. Phase 7 needs neither — there is no streaming UI until
 * Phase 9, and retry policy is the orchestrator's, deliberately, so that two
 * providers cannot grow two policies. What remains is a dependency carried for a
 * caller that does not exist. The repository already has a proven injected-`fetch`
 * adapter pattern in `market-data/http.ts`, and this file follows it. The ESLint
 * ban on importing `openai` outside this file stays exactly as it is, so adopting
 * the client when streaming lands is a contained change *here*.
 *
 * **The credential is injected, never read.** `src/server/ai/**` cannot import
 * `@/lib/env` at all (ADR-38). `src/server/ai-runtime.ts` reads the key once and
 * passes it in, so this file holds a configured client rather than a credential
 * it could put in a prompt. The key is never logged, never echoed in an error,
 * and never returned in a result.
 */

import { err, ok, type Result } from '../../../lib/result';
import {
  malformedResponse,
  notConfigured,
  rateLimited,
  timeout as timeoutFailure,
  transport,
  unauthorized,
  type AiFailure,
} from '../errors';
import type {
  AiProvider,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  FinishReason,
  ProviderModel,
  ToolCall,
} from './types';

export const NVIDIA_BUILD_KEY = 'nvidia-build';

/** Injected so tests replay fixtures and no test touches the network. */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<Response>;

export interface NvidiaProviderConfig {
  /** Absent means unconfigured — a typed failure, never a fabricated result. */
  readonly apiKey: string | undefined;
  readonly baseUrl: string;
  readonly fetch: FetchLike;
  readonly defaultTimeoutMs: number;
}

// ---------------------------------------------------------------- wire shapes
// The OpenAI-compatible request and response, named so a reader can match them
// against NVIDIA's documentation. Nothing outside this file may reference them.

interface WireToolCall {
  id?: unknown;
  function?: { name?: unknown; arguments?: unknown };
}

interface WireChoice {
  message?: {
    content?: unknown;
    reasoning_content?: unknown;
    tool_calls?: unknown;
  };
  finish_reason?: unknown;
}

interface WireChatResponse {
  choices?: unknown;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  model?: unknown;
}

function toWireMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return { role: 'tool', content: message.content, tool_call_id: message.toolCallId };
  }
  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant',
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.argumentsJson },
      })),
    };
  }
  return { role: message.role, content: message.content };
}

function readToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return [];
  const calls: ToolCall[] = [];
  for (const entry of raw as WireToolCall[]) {
    const name = entry?.function?.name;
    if (typeof name !== 'string') continue;
    const args = entry?.function?.arguments;
    calls.push({
      id: typeof entry.id === 'string' ? entry.id : name,
      name,
      // Kept as the model emitted it. Parsing is validation, and validation
      // belongs to the tool layer against that tool's own schema.
      argumentsJson: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
    });
  }
  return calls;
}

const FINISH_REASONS: ReadonlySet<string> = new Set([
  'stop',
  'length',
  'tool_calls',
  'content_filter',
  'error',
]);

function readFinishReason(raw: unknown, hasToolCalls: boolean): FinishReason {
  if (typeof raw === 'string' && FINISH_REASONS.has(raw)) return raw as FinishReason;
  // Some models omit it when they emit tool calls; infer rather than mislabel.
  return hasToolCalls ? 'tool_calls' : 'stop';
}

function readTokens(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

/** Construct the provider. Absent key is legal; it surfaces at call time. */
export function createNvidiaProvider(config: NvidiaProviderConfig): AiProvider {
  const endpoint = (path: string) => `${config.baseUrl.replace(/\/+$/, '')}${path}`;

  const isConfigured = () => typeof config.apiKey === 'string' && config.apiKey.length > 0;

  async function send(
    path: string,
    init: { method: string; body?: unknown; timeoutMs: number; signal?: AbortSignal },
  ): Promise<Result<unknown, AiFailure>> {
    if (!isConfigured()) return err(notConfigured());

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeoutMs);
    const onAbort = () => controller.abort();
    init.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const response = await config.fetch(endpoint(path), {
        method: init.method,
        headers: {
          // The one place this header is ever constructed.
          Authorization: `Bearer ${config.apiKey ?? ''}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: controller.signal,
      });

      if (response.status === 401 || response.status === 403) {
        // Deliberately does not echo the body: a provider that reflects the
        // credential in its error message would put it in our logs.
        return err(unauthorized(response.status));
      }
      if (response.status === 429) {
        return err(rateLimited(retryAfterMs(response)));
      }
      if (!response.ok) {
        return err(transport(`HTTP ${response.status}`, response.status));
      }

      const text = await response.text();
      try {
        return ok(JSON.parse(text) as unknown);
      } catch {
        return err(malformedResponse('the provider returned a body that is not JSON'));
      }
    } catch (error) {
      if (isAbort(error)) return err(timeoutFailure(init.timeoutMs));
      return err(transport(error instanceof Error ? error.message : String(error)));
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', onAbort);
    }
  }

  return {
    key: NVIDIA_BUILD_KEY,
    isConfigured,

    async chat(request: ChatRequest): Promise<Result<ChatResponse, AiFailure>> {
      const startedAt = Date.now();

      const body: Record<string, unknown> = {
        model: request.model,
        messages: request.messages.map(toWireMessage),
        max_tokens: request.maxTokens,
      };
      if (request.temperature !== undefined) body['temperature'] = request.temperature;
      if (request.tools?.length) {
        body['tools'] = request.tools.map((tool) => ({
          type: 'function',
          function: { name: tool.name, description: tool.description, parameters: tool.parameters },
        }));
        if (request.toolChoice) body['tool_choice'] = request.toolChoice;
      }
      if (request.responseFormat) {
        body['response_format'] =
          request.responseFormat.type === 'json_schema'
            ? {
                type: 'json_schema',
                json_schema: {
                  name: request.responseFormat.name,
                  schema: request.responseFormat.schema,
                  strict: true,
                },
              }
            : { type: request.responseFormat.type };
      }

      const sent = await send('/chat/completions', {
        method: 'POST',
        body,
        timeoutMs: request.timeoutMs || config.defaultTimeoutMs,
        ...(request.signal ? { signal: request.signal } : {}),
      });
      if (!sent.ok) return sent;

      const payload = sent.value as WireChatResponse;
      const choices = Array.isArray(payload.choices) ? (payload.choices as WireChoice[]) : [];
      const choice = choices[0];
      if (!choice) {
        return err(malformedResponse('the provider returned no choices'));
      }

      const toolCalls = readToolCalls(choice.message?.tool_calls);
      const content = choice.message?.content;
      const reasoning = choice.message?.reasoning_content;

      return ok({
        content: typeof content === 'string' ? content : null,
        toolCalls,
        reasoning: typeof reasoning === 'string' ? reasoning : null,
        finishReason: readFinishReason(choice.finish_reason, toolCalls.length > 0),
        usage: {
          promptTokens: readTokens(payload.usage?.prompt_tokens),
          completionTokens: readTokens(payload.usage?.completion_tokens),
        },
        // What actually served the request, which can differ from what was asked.
        model: typeof payload.model === 'string' ? payload.model : request.model,
        latencyMs: Date.now() - startedAt,
      });
    },

    async listModels(): Promise<Result<readonly ProviderModel[], AiFailure>> {
      const sent = await send('/models', { method: 'GET', timeoutMs: config.defaultTimeoutMs });
      if (!sent.ok) return sent;

      const data = (sent.value as { data?: unknown }).data;
      if (!Array.isArray(data)) {
        return err(malformedResponse('the catalogue response had no data array'));
      }
      const models: ProviderModel[] = [];
      for (const entry of data as { id?: unknown; owned_by?: unknown; created?: unknown }[]) {
        if (typeof entry?.id !== 'string') continue;
        models.push({
          id: entry.id,
          ownedBy: typeof entry.owned_by === 'string' ? entry.owned_by : null,
          created: typeof entry.created === 'number' ? entry.created : null,
        });
      }
      return ok(models);
    },
  };
}

function retryAfterMs(response: Response): number | null {
  const header = response.headers?.get?.('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : null;
}

function isAbort(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}
