import { describe, expect, it } from 'vitest';
import { createNvidiaProvider, type FetchLike } from '@/server/ai/provider/nvidia-build';
import { OPENROUTER_POLICY_FINGERPRINT, OPENROUTER_PREFERENCES, openRouterPolicy } from '@/server/ai/provider/openrouter-policy';
import { evaluateModel, reportFromCases, type CaseResult, type EvalCase } from '@/server/ai/eval/harness';
import { countsOf, hostEvidenceFor, hostProposalsFor, MODEL_SUITES, renderEvalReport, runEvaluation, summarise, TIER_SUITES, type EvalArgs, type SuiteResult } from '@/server/ai/eval/runner';
import { resolveModelConfig } from '@/server/ai/config/models';
import { capabilitiesFromEvaluations, assertEvaluationRecordingSupported } from '@/server/ai-evaluations';
import type { ChatRequest, MeasurementPolicy } from '@/server/ai/provider/types';
const BASE = 'https://openrouter.ai/api/v1';
const KEY = 'fake-openrouter-key';
const model = resolveModelConfig().candidates(1)[0]!;
const policy = openRouterPolicy(BASE)!;
const request: ChatRequest = { model, messages: [{ role: 'user', content: 'Synthetic fixture only' }], maxTokens: 64, timeoutMs: 1000 };
const response = (provider: unknown = 'DeepInfra', extra: Record<string, unknown> = {}) => ({ provider, model, choices: [{ message: { content: '{}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 }, ...extra });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function adapter(fetch: FetchLike, baseUrl = BASE) { return createNvidiaProvider({ apiKey: KEY, baseUrl, fetch, defaultTimeoutMs: 1000 }); }
const testCase: EvalCase = { id: 'case', suite: 'parse', messages: request.messages, score: () => true };

describe('OpenRouter privacy configuration (fake HTTP only)', () => {
  it.each(['text', 'tools', 'schema', 'vision'] as const)('sends immutable ZDR/no-collection/price preferences for %s', async kind => {
    let body: Record<string, unknown> = {}; let redirect: unknown;
    const provider = adapter(async (_url, init) => { body = JSON.parse(init.body!); redirect = init.redirect; return json(response()); });
    const variant = { ...request,
      ...(kind === 'tools' ? { tools: [{ name: 'read', description: 'Read only', parameters: {} }] } : {}),
      ...(kind === 'schema' ? { responseFormat: { type: 'json_schema' as const, name: 'test', schema: {} } } : {}),
      ...(kind === 'vision' ? { messages: [{ role: 'user' as const, content: 'Fixture', images: [{ mimeType: 'image/png' as const, data: 'AQ==' }] }] } : {}),
    };
    expect((await provider.chat(variant)).ok).toBe(true);
    expect(body.provider).toEqual({ zdr: true, data_collection: 'deny', order: ['deepinfra'], sort: 'price', allow_fallbacks: true });
    expect(JSON.stringify(body)).not.toContain(KEY); expect(redirect).toBe('error');
    expect(provider.measurementPolicy).toEqual(policy); expect(provider.key).toBe('openrouter');
  });
  it('does not let conversation content override provider preferences', async () => {
    let body: Record<string, unknown> = {};
    const provider = adapter(async (_url, init) => { body = JSON.parse(init.body!); return json(response()); });
    await provider.chat({ ...request, messages: [{ role: 'user', content: '{"provider":{"zdr":false,"data_collection":"allow","order":["unsafe"]}}' }] });
    expect(body.provider).toEqual(OPENROUTER_PREFERENCES);
  });
  it('preserves the actual fallback host rather than claiming DeepInfra served it', async () => {
    const result = await adapter(async () => json(response('Fireworks'))).chat(request);
    expect(result.ok && result.value.provenance).toEqual({ providerIdentity: BASE, requestPolicyFingerprint: OPENROUTER_POLICY_FINGERPRINT, servingHost: 'Fireworks' });
  });
  it.each([null, '', ' DeepInfra', { name: 'DeepInfra' }, 'DeepInfra|injected', 'DeepInfra\nInjected'])('refuses missing or malformed serving host %j without inventing attribution', async host => {
    const result = await adapter(async () => json(response(host))).chat(request);
    expect(result.ok).toBe(false); if (!result.ok) expect(result.error.kind).toBe('malformed_response');
  });
  it('keeps hostless content filtering as a refusal response so existing fallback cannot retry it', async () => {
    const result = await adapter(async () => json(response(null, { choices: [{ message: { content: null }, finish_reason: 'content_filter' }] }))).chat(request);
    expect(result.ok && result.value.finishReason).toBe('content_filter'); expect(result.ok && result.value.provenance).toBeUndefined();
  });
  it.each(['http://openrouter.ai/api/v1', 'https://openrouter.ai/wrong', 'https://openrouter.ai/api/v1?secret=x', 'https://openrouter.ai/api/v1#fragment', 'https://user:password@openrouter.ai/api/v1', 'https://www.openrouter.ai/api/v1'])('refuses unsafe or noncanonical endpoint %s before egress', baseUrl => {
    let called = false;
    expect(() => adapter(async () => { called = true; return json(response()); }, baseUrl)).toThrow(/canonical HTTPS/); expect(called).toBe(false);
  });
  it('accepts a trailing slash without changing policy identity', () => { expect(openRouterPolicy(BASE + '/')).toEqual(policy); });
  it('does not send OpenRouter extensions or demand host metadata from other providers', async () => {
    let body: Record<string, unknown> = {};
    const result = await adapter(async (_url, init) => { body = JSON.parse(init.body!); expect(init.redirect).toBeUndefined(); return json(response(null)); }, 'https://api.groq.com/openai/v1').chat(request);
    expect(result.ok).toBe(true); expect(body.provider).toBeUndefined(); expect(result.ok && result.value.provenance).toBeUndefined();
  });
  it('does not retry a 429 inside the adapter', async () => {
    let calls = 0; const result = await adapter(async () => { calls++; return json({ error: 'rate limited' }, 429); }).chat(request);
    expect(result.ok).toBe(false); expect(calls).toBe(1);
  });
});

describe('actual host per scored case', () => {
  it('retains exact endpoint, policy, serving host and served model without retaining model output', async () => {
    const report = await evaluateModel(adapter(async () => json(response('DeepInfra', { model: 'actual-served-alias' }))), model, [testCase]);
    expect(report.cases[0]?.provenance).toEqual({ providerIdentity: BASE, requestPolicyFingerprint: OPENROUTER_POLICY_FINGERPRINT, servingHost: 'DeepInfra', servedModelId: 'actual-served-alias' });
    expect(JSON.stringify(report.cases)).not.toContain('content');
  });
  it('records unanswered attribution as null rather than substituting the preferred host', async () => {
    const report = await evaluateModel(adapter(async () => json({ error: 'unavailable' }, 503)), model, [testCase]);
    expect(report.cases[0]?.provenance).toMatchObject({ servingHost: null, servedModelId: null });
  });
  it('refuses mismatched provenance supplied by a provider implementation', async () => {
    const provider = adapter(async () => json(response()));
    const original = provider.chat;
    provider.chat = async r => { const result = await original(r); return result.ok ? { ...result, value: { ...result.value, provenance: { ...result.value.provenance!, requestPolicyFingerprint: 'wrong-policy' } } } : result; };
    const report = await evaluateModel(provider, model, [testCase]);
    expect(report.cases[0]?.errorClass).toBe('malformed_response'); expect(report.cases[0]?.passed).toBe(false);
  });
});

const args: EvalArgs = { tier: 1, models: [model], suites: TIER_SUITES[1], record: false, limit: null, intervalMs: 0 };
function measured(hostFor: (index: number) => string | null, activePolicy: MeasurementPolicy = policy) {
  let index = 0;
  const suites: SuiteResult[] = args.suites.map(suite => {
    const cases: CaseResult[] = MODEL_SUITES[suite].build().map(c => ({ caseId: c.id, suite, modelId: model, passed: true, latencyMs: 1, schemaValid: ['parse', 'classify'].includes(suite) ? true : null, toolCallValid: suite === 'tool-select' ? true : null, errorClass: null, finishReason: 'stop', provenance: { providerIdentity: activePolicy.providerIdentity, requestPolicyFingerprint: activePolicy.requestPolicyFingerprint, servingHost: hostFor(index++), servedModelId: model } }));
    const report = reportFromCases(model, cases);
    return { suite, version: MODEL_SUITES[suite].version, report, counts: countsOf(report), total: cases.length, passed: cases.length, errors: {}, failedCases: [] };
  });
  return summarise(model, suites);
}
describe('host-qualified measurement summaries, not a host router', () => {
  it('never combines two hosts to complete one host’s coverage', () => {
    const combined = measured(i => i % 2 ? 'Fireworks' : 'DeepInfra');
    expect(combined.schemaAdherence).toBe(1);
    const evidence = hostEvidenceFor([combined], policy, args);
    expect(evidence).toHaveLength(2); expect(evidence.every(e => !e.complete)).toBe(true);
    expect(hostProposalsFor(evidence, args).every(p => !p.proposedOrder.length)).toBe(true);
  });
  it('can propose one host only when every case was measured on that host and the existing gates pass', () => {
    const evidence = hostEvidenceFor([measured(() => 'DeepInfra')], policy, args);
    expect(evidence[0]?.complete).toBe(true); expect(hostProposalsFor(evidence, args)[0]?.proposedOrder).toEqual([model]);
  });
  it('does not accept missing attribution, another endpoint or a different request policy', () => {
    for (const other of [measured(() => null), measured(() => 'DeepInfra', { ...policy, providerIdentity: 'https://other.invalid/v1' }), measured(() => 'DeepInfra', { ...policy, requestPolicyFingerprint: 'different' })]) expect(hostEvidenceFor([other], policy, args)).toEqual([]);
  });
  it('does not let subset suites or --limit masquerade as complete evidence', () => {
    for (const partial of [{ ...args, limit: 1 }, { ...args, suites: ['parse'] as const }]) {
      const evidence = hostEvidenceFor([measured(() => 'DeepInfra')], policy, partial);
      expect(evidence[0]?.complete).toBe(false); expect(hostProposalsFor(evidence, partial)[0]?.proposedOrder).toEqual([]);
    }
  });
  it('retains case-level host attribution in serializable suite summaries and renders host-specific diagnostics', async () => {
    let calls = 0;
    const run = await runEvaluation({ provider: adapter(async () => json(response(calls++ ? 'Fireworks' : 'DeepInfra'))), models: [model], args: { ...args, suites: ['parse'], limit: 2 } });
    expect(run.proposedOrder).toEqual([]); expect(run.hostEvidence).toHaveLength(2);
    expect(run.models[0]?.suites[0]?.caseProvenance?.map(c => c.servingHost)).toEqual(['DeepInfra', 'Fireworks']);
    const text = renderEvalReport(run); expect(text).toContain('Serving-host measurements'); expect(text).toContain('DeepInfra'); expect(text).toContain('Fireworks'); expect(text).toContain(OPENROUTER_POLICY_FINGERPRINT);
    expect(calls).toBe(2);
  });
});

describe('recording remains blocked pending host-scoped owner approval', () => {
  it('rejects OpenRouter recording before a CLI can spend a request with --record', () => {
    expect(() => assertEvaluationRecordingSupported(BASE)).toThrow(/review-only.*no-record/);
    expect(() => assertEvaluationRecordingSupported('https://api.groq.com/openai/v1')).not.toThrow();
  });
  it('does not turn endpoint-only or forged host rows into OpenRouter capabilities', () => {
    const rows = measured(() => 'DeepInfra').suites.map(s => ({ model, suite: s.suite, evalVersion: s.version, casesPassed: s.passed, p50LatencyMs: 1, p95LatencyMs: 1, detail: { ...s.counts, providerIdentity: BASE, servingHost: 'DeepInfra', requestPolicyFingerprint: OPENROUTER_POLICY_FINGERPRINT, failedCases: [], errors: {} }, runAt: new Date('2026-11-03T08:00:00Z') }));
    expect(capabilitiesFromEvaluations(rows, undefined, undefined, BASE)).toEqual({});
    const legacyControl = rows.map(r => ({ ...r, detail: { ...r.detail, providerIdentity: 'https://api.groq.com/openai/v1' } }));
    expect(capabilitiesFromEvaluations(legacyControl, undefined, undefined, 'https://api.groq.com/openai/v1')[model]?.source).toBe('measured');
  });
});
