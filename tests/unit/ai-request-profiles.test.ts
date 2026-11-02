import { describe, expect, it, vi } from 'vitest';
import { ok, err } from '@/lib/result';
import { DEFAULT_REQUEST_PROFILE as DEFAULT, THINKING_DISABLED_PROFILE as DISABLED, matchesRequestProfile, requestProfileIdentity, resolveRequestProfiles } from '@/server/ai/config/request-profiles';
import { resolveModelConfig } from '@/server/ai/config/models';
import { createCapabilityMatrix, DECLARED_CAPABILITIES, type ModelCapabilities } from '@/server/ai/config/capabilities';
import { createNvidiaProvider, type FetchLike } from '@/server/ai/provider/nvidia-build';
import { capabilitiesFromEvaluations as convertEvaluations, type StoredEvaluation } from '@/server/ai-evaluations';
import { MODEL_SUITES, TIER_SUITES, parseEvalArgs, runEvaluation } from '@/server/ai/eval/runner';
import { createOrchestrator } from '@/server/ai/orchestrator';
import { selectCandidates } from '@/server/ai/orchestrator/select';
import { requirementFor } from '@/server/ai/orchestrator/requirements';
import { createHealthRegistry } from '@/server/ai/orchestrator/breaker';
import { rateLimited } from '@/server/ai/errors';
import { meterProvider } from '@/server/ai-runtime';
import type { AiProvider } from '@/server/ai/provider/types';

const PROVIDER = 'https://api.groq.com/openai/v1';
const capabilitiesFromEvaluations = (...args: Parameters<typeof convertEvaluations>) =>
  convertEvaluations(args[0], args[1], args[2], PROVIDER);

const MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b';
const profiles = resolveRequestProfiles(JSON.stringify({ [MODEL]: DISABLED.id }));
const NOW = new Date('2026-11-02T07:00:00Z');
const BASE: ModelCapabilities = { ...DECLARED_CAPABILITIES['nvidia/nemotron-3-nano-30b-a3b']! };
const request = { model: MODEL, messages: [{ role: 'user' as const, content: 'Hello' }], maxTokens: 1024, timeoutMs: 1000 };
const response = { content: '{}', toolCalls: [], reasoning: null, finishReason: 'stop' as const, model: MODEL, latencyMs: 7, usage: { promptTokens: 1, completionTokens: 1 } };

function rows(identity = requestProfileIdentity(DISABLED)): StoredEvaluation[] {
  return TIER_SUITES[1].map(suite => {
    const total = MODEL_SUITES[suite].build().length;
    const schema = suite === 'parse' || suite === 'classify';
    const tools = suite === 'tool-select' || suite === 'injection';
    return {
      model: MODEL, suite, evalVersion: MODEL_SUITES[suite].version, casesPassed: total,
      p50LatencyMs: 7, p95LatencyMs: 9, runAt: NOW,
      detail: { providerIdentity: PROVIDER, requestProfile: identity, answered: total, unanswered: 0, schemaValid: schema ? total : 0,
        schemaApplicable: schema ? total : 0, toolCallValid: tools ? total : 0, toolCallApplicable: tools ? total : 0, failedCases: [], errors: {} },
    };
  });
}

describe('application request-profile configuration', () => {
  it('keeps the default for every unconfigured model and freezes profile controls', () => {
    expect(resolveRequestProfiles().forModel(MODEL)).toBe(DEFAULT);
    expect(profiles.forModel('another/model')).toBe(DEFAULT);
    expect(profiles.forModel(MODEL)).toBe(DISABLED);
    expect(Object.isFrozen(DISABLED)).toBe(true);
    expect(DISABLED.fingerprint).toBe(JSON.stringify({ id: DISABLED.id, reasoning: 'disabled' }));
  });

  it.each(['[]', 'null', 'false', '{', '{"x":"unknown"}', '{"x":"lightning-thinking-disabled-v1"}', '{"x":{"enable_thinking":false}}', '{" x":"default-v1"}'])('rejects unsupported configuration before requests: %s', raw => {
    expect(() => resolveRequestProfiles(raw)).toThrow();
  });

  it('treats missing legacy provenance as default only, and rejects malformed identities', () => {
    expect(matchesRequestProfile(undefined, DEFAULT)).toBe(true);
    expect(matchesRequestProfile(undefined, DISABLED)).toBe(false);
    for (const bad of [null, {}, { id: DEFAULT.id }, { id: DEFAULT.id, fingerprint: 'forged' }]) {
      expect(matchesRequestProfile(bad, DEFAULT)).toBe(false);
    }
  });
});

