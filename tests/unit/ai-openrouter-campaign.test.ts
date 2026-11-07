import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ok, err } from '@/lib/result';
import { malformedResponse, rateLimited, transport } from '@/server/ai/errors';
import { DEFAULT_REQUEST_PROFILE } from '@/server/ai/config/request-profiles';
import { openRouterPolicy } from '@/server/ai/provider/openrouter-policy';
import type { AiProvider, ChatRequest, ChatResponse } from '@/server/ai/provider/types';
import { openRouterWorkloads } from '../../scripts/lib/ai-openrouter-plan';
import { buildCampaignPlan, campaignProgress, campaignQueue, campaignReports, emptyCampaign, measureCampaign, recoverCampaignCase, validateCampaignCheckpoint, type CampaignCheckpoint, type Workload } from '../../scripts/lib/ai-openrouter-campaign';
const policy = openRouterPolicy('https://openrouter.ai/api/v1')!;
const score = vi.fn((text: string | null) => text === 'correct');
function workload(count = 3): Workload {
  return { tier: 4, model: 'qwen/fake-vision', suite: 'document', version: 1, profile: DEFAULT_REQUEST_PROFILE,
    cases: Array.from({ length: count }, (_, i) => ({ id: `document-test-${i}`, suite: 'document' as const, messages: [{ role: 'user' as const, content: `Synthetic case ${i}` }], score })) };
}
const planFor = (count = 3, source = 'test-source', interval = 0) => buildCampaignPlan([workload(count)], source, interval, 1000);
function fixture(reply?: (request: ChatRequest, index: number) => ReturnType<AiProvider['chat']>) {
  let at = Date.parse('2026-11-03T09:00:00Z');
  const requests: ChatRequest[] = []; const saved: CampaignCheckpoint[] = [];
  const provider: AiProvider = { key: 'fake', measurementPolicy: policy, requestProfileFor: () => DEFAULT_REQUEST_PROFILE,
    isConfigured: () => true, listModels: async () => ok([]), chat: async request => {
      requests.push(request); at += 7;
      if (reply) return reply(request, requests.length - 1);
      return ok(response(request));
    },
  };
  const store = { save: async (cp: CampaignCheckpoint) => { saved.push(structuredClone(cp)); } };
  return { requests, saved, provider, store, now: () => new Date(at), tick: (ms: number) => { at += ms; }, sleep: async (ms: number) => { at += ms; } };
}
function response(request: ChatRequest, host = 'DeepInfra', text = 'correct'): ChatResponse {
  return { model: request.model, content: text, toolCalls: [], reasoning: null, finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 1 }, latencyMs: 7, provenance: { providerIdentity: policy.providerIdentity, requestPolicyFingerprint: policy.requestPolicyFingerprint, servingHost: host } };
}
beforeEach(() => { score.mockClear(); });
describe('finite campaign and provenance', () => {
  it('runs each planned case once, reserving before HTTP and saving the result before the next call', async () => {
    const plan = planFor(); const f = fixture();
    const chat = f.provider.chat;
    f.provider.chat = async r => { expect(f.saved.at(-1)?.attempts.at(-1)?.result).toBeUndefined(); return chat(r); };
    const result = await measureCampaign(plan, emptyCampaign(plan, f.now()), f.provider, f.store, f);
    expect(result.stop).toBe('all_cases_attempted'); expect(f.requests).toHaveLength(3); expect(f.saved).toHaveLength(6);
    expect(campaignProgress(plan, result.checkpoint)).toMatchObject({ coverageComplete: true, retainedResults: 3, unattemptedCases: 0, recordsCapabilities: false, changesRouting: false });
    expect(score).toHaveBeenCalledTimes(3);
    expect(f.requests.every(r => r.maxTokens === plan.manifest.rows[0]?.maxTokens)).toBe(true);
  });
  it('does not stop or discard a genuine wrong answer', async () => {
    const plan = planFor(); const f = fixture(async (r, i) => ok(response(r, 'DeepInfra', i ? 'correct' : 'wrong')));
    const result = await measureCampaign(plan, emptyCampaign(plan, f.now()), f.provider, f.store, f);
    expect(f.requests).toHaveLength(3); expect(result.checkpoint.attempts[0]?.result?.passed).toBe(false);
    expect(campaignProgress(plan, result.checkpoint).coverageComplete).toBe(true);
  });
  it('stops on the first provider failure and never replays that failed case when resumed', async () => {
    const plan = planFor(); const f = fixture(async (r, i) => i === 1 ? err(transport('synthetic failure')) : ok(response(r)));
    const first = await measureCampaign(plan, emptyCampaign(plan, f.now()), f.provider, f.store, f);
    expect(first.stop).toBe('provider_transport'); expect(f.requests).toHaveLength(2);
    const next = await measureCampaign(plan, first.checkpoint, f.provider, f.store, f);
    expect(f.requests).toHaveLength(3); expect(next.stop).toBe('all_cases_attempted');
    expect(campaignProgress(plan, next.checkpoint)).toMatchObject({ retainedResults: 3, unansweredCases: 1 });
  });
  it('completed campaigns cost zero further calls on repeated invocations', async () => {
    const plan = planFor(1); const f = fixture();
    const first = await measureCampaign(plan, emptyCampaign(plan, f.now()), f.provider, f.store, f);
    await measureCampaign(plan, first.checkpoint, f.provider, f.store, f);
    expect(f.requests).toHaveLength(1); expect(f.saved).toHaveLength(2);
  });
  it('cannot send a request if the durable reservation fails', async () => {
    const plan = planFor(); const f = fixture();
    await expect(measureCampaign(plan, emptyCampaign(plan, f.now()), f.provider, { save: async () => { throw Error('disk unavailable'); } }, f)).rejects.toThrow('disk unavailable');
    expect(f.requests).toHaveLength(0);
  });
  it('preserves an ambiguous reservation if the process dies after HTTP but before saving scores', async () => {
    const plan = planFor(2); const f = fixture(); let last!: CampaignCheckpoint; let writes = 0;
    const store = { save: async (cp: CampaignCheckpoint) => { if (++writes === 2) throw Error('crash after HTTP'); last = structuredClone(cp); } };
    await expect(measureCampaign(plan, emptyCampaign(plan, f.now()), f.provider, store, f)).rejects.toThrow('crash after HTTP');
    expect(f.requests).toHaveLength(1); expect(campaignProgress(plan, last).ambiguousAttempts).toHaveLength(1);
    const resumed = await measureCampaign(plan, last, f.provider, f.store, f);
    expect(f.requests).toHaveLength(2); expect(resumed.stop).toBe('attempt_budget_exhausted_with_ambiguous_cases');
    expect(campaignProgress(plan, resumed.checkpoint)).toMatchObject({ coverageComplete: false, retainedResults: 1, unattemptedCases: 0 });
    await measureCampaign(plan, resumed.checkpoint, f.provider, f.store, f); expect(f.requests).toHaveLength(2);
  });
  it('honors Retry-After across invocations without parking or retrying in a loop', async () => {
    const plan = planFor(2); const f = fixture(async (r, i) => i ? ok(response(r)) : err(rateLimited(120000)));
    const first = await measureCampaign(plan, emptyCampaign(plan, f.now()), f.provider, f.store, f);
    expect(first.stop).toBe('provider_rate_limited'); expect(first.checkpoint.notBefore).toBeTruthy();
    const paused = await measureCampaign(plan, first.checkpoint, f.provider, f.store, f);
    expect(paused.stop).toBe('provider_cooldown'); expect(f.requests).toHaveLength(1);
    f.tick(120000); await measureCampaign(plan, paused.checkpoint, f.provider, f.store, f); expect(f.requests).toHaveLength(2);
  });
  it('keeps request pacing across resume and makes no request after interruption', async () => {
    const plan = planFor(2, 'source', 3000); const f = fixture();
    const first = await measureCampaign(plan, emptyCampaign(plan, f.now()), f.provider, f.store, { ...f, interrupted: () => f.requests.length === 1 });
    expect(first.stop).toBe('interrupted'); const sleeps: number[] = [];
    await measureCampaign(plan, first.checkpoint, f.provider, f.store, { ...f, sleep: async ms => { sleeps.push(ms); f.tick(ms); } });
    expect(sleeps).toEqual([3000]); expect(f.requests).toHaveLength(2);
  });
  it('stops content-filter responses without moving to another model or case', async () => {
    const plan = planFor(); const f = fixture(async r => ok({ ...response(r), finishReason: 'content_filter' }));
    const result = await measureCampaign(plan, emptyCampaign(plan, f.now()), f.provider, f.store, f);
    expect(result.stop).toBe('content_filter'); expect(f.requests).toHaveLength(1);
  });
  it.each(['key', 'endpoint', 'policy', 'profile'])('rejects incompatible adapter %s before reserving or sending', async change => {
    const plan = planFor(); const f = fixture();
    if (change === 'key') f.provider.isConfigured = () => false;
    if (change === 'endpoint') Object.assign(f.provider, { measurementPolicy: { ...policy, providerIdentity: 'https://foreign.invalid' } });
    if (change === 'policy') Object.assign(f.provider, { measurementPolicy: { ...policy, requestPolicyFingerprint: 'different' } });
    if (change === 'profile') f.provider.requestProfileFor = () => ({ id: 'different', fingerprint: 'different' });
    await expect(measureCampaign(plan, emptyCampaign(plan, f.now()), f.provider, f.store, f)).rejects.toThrow(); expect(f.requests).toHaveLength(0); expect(f.saved).toHaveLength(0);
  });
});
describe('campaign checkpoint validation and offline reports', () => {
  it.each(['source','interval','timeout','profile','golden','budget-version'])('does not resume evidence after %s changes', change => {
    const original = planFor(); const cp = emptyCampaign(original, new Date('2026-11-03T09:00:00Z'));
    const w = workload(); let source = 'test-source'; let interval = 0; let timeoutMs = 1000;
    if (change === 'source') source = 'other-source'; if (change === 'interval') interval = 3000; if (change === 'timeout') timeoutMs++;
    if (change === 'profile') Object.assign(w, { profile: { ...DEFAULT_REQUEST_PROFILE, fingerprint: 'other' } });
    if (change === 'golden') Object.assign(w.cases[0]!, { messages: [{ role: 'user', content: 'changed fixture' }] });
    if (change === 'budget-version') Object.assign(w, { version: 2 });
    expect(() => validateCampaignCheckpoint(buildCampaignPlan([w], source, interval, timeoutMs), cp)).toThrow(/provenance/);
  });
  it('rejects duplicate/out-of-order/foreign cases and raw model-output fields', async () => {
    const plan = planFor(2); const f = fixture(); const result = await measureCampaign(plan, emptyCampaign(plan, f.now()), f.provider, f.store, f);
    for (const mutate of [
      (cp: CampaignCheckpoint) => ({ ...cp, attempts: [...cp.attempts, cp.attempts[0]!] }),
      (cp: CampaignCheckpoint) => ({ ...cp, attempts: [...cp.attempts].reverse() }),
      (cp: CampaignCheckpoint) => ({ ...cp, attempts: [{ ...cp.attempts[0]!, result: { ...cp.attempts[0]!.result!, modelId: 'foreign' } }] }),
      (cp: CampaignCheckpoint) => ({ ...cp, attempts: [{ ...cp.attempts[0]!, result: { ...cp.attempts[0]!.result!, content: 'raw model text must not be saved' } }] }),
    ]) expect(() => validateCampaignCheckpoint(plan, mutate(result.checkpoint))).toThrow();
  });
  it('rejects altered host provenance and inconsistent completed timing', async () => {
    const plan = planFor(1); const f = fixture(); const done = await measureCampaign(plan, emptyCampaign(plan, f.now()), f.provider, f.store, f);
    const attempt = done.checkpoint.attempts[0]!;
    for (const patch of [{ finishedAt: undefined }, { finishedAt: '2020-01-01T00:00:00Z' }, { result: { ...attempt.result!, provenance: { ...attempt.result!.provenance!, requestPolicyFingerprint: 'different' } } }, { result: { ...attempt.result!, provenance: { ...attempt.result!.provenance!, servingHost: null } } }]) {
      expect(() => validateCampaignCheckpoint(plan, { ...done.checkpoint, attempts: [{ ...attempt, ...patch }] })).toThrow();
    }
  });
  it('derives honest partial host reports without inference, rescoring or dropping failures', async () => {
    const plan = planFor(3); const f = fixture(async (r, i) => i === 1 ? err(transport('offline')) : ok(response(r, 'Fallback Host')));
    const done = await measureCampaign(plan, emptyCampaign(plan, f.now()), f.provider, f.store, f);
    score.mockClear(); const calls = f.requests.length;
    const reports = campaignReports(plan, done.checkpoint);
    expect(reports[0]?.models[0]?.suites[0]?.total).toBe(2); expect(reports[0]?.models[0]?.unanswered).toBe(1);
    expect(reports[0]?.models[0]?.suites[0]?.caseProvenance?.[0]?.servingHost).toBe('Fallback Host');
    expect(reports[0]?.proposedOrder).toEqual([]); expect(reports[0]?.hostProposals?.every(p => !p.proposedOrder.length)).toBe(true);
    expect(score).not.toHaveBeenCalled(); expect(f.requests).toHaveLength(calls);
    expect(JSON.stringify(done.checkpoint)).not.toContain('Synthetic case'); expect(JSON.stringify(done.checkpoint)).not.toContain('"content"');
  });
  it('requires unique, complete tier-suite plans and stable identities independent of timestamp/commit label', () => {
    expect(() => buildCampaignPlan([], 'source')).toThrow(); const w = workload();
    expect(() => buildCampaignPlan([w, w], 'source')).toThrow();
    expect(() => buildCampaignPlan([{ ...w, tier: 1 }], 'source')).toThrow();
    const a = planFor(); const b = planFor(); expect(a.identity).toBe(b.identity);
    expect(validateCampaignCheckpoint(a, emptyCampaign(a, new Date('2026-11-03T09:00:00Z'), 'docs-only-commit')).identity).toBe(a.identity);
    expect(campaignQueue(a)).toHaveLength(3);
  });
});

