import 'server-only';

/**
 * The provider abstraction ([ADR-09](../../../../docs/DECISIONS.md#adr-09--nvidia-build-as-the-model-provider-behind-a-provider-abstraction),
 * [AI-SYSTEM.md §2.1](../../../../docs/AI-SYSTEM.md)).
 *
 * The application talks to an `AiProvider`. Nothing above this file knows that
 * the provider is NVIDIA Build, that the wire format is OpenAI-compatible, or
 * that the credential is a bearer token — exactly as nothing above
 * `src/server/market-data/registry.ts` knows a price came from AMFI.
 *
 * **Every method returns a `Result`, never throws** — the same rule
 * [ADR-27](../../../../docs/DECISIONS.md#adr-27--market-data-adapters-return-observations-the-registry-classifies-freshness)
 * imposed on market-data adapters, and for the same reason: a thrown error
 * cannot distinguish *"this model cannot do that"* from *"the network was
 * down"*, and those demand opposite responses. The orchestrator switches on
 * {@link AiFailure}'s class to decide between them.
 *
 * **The adapter reports; it does not decide.** It classifies a transport
 * failure, but it never chooses a model, never falls back, never retries a
 * different candidate, and never repairs output. Those are the orchestrator's
 * job, in one place, so that two providers cannot develop two different
 * routing policies.
 */

import type { Result } from '../../../lib/result';
import type { AiFailure } from '../errors';

/** A conversation turn. `tool` carries a result back to the model. */
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
  /** Present on `assistant` turns that asked for tools. */
  readonly toolCalls?: readonly ToolCall[];
  /** Present on `tool` turns: which call this answers. */
  readonly toolCallId?: string;
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  /**
   * The raw argument JSON **as the model emitted it**, unparsed.
   *
   * Deliberately a string: parsing is validation, validation belongs to the
   * tool layer against that tool's schema, and a provider that pre-parsed would
   * be deciding that malformed arguments are the transport's problem. They are
   * not — they are a capability failure (AI-SYSTEM.md §7).
   */
  readonly argumentsJson: string;
}

/** A tool as the model sees it: a name, a description, and a JSON Schema. */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema;
}

/** JSON Schema, kept opaque here — the tool layer produces it from Zod (ADR-16). */
export type JsonSchema = Record<string, unknown>;

/**
 * How structured output is requested. Which of these a model actually honours
 * is measured, never assumed (AI-SYSTEM.md §5).
 */
export type ResponseFormat =
  | { readonly type: 'text' }
  | { readonly type: 'json_object' }
  | { readonly type: 'json_schema'; readonly name: string; readonly schema: JsonSchema };

export interface ChatRequest {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly tools?: readonly ToolDefinition[];
  readonly toolChoice?: 'auto' | 'none' | 'required';
  readonly responseFormat?: ResponseFormat;
  readonly maxTokens: number;
  readonly temperature?: number;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export type FinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';

export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
}

export interface ChatResponse {
  readonly content: string | null;
  readonly toolCalls: readonly ToolCall[];
  /** Reasoning models expose this separately; never treated as an answer. */
  readonly reasoning: string | null;
  readonly finishReason: FinishReason;
  readonly usage: TokenUsage;
  /** What actually served the request — may differ from what was asked for. */
  readonly model: string;
  readonly latencyMs: number;
}

/** One entry of the provider's catalogue, as the provider reports it. */
export interface ProviderModel {
  readonly id: string;
  readonly ownedBy: string | null;
  readonly created: number | null;
}

/**
 * The provider surface.
 *
 * Streaming and embeddings are deliberately **absent**. Streaming belongs to a
 * chat UI, which is Phase 9; embeddings are deferred entirely
 * ([ADR-19](../../../../docs/DECISIONS.md#adr-19--embeddings-deferred-full-text-search-first-pgvector-if-ever)).
 * Declaring methods that nothing calls would make the abstraction look finished
 * where it is only sketched, and would have to be implemented — badly, untested
 * — by the first adapter. They are added when a caller exists.
 */
export interface AiProvider {
  /** Stable identity for logs and observability. */
  readonly key: string;
  /** False when no credential is configured. A *predicate*, never a routing input. */
  isConfigured(): boolean;
  chat(request: ChatRequest): Promise<Result<ChatResponse, AiFailure>>;
  /** The provider's own catalogue. Used by `ai:catalogue` to verify identifiers. */
  listModels(): Promise<Result<readonly ProviderModel[], AiFailure>>;
}