describe('the production adapter and evaluator share profile provenance', () => {
  it('changes only the documented wire field and preserves the default body exactly', async () => {
    const bodies: unknown[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      bodies.push(JSON.parse(init.body!));
      return new Response(JSON.stringify({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }));
    };
    const make = (enabled: boolean) => createNvidiaProvider({ apiKey: 'test', baseUrl: 'https://example.invalid/v1', fetch: fetchImpl, defaultTimeoutMs: 1000, ...(enabled ? { requestProfiles: profiles } : {}) });
    const standard = make(false);
    const configured = make(true);
    await standard.chat(request);
    await configured.chat(request);
    expect(bodies[0]).toEqual({ model: MODEL, messages: request.messages, max_tokens: 1024 });
    expect(bodies[1]).toEqual({ ...(bodies[0] as object), chat_template_kwargs: { enable_thinking: false } });
    expect(standard.requestProfileFor?.(MODEL)).toEqual(requestProfileIdentity(DEFAULT));
    expect(configured.requestProfileFor?.(MODEL)).toEqual(requestProfileIdentity(DISABLED));
    expect(meterProvider(configured).requestProfileFor?.(MODEL)).toEqual(requestProfileIdentity(DISABLED));
  });

  it('records the profile from the actual adapter, with no separate evaluation override', async () => {
    const provider: AiProvider = { key: 'fake', isConfigured: () => true, listModels: async () => ok([]), chat: async () => ok(response), requestProfileFor: () => requestProfileIdentity(DISABLED) };
    const run = await runEvaluation({ provider, args: { tier: 1, suites: ['parse'], models: [MODEL], limit: 1, record: false }, models: [MODEL] });
    expect(run.models[0]!.requestProfile).toEqual(requestProfileIdentity(DISABLED));
    expect(run.proposedOrder).toEqual([]);
    provider.requestProfileFor = () => ({ id: DISABLED.id, fingerprint: 'forged' });
    provider.chat = vi.fn();
    await expect(runEvaluation({ provider, args: { tier: 1, suites: ['parse'], models: [], limit: 1, record: false }, models: [MODEL] })).rejects.toThrow(/provenance/);
    expect(provider.chat).not.toHaveBeenCalled();
  });
});

