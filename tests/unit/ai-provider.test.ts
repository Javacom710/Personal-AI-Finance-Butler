import { describe, expect, it } from 'vitest';

import { createNvidiaProvider, type FetchLike } from '@/server/ai/provider/nvidia-build';
import { dispositionOf } from '@/server/ai/errors';

/**
 * Invariant **I-55** â€” *the provider adapter reports; it never throws, and never
 * decides* ([ADR-09](../../docs/DECISIONS.md#adr-09--nvidia-build-as-the-model-provider-behind-a-provider-abstraction),
 * [ADR-40](../../docs/DECISIONS.md#adr-40--the-nvidia-adapter-is-written-over-fetch-the-openai-client-is-deferred-to-the-phase-that-needs-streaming)).
 *
 * The same rule ADR-27 imposed on market-data adapters: every failure mode
 * returns a classified `Result`, because a thrown error cannot distinguish
 * *"this model cannot do that"* from *"the network was down"*, and those demand
 * opposite responses.
 *
 * `fetch` is injected, so nothing here touches the network â€” the technique the
 * market-data adapter tests already use.
 */

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const TEST_KEY = 'nvapi-test-key';

/**
 * The configured case. The *unconfigured* case builds its provider inline
 * instead, because this default parameter substitutes the key for an explicit
 * `undefined` - written that way the test asserted nothing, which is how the
 * mistake was caught.
 */
function provider(fetchImpl: FetchLike, apiKey: string | undefined = TEST_KEY) {
  return createNvidiaProvider({
    apiKey,
    baseUrl: 'https://example.invalid/v1',
    fetch: fetchImpl,
    defaultTimeoutMs: 5_000,
  });
}