describe('one explicit recovery, not an automatic retry loop', () => {
  it('recovers a transport gap once, preserving original failure history and excluding it from model quality', async () => {
    const plan = planFor(1); const f = fixture(async (r, i) => i ? ok(response(r)) : err(transport('temporary outage')));
    const failed = await measureCampaign(plan, emptyCampaign(plan, f.now()), f.provider, f.store, f);
    const key = failed.checkpoint.attempts[0]!.key;
    const recovered = await recoverCampaignCase(plan, failed.checkpoint, key, f.provider, f.store, f);
    expect(recovered.stop).toBe('recovered_case'); expect(f.requests).toHaveLength(2);
    expect(recovered.checkpoint.attempts[0]?.result?.errorClass).toBe('transport'); expect(recovered.checkpoint.recoveries[0]?.result?.errorClass).toBeNull();
    expect(campaignProgress(plan, recovered.checkpoint)).toMatchObject({ answeredCases: 1, unansweredCases: 0, providerErrorAttempts: 1, reservedCalls: 2, coverageComplete: true });
    expect(campaignReports(plan, recovered.checkpoint)[0]?.models[0]?.suites[0]?.total).toBe(1);
    await expect(recoverCampaignCase(plan, recovered.checkpoint, key, f.provider, f.store, f)).rejects.toThrow(/one explicit/); expect(f.requests).toHaveLength(2);
  });
  it.each(['correct', 'wrong', 'filter'])('cannot cherry-pick or retry a scored %s response', async kind => {
    const plan = planFor(1); const f = fixture(async r => ok({ ...response(r, 'DeepInfra', kind), finishReason: kind === 'filter' ? 'content_filter' : 'stop' }));
    const first = await measureCampaign(plan, emptyCampaign(plan, f.now()), f.provider, f.store, f);
    await expect(recoverCampaignCase(plan, first.checkpoint, first.checkpoint.attempts[0]!.key, f.provider, f.store, f)).rejects.toThrow(/scored answers/); expect(f.requests).toHaveLength(1);
  });
  it('can explicitly resolve an interrupted reservation but retains the potential original charge', async () => {
    const plan = planFor(1); const f = fixture(); const cp = { ...emptyCampaign(plan, f.now()), attempts: [{ key: campaignQueue(plan)[0]!.key, startedAt: f.now().toISOString() }] };
    const recovered = await recoverCampaignCase(plan, cp, cp.attempts[0]!.key, f.provider, f.store, f);
    expect(campaignProgress(plan, recovered.checkpoint)).toMatchObject({ coverageComplete: true, recoveryAttempts: 1, reservedCalls: 2 });
    expect(campaignProgress(plan, recovered.checkpoint).ambiguousAttempts).toHaveLength(1); expect(f.requests).toHaveLength(1);
  });
  it('does not replay an interrupted recovery or exceed its one-call budget', async () => {
    const plan = planFor(1); const f = fixture(async () => err(transport('outage')));
    const first = await measureCampaign(plan, emptyCampaign(plan, f.now()), f.provider, f.store, f);
    let saved!: CampaignCheckpoint; let writes = 0;
    await expect(recoverCampaignCase(plan, first.checkpoint, first.checkpoint.attempts[0]!.key, f.provider, { save: async cp => { if (++writes === 2) throw Error('interrupted recovery'); saved = structuredClone(cp); } }, f)).rejects.toThrow('interrupted recovery');
    await expect(recoverCampaignCase(plan, saved, saved.attempts[0]!.key, f.provider, f.store, f)).rejects.toThrow(/one explicit/);
    expect(f.requests).toHaveLength(2);
  });
});