describe('measurement profile matching', () => {
  it('loads only complete measurements of the active profile', () => {
    const declared = { [MODEL]: BASE };
    expect(capabilitiesFromEvaluations(rows(), declared)).toEqual({});
    expect(capabilitiesFromEvaluations(rows(), declared, profiles)[MODEL]).toMatchObject({ source: 'measured', requestProfile: requestProfileIdentity(DISABLED), scores: { schemaAdherence: 1, toolCallCorrectness: 1 } });
    expect(capabilitiesFromEvaluations(rows().slice(1), declared, profiles)).toEqual({});
  });

  it('allows legacy rows only for default and refuses to mix profiles between suites', () => {
    const declared = { [MODEL]: BASE };
    const legacy = rows().map(r => ({ ...r, detail: { ...r.detail, requestProfile: undefined } }));
    expect(capabilitiesFromEvaluations(legacy, declared)[MODEL]?.source).toBe('measured');
    expect(capabilitiesFromEvaluations(legacy, declared, profiles)).toEqual({});
    const mixed = rows().map((r, i) => i === 0 ? { ...r, detail: { ...r.detail, requestProfile: requestProfileIdentity(DEFAULT) } } : r);
    expect(capabilitiesFromEvaluations(mixed, declared, profiles)).toEqual({});
    expect(capabilitiesFromEvaluations(mixed, declared)).toEqual({});
  });

  it('keeps profile histories separate and rejects an obsolete latest row of the active profile', () => {
    const declared = { [MODEL]: BASE };
    const newerDefault = rows(requestProfileIdentity(DEFAULT)).map(r => ({ ...r, runAt: new Date(NOW.getTime() + 1000) }));
    expect(capabilitiesFromEvaluations([...newerDefault, ...rows()], declared, profiles)[MODEL]?.source).toBe('measured');
    const obsolete = { ...rows()[0]!, evalVersion: 1, runAt: new Date(NOW.getTime() + 1000) };
    expect(capabilitiesFromEvaluations([obsolete, ...rows()], declared, profiles)).toEqual({});
    const bad = rows().map(r => ({ ...r, detail: { ...r.detail, requestProfile: { id: DISABLED.id, fingerprint: 'wrong' } } }));
    expect(capabilitiesFromEvaluations(bad, declared, profiles)).toEqual({});
  });

  it('selection and the orchestrator fail closed when a matrix or adapter uses a different profile', async () => {
    const entry = capabilitiesFromEvaluations(rows(), { [MODEL]: BASE }, profiles)[MODEL]!;
    const config = resolveModelConfig({ tier1: MODEL, requestProfiles: JSON.stringify({ [MODEL]: DISABLED.id }) });
    const defaultMatrix = createCapabilityMatrix({ [MODEL]: { ...entry, requestProfile: requestProfileIdentity(DEFAULT) } });
    const selected = selectCandidates(requirementFor('parseTransaction'), config, defaultMatrix, createHealthRegistry(), NOW);
    expect(selected.excluded).toEqual([{ modelId: MODEL, reason: 'request_profile_mismatch' }]);
    const chat = vi.fn(async () => ok(response));
    const orchestrator = createOrchestrator({ config, matrix: createCapabilityMatrix({ [MODEL]: entry }), provider: { key: 'fake', isConfigured: () => true, listModels: async () => ok([]), chat }, health: createHealthRegistry(), now: () => NOW, defaultTimeoutMs: 1000 });
    const result = await orchestrator.run({ capability: 'parseTransaction', messages: [], schema: { name: 'test', schema: {} } });
    expect(result.ok).toBe(false);
    expect(chat).not.toHaveBeenCalled();
    const matching = createOrchestrator({ config, matrix: createCapabilityMatrix({ [MODEL]: entry }), provider: { key: 'fake', isConfigured: () => true, listModels: async () => ok([]), chat, requestProfileFor: () => requestProfileIdentity(DISABLED) }, health: createHealthRegistry(), now: () => NOW, defaultTimeoutMs: 1000 });
    expect((await matching.run({ capability: 'parseTransaction', messages: [], schema: { name: 'test', schema: {} } })).ok).toBe(true);
    expect(chat).toHaveBeenCalledOnce();
  });
});

describe('paced evaluation scheduling', () => {
  it('validates CLI pacing and defaults to two seconds', () => {
    expect(parseEvalArgs(['--tier', '1'])).toMatchObject({ ok: true, value: { intervalMs: 2000 } });
    for (const interval of ['-1', 'NaN', '1.5', '60001']) expect(parseEvalArgs(['--tier', '1', '--interval-ms', interval]).ok).toBe(false);
  });

  it('paces requests across cases and honors Retry-After without replaying a failed case', async () => {
    vi.useFakeTimers();
    try {
      const starts: number[] = [];
      const provider: AiProvider = { key: 'fake', isConfigured: () => true, listModels: async () => ok([]), chat: async () => {
        starts.push(Date.now());
        return starts.length === 1 ? err(rateLimited(3000)) : ok(response);
      } };
      const pending = runEvaluation({ provider, args: { tier: 1, suites: ['classify'], models: [], limit: 3, record: false, intervalMs: 2000 }, models: ['fake'] });
      await vi.runAllTimersAsync();
      const run = await pending;
      expect(starts).toHaveLength(3);
      expect(starts[1]! - starts[0]!).toBe(3000);
      expect(starts[2]! - starts[1]!).toBe(2000);
      expect(run.models[0]!.unanswered).toBe(1);
      expect(run.models[0]!.p50LatencyMs).toBe(7);
    } finally { vi.useRealTimers(); }
  });
});