const CHAT_OK = {
  model: 'nvidia/nemotron-3-nano-30b-a3b',
  choices: [{ message: { content: 'Hello.' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 11, completion_tokens: 3 },
};

const request = {
  model: 'nvidia/nemotron-3-nano-30b-a3b',
  messages: [{ role: 'user' as const, content: 'hi' }],
  maxTokens: 64,
  timeoutMs: 5_000,
};

describe('I-55 â€” configuration', () => {
  it('is unconfigured without a key, and says so rather than calling out', async () => {
    let called = false;
    const p = createNvidiaProvider({
      apiKey: undefined,
      baseUrl: 'https://example.invalid/v1',
      fetch: async () => {
        called = true;
        return json(CHAT_OK);
      },
      defaultTimeoutMs: 5_000,
    });

    expect(p.isConfigured()).toBe(false);
    const result = await p.chat(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('not_configured');
    // The point: zero egress. An unconfigured provider must not reach the wire.
    expect(called).toBe(false);
  });

  it('sends the credential as a bearer token, and only in the header', async () => {
    let seen: { headers: Record<string, string>; body?: string } | null = null;
    const p = provider(async (_url, init) => {
      seen = { headers: init.headers, ...(init.body ? { body: init.body } : {}) };
      return json(CHAT_OK);
    });

    await p.chat(request);
    expect(seen!.headers['Authorization']).toBe('Bearer nvapi-test-key');
    // Never in the body â€” a request that echoed it would put it wherever the
    // body is logged.
    expect(seen!.body ?? '').not.toContain('nvapi-test-key');
  });
});

describe('I-55 â€” response normalisation', () => {
  it('normalises a plain completion', async () => {
    const p = provider(async () => json(CHAT_OK));
    const result = await p.chat(request);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toBe('Hello.');
    expect(result.value.finishReason).toBe('stop');
    expect(result.value.usage).toEqual({ promptTokens: 11, completionTokens: 3 });
    expect(result.value.model).toBe('nvidia/nemotron-3-nano-30b-a3b');
    expect(result.value.toolCalls).toEqual([]);
  });

  it('keeps tool-call arguments as the raw string the model emitted', async () => {
    const p = provider(async () =>
      json({
        ...CHAT_OK,
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: 'call_1', function: { name: 'get_accounts', arguments: '{"asOf":"2026-08-30"}' } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }),
    );

    const result = await p.chat(request);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Unparsed on purpose: parsing is validation, and validation belongs to the
    // tool layer against that tool's own schema.
    expect(result.value.toolCalls[0]).toEqual({
      id: 'call_1',
      name: 'get_accounts',
      argumentsJson: '{"asOf":"2026-08-30"}',
    });
    expect(result.value.finishReason).toBe('tool_calls');
  });

  it('infers tool_calls when the provider omits the finish reason', async () => {
    const p = provider(async () =>
      json({
        ...CHAT_OK,
        choices: [
          { message: { tool_calls: [{ id: 'c', function: { name: 'get_accounts', arguments: '{}' } }] } },
        ],
      }),
    );
    const result = await p.chat(request);
    if (!result.ok) throw new Error('expected success');
    expect(result.value.finishReason).toBe('tool_calls');
  });

  it('surfaces a content filter as a finish reason, not an error', async () => {
    const p = provider(async () =>
      json({ ...CHAT_OK, choices: [{ message: { content: null }, finish_reason: 'content_filter' }] }),
    );
    const result = await p.chat(request);
    if (!result.ok) throw new Error('expected success');
    // The model answered; its answer was a refusal. Retrying elsewhere would be
    // shopping for a model that complies, not fallback.
    expect(result.value.finishReason).toBe('content_filter');
  });
});

describe('I-55 â€” every failure is classified, never thrown', () => {
  const cases: { name: string; response: () => Promise<Response>; kind: string }[] = [
    { name: '401', response: async () => json({ error: 'nope' }, 401), kind: 'unauthorized' },
    { name: '403', response: async () => json({}, 403), kind: 'unauthorized' },
    { name: '429', response: async () => json({}, 429, { 'retry-after': '30' }), kind: 'rate_limited' },
    { name: '500', response: async () => json({}, 500), kind: 'transport' },
    { name: '503', response: async () => json({}, 503), kind: 'transport' },
  ];

  it.each(cases)('classifies $name as $kind', async ({ response, kind }) => {
    const p = provider(response);
    const result = await p.chat(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe(kind);
  });

  it('reads Retry-After off a 429', async () => {
    const p = provider(async () => json({}, 429, { 'retry-after': '30' }));
    const result = await p.chat(request);
    if (result.ok) throw new Error('expected failure');
    if (result.error.kind !== 'rate_limited') throw new Error('wrong kind');
    expect(result.error.retryAfterMs).toBe(30_000);
  });

  it('never echoes the credential in an auth error', async () => {
    const p = provider(async () => json({ error: 'invalid key nvapi-test-key' }, 401));
    const result = await p.chat(request);
    if (result.ok) throw new Error('expected failure');
    // A provider that reflects the key in its error body would otherwise put it
    // in our logs the moment the failure is recorded.
    expect(JSON.stringify(result.error)).not.toContain('nvapi-test-key');
  });

  it('turns a socket error into a transport failure', async () => {
    const p = provider(async () => {
      throw new Error('ECONNREFUSED');
    });
    const result = await p.chat(request);
    if (result.ok) throw new Error('expected failure');
    expect(result.error.kind).toBe('transport');
  });

  it('turns an abort into a timeout', async () => {
    const p = provider(async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    });
    const result = await p.chat(request);
    if (result.ok) throw new Error('expected failure');
    expect(result.error.kind).toBe('timeout');
  });

  it('rejects a non-JSON body rather than guessing', async () => {
    const p = provider(async () => new Response('<html>502</html>', { status: 200 }));
    const result = await p.chat(request);
    if (result.ok) throw new Error('expected failure');
    expect(result.error.kind).toBe('malformed_response');
  });

  it('rejects a response with no choices', async () => {
    const p = provider(async () => json({ choices: [] }));
    const result = await p.chat(request);
    if (result.ok) throw new Error('expected failure');
    expect(result.error.kind).toBe('malformed_response');
  });
});

describe('I-55 â€” dispositions drive fallback, not messages', () => {
  it('classifies terminal failures as fail_closed', () => {
    for (const kind of ['not_configured', 'unauthorized', 'no_capable_model', 'refused'] as const) {
      expect(dispositionOf({ kind, message: '' } as never)).toBe('fail_closed');
    }
  });

  it('classifies recoverable failures as worth another candidate', () => {
    expect(dispositionOf({ kind: 'transport', message: '', status: null })).toBe('next_candidate');
    expect(dispositionOf({ kind: 'timeout', message: '', timeoutMs: 1 })).toBe('next_candidate');
    expect(dispositionOf({ kind: 'invalid_output', message: '', detail: '' })).toBe('next_candidate');
    expect(dispositionOf({ kind: 'rate_limited', message: '', retryAfterMs: null })).toBe('retry_after');
  });
});

describe('I-55 â€” catalogue', () => {
  it('normalises the model list', async () => {
    const p = provider(async () =>
      json({ data: [{ id: 'some/other-model', owned_by: 'z-ai', created: 1 }, { notAnId: true }] }),
    );
    const result = await p.listModels();
    if (!result.ok) throw new Error('expected success');
    // The malformed entry is dropped, not guessed at.
    expect(result.value).toEqual([{ id: 'some/other-model', ownedBy: 'z-ai', created: 1 }]);
  });
});