it('executes the complete real golden workload in one finite invocation with fake responses and unchanged budgets', async () => {
  const workloads = openRouterWorkloads('qwen/fake-catalogue-vision');
  const plan = buildCampaignPlan(workloads, 'test-source', 0, 1000); const queue = campaignQueue(plan);
  const f = fixture(async (request, index) => {
    const item = queue[index]!;
    expect(request.model).toBe(item.workload.model);
    expect(request.messages).toEqual(item.testCase.messages);
    expect(request.maxTokens).toBe(plan.manifest.rows.find(r => r.tier === item.workload.tier && r.model === item.workload.model && r.suite === item.workload.suite)?.maxTokens);
    return ok(response(request, 'DeepInfra', '{}'));
  });
  let last!: CampaignCheckpoint;
  const outcome = await measureCampaign(plan, emptyCampaign(plan, f.now()), f.provider, { save: async cp => { last = cp; } }, f);
  expect(outcome.stop).toBe('all_cases_attempted'); expect(f.requests.length).toBeGreaterThan(100); expect(f.requests).toHaveLength(queue.length);
  expect(campaignProgress(plan, last)).toMatchObject({ coverageComplete: true, unattemptedCases: 0, recoveryAttempts: 0 });
  expect(campaignReports(plan, last).map(r => r.tier)).toEqual([1, 2, 3, 4]);
  await measureCampaign(plan, last, f.provider, f.store, f); expect(f.requests).toHaveLength(queue.length);
}, 30000);

it('retains a recovery protocol failure as final evidence instead of hiding it behind the earlier timeout', async () => {
  const plan = planFor(1); const f = fixture(async (_r, i) => err(i ? malformedResponse('synthetic protocol failure') : transport('outage')));
  const first = await measureCampaign(plan, emptyCampaign(plan, f.now()), f.provider, f.store, f);
  const recovered = await recoverCampaignCase(plan, first.checkpoint, first.checkpoint.attempts[0]!.key, f.provider, f.store, f);
  expect(campaignReports(plan, recovered.checkpoint)[0]?.models[0]?.suites[0]?.report.cases[0]?.errorClass).toBe('malformed_response');
  expect(recovered.checkpoint.attempts[0]?.result?.errorClass).toBe('transport'); expect(f.requests).toHaveLength(2);
});
