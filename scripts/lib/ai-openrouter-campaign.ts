/** Finite, never-recording OpenRouter measurements. No provider construction or environment access. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DEFAULT_REQUEST_PROFILE, matchesRequestProfile, type RequestProfileIdentity } from '../../src/server/ai/config/request-profiles';
import type { AiProvider, MeasurementPolicy } from '../../src/server/ai/provider/types';
import { openRouterPolicy, validServingHost } from '../../src/server/ai/provider/openrouter-policy';
import { evaluateModel, reportFromCases, type CaseResult, type EvalCase } from '../../src/server/ai/eval/harness';
import { countsOf, hostEvidenceFor, hostProposalsFor, maxTokensFor, summarise, TIER_SUITES, type EvalRun, type ModelSuite, type SuiteResult } from '../../src/server/ai/eval/runner';

export type MeasurementTier = 1 | 2 | 3 | 4;
export interface Workload {
  readonly tier: MeasurementTier; readonly model: string; readonly suite: ModelSuite; readonly version: number;
  readonly profile: RequestProfileIdentity; readonly cases: readonly EvalCase[];
}
export interface CampaignPlan {
  readonly identity: string;
  readonly manifest: { readonly format: 1; readonly recoveryPolicy: 'one-explicit-unanswered-recovery'; readonly policy: MeasurementPolicy; readonly sourceFingerprint: string; readonly intervalMs: number; readonly timeoutMs: number; readonly rows: readonly { readonly tier: MeasurementTier; readonly model: string; readonly suite: ModelSuite; readonly version: number; readonly maxTokens: number; readonly profile: RequestProfileIdentity; readonly cases: readonly { readonly id: string; readonly fingerprint: string }[] }[] };
  readonly workloads: readonly Workload[];
}
export interface Attempt { readonly key: string; readonly startedAt: string; readonly finishedAt?: string; readonly result?: CaseResult }
export interface CampaignCheckpoint { readonly format: 1; readonly identity: string; readonly manifest: CampaignPlan['manifest']; readonly startedAt: string; readonly sourceRevision?: string; readonly notBefore?: string; readonly attempts: readonly Attempt[]; readonly recoveries: readonly Attempt[] }
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const itemKey = (w: Workload, c: EvalCase) => JSON.stringify([w.tier, w.model, w.suite, c.id]);
export function campaignQueue(plan: CampaignPlan) { return plan.workloads.flatMap(w => w.cases.map(c => ({ workload: w, testCase: c, key: itemKey(w, c) }))); }
export function buildCampaignPlan(workloads: readonly Workload[], sourceFingerprint: string, intervalMs = 3000, timeoutMs = 60000): CampaignPlan {
  if (!sourceFingerprint || !workloads.length || !Number.isSafeInteger(intervalMs) || intervalMs < 0 || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid campaign settings.');
  const seen = new Set<string>();
  for (const w of workloads) {
    if (!TIER_SUITES[w.tier]?.includes(w.suite) || !w.model.trim() || !Number.isSafeInteger(w.version) || w.version < 1 || !w.cases.length) throw new Error('Invalid campaign workload.');
    const key = JSON.stringify([w.tier, w.model, w.suite]);
    if (seen.has(key) || new Set(w.cases.map(c => c.id)).size !== w.cases.length || w.cases.some(c => c.suite !== w.suite)) throw new Error('Duplicate or mismatched campaign workload/case.');
    seen.add(key);
  }
  for (const w of workloads) if (TIER_SUITES[w.tier].some(s => !seen.has(JSON.stringify([w.tier, w.model, s])))) throw new Error('Campaign omits a required tier suite.');
  const manifest: CampaignPlan['manifest'] = { format: 1, recoveryPolicy: 'one-explicit-unanswered-recovery', policy: openRouterPolicy('https://openrouter.ai/api/v1')!, sourceFingerprint, intervalMs, timeoutMs,
    rows: workloads.map(w => ({ tier: w.tier, model: w.model, suite: w.suite, version: w.version, maxTokens: maxTokensFor(w.tier, w.suite), profile: { id: w.profile.id, fingerprint: w.profile.fingerprint }, cases: w.cases.map(c => ({ id: c.id, fingerprint: sha({ id: c.id, suite: c.suite, messages: c.messages, tools: c.tools, schema: c.schema }) })) })),
  };
  return { identity: sha(manifest), manifest, workloads };
}
const provenanceSchema = z.object({ providerIdentity: z.string(), requestPolicyFingerprint: z.string(), servingHost: z.string().nullable(), servedModelId: z.string().min(1).nullable() }).strict();
const caseSchema = z.object({ caseId: z.string(), suite: z.string(), modelId: z.string(), passed: z.boolean().nullable(), latencyMs: z.number().finite().nonnegative(), schemaValid: z.boolean().nullable(), toolCallValid: z.boolean().nullable(), errorClass: z.enum(['not_configured','unauthorized','rate_limited','transport','timeout','invalid_output','no_capable_model','refused','malformed_response']).nullable(), finishReason: z.enum(['stop','length','tool_calls','content_filter','error']).nullable(), provenance: provenanceSchema }).strict();
const attemptSchema = z.object({ key: z.string(), startedAt: z.iso.datetime(), finishedAt: z.iso.datetime().optional(), result: caseSchema.optional() }).strict();
const checkpointSchema = z.object({ format: z.literal(1), identity: z.string(), manifest: z.unknown(), startedAt: z.iso.datetime(), sourceRevision: z.string().optional(), notBefore: z.iso.datetime().optional(), attempts: z.array(attemptSchema), recoveries: z.array(attemptSchema) }).strict();
export function validateCampaignCheckpoint(plan: CampaignPlan, input: unknown): CampaignCheckpoint {
  const cp = checkpointSchema.parse(input);
  if (cp.identity !== plan.identity || sha(cp.manifest) !== plan.identity) throw new Error('Campaign source/provider/policy/profile/budget provenance differs; do not resume.');
  const queue = campaignQueue(plan);
  if (cp.attempts.length > queue.length) throw new Error('Checkpoint exceeds finite campaign.');
  const checkAttempt = (a: Attempt, item: ReturnType<typeof campaignQueue>[number]) => {
    if (a.key !== item.key) throw new Error('Checkpoint is not an ordered prefix of unique planned cases.');
    if (a.result && (!a.finishedAt || Date.parse(a.finishedAt) < Date.parse(a.startedAt))) throw new Error('Completed attempt has invalid timing.');
    if (!a.result && a.finishedAt) throw new Error('Incomplete attempt cannot claim completion timing.');
    if (!a.result) return; // A reserved attempt after interruption is never silently replayed.
    const r = a.result;
    if (!r.provenance || r.caseId !== item.testCase.id || r.modelId !== item.workload.model || r.suite !== item.workload.suite || r.provenance.providerIdentity !== plan.manifest.policy.providerIdentity || r.provenance.requestPolicyFingerprint !== plan.manifest.policy.requestPolicyFingerprint || (r.errorClass === null && (!validServingHost(r.provenance.servingHost) || !r.provenance.servedModelId))) throw new Error('Invalid case identity or serving-host provenance.');
  };
  cp.attempts.forEach((a, i) => checkAttempt(a as Attempt, queue[i]!));
  const recoveryKeys = new Set<string>();
  for (const a of cp.recoveries) {
    const original = cp.attempts.find(p => p.key === a.key);
    const item = queue.find(q => q.key === a.key);
    if (!item || !original || !recoverable(original as Attempt) || recoveryKeys.has(a.key) || Date.parse(a.startedAt) < Date.parse(original.finishedAt ?? original.startedAt)) throw new Error('Invalid or duplicate explicit recovery.');
    recoveryKeys.add(a.key); checkAttempt(a as Attempt, item);
  }
  return cp as CampaignCheckpoint;
}
export function emptyCampaign(plan: CampaignPlan, at: Date, sourceRevision?: string): CampaignCheckpoint { return { format: 1, identity: plan.identity, manifest: plan.manifest, startedAt: at.toISOString(), ...(sourceRevision ? { sourceRevision } : {}), attempts: [], recoveries: [] }; }
function recoverable(attempt: Attempt): boolean {
  return !attempt.result || (attempt.result.finishReason !== 'content_filter' && ['transport', 'timeout', 'rate_limited', 'unauthorized', 'not_configured'].includes(attempt.result.errorClass ?? ''));
}
function selectedResults(cp: CampaignCheckpoint): Map<string, CaseResult> {
  return new Map(cp.attempts.flatMap(a => {
    const recovered = cp.recoveries.find(r => r.key === a.key)?.result;
    // The explicit recovery's result is final evidence even when it is bad.
    // Keeping an earlier unanswered result instead could hide a protocol failure.
    const result = recovered ?? a.result;
    return result ? [[a.key, result] as const] : [];
  }));
}
export function campaignProgress(plan: CampaignPlan, input: unknown) {
  const cp = validateCampaignCheckpoint(plan, input); const queue = campaignQueue(plan); const selected = selectedResults(cp);
  const all = [...cp.attempts, ...cp.recoveries];
  return { identity: plan.identity, expectedCases: queue.length, attemptedCases: cp.attempts.length, recoveryAttempts: cp.recoveries.length, reservedCalls: all.length,
    retainedResults: selected.size, answeredCases: [...selected.values()].filter(r => r.errorClass === null).length,
    unansweredCases: [...selected.values()].filter(r => r.errorClass !== null).length,
    providerErrorAttempts: all.filter(a => a.result && a.result.errorClass !== null).length,
    unanswered: [...selected.entries()].filter(([, r]) => r.errorClass !== null).map(([key, r]) => ({ key, errorClass: r.errorClass, finishReason: r.finishReason ?? null })),
    passedCases: [...selected.values()].filter(r => r.passed === true).length,
    ambiguousAttempts: all.filter(a => !a.result).map(a => a.key),
    recoverableCases: cp.attempts.filter(a => recoverable(a) && !cp.recoveries.some(r => r.key === a.key)).map(a => a.key),
    unattemptedCases: queue.length - cp.attempts.length,
    coverageComplete: selected.size === queue.length,
    next: queue[cp.attempts.length]?.key ?? null, notBefore: cp.notBefore ?? null, recordsCapabilities: false as const, changesRouting: false as const,
  };
}
export interface CampaignStore { save(checkpoint: CampaignCheckpoint): Promise<void> }
export interface ExecutionOptions {
  now?: () => Date; sleep?: (ms: number) => Promise<void>; interrupted?: () => boolean;
  progress?: (checkpoint: CampaignCheckpoint) => Promise<void>;
}
function checkAdapter(plan: CampaignPlan, provider: AiProvider) {
  const policy = provider.measurementPolicy;
  if (!provider.isConfigured() || !policy || sha(policy) !== sha(plan.manifest.policy)) throw new Error('A configured OpenRouter adapter with the planned policy is required.');
  for (const w of plan.workloads) if (!matchesRequestProfile(provider.requestProfileFor?.(w.model) ?? DEFAULT_REQUEST_PROFILE, w.profile)) throw new Error('Adapter request-profile provenance differs.');
}
async function attemptCase(plan: CampaignPlan, cp: CampaignCheckpoint, item: ReturnType<typeof campaignQueue>[number], provider: AiProvider, store: CampaignStore, options: ExecutionOptions, recovery: boolean) {
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  if (options.interrupted?.()) return { checkpoint: cp, stop: 'interrupted' };
  const deadlines = [...cp.attempts, ...cp.recoveries].map(a => Date.parse(a.finishedAt ?? a.startedAt) + (a.finishedAt ? plan.manifest.intervalMs : Math.max(plan.manifest.timeoutMs, plan.manifest.intervalMs)));
  const nextAt = Math.max(cp.notBefore ? Date.parse(cp.notBefore) : 0, ...deadlines);
  if (nextAt - now().getTime() > 60000) return { checkpoint: cp, stop: 'provider_cooldown' };
  if (nextAt > now().getTime()) await sleep(nextAt - now().getTime());
  if (options.interrupted?.()) return { checkpoint: cp, stop: 'interrupted' };
  const reserved: Attempt = { key: item.key, startedAt: now().toISOString() };
  const field = recovery ? 'recoveries' : 'attempts';
  cp = { ...cp, [field]: [...cp[field], reserved] };
  await store.save(cp); // Durable reservation precedes HTTP, including an explicit recovery.
  let retryAfterMs: number | null = null;
  const report = await evaluateModel(provider, item.workload.model, [item.testCase], plan.manifest.timeoutMs, maxTokensFor(item.workload.tier, item.workload.suite), { beforeCase: async () => {}, rateLimited: ms => { retryAfterMs = ms; } });
  const result = report.cases[0]!; const finished = now(); const pause = retryAfterMs as number | null;
  const notBefore = pause !== null && Number.isSafeInteger(pause) && pause >= 0 && finished.getTime() + pause <= 8.64e15 ? new Date(finished.getTime() + pause).toISOString() : cp.notBefore;
  const completed = { ...cp, ...(notBefore ? { notBefore } : {}), [field]: [...cp[field].slice(0, -1), { ...reserved, finishedAt: finished.toISOString(), result }] };
  validateCampaignCheckpoint(plan, completed); await store.save(completed); await options.progress?.(completed);
  return { checkpoint: completed, stop: result.errorClass !== null ? `provider_${result.errorClass}` : result.finishReason === 'content_filter' ? 'content_filter' : null };
}
export async function measureCampaign(plan: CampaignPlan, input: unknown, provider: AiProvider, store: CampaignStore, options: ExecutionOptions = {}) {
  let cp = validateCampaignCheckpoint(plan, input); checkAdapter(plan, provider);
  for (const item of campaignQueue(plan).slice(cp.attempts.length)) {
    const outcome = await attemptCase(plan, cp, item, provider, store, options, false); cp = outcome.checkpoint;
    if (outcome.stop) return { checkpoint: cp, stop: outcome.stop };
  }
  return { checkpoint: cp, stop: campaignProgress(plan, cp).coverageComplete ? 'all_cases_attempted' : 'attempt_budget_exhausted_with_ambiguous_cases' };
}
/** One deliberately requested extra call, never an automatic retry loop or score cherry-pick. */
export async function recoverCampaignCase(plan: CampaignPlan, input: unknown, key: string, provider: AiProvider, store: CampaignStore, options: ExecutionOptions = {}) {
  const cp = validateCampaignCheckpoint(plan, input); checkAdapter(plan, provider);
  const original = cp.attempts.find(a => a.key === key); const item = campaignQueue(plan).find(q => q.key === key);
  if (!original || !item || !recoverable(original) || cp.recoveries.some(a => a.key === key)) throw new Error('Only one explicit recovery of an unanswered or ambiguous case is permitted; scored answers and content filters cannot be retried.');
  const outcome = await attemptCase(plan, cp, item, provider, store, options, true);
  return { ...outcome, stop: outcome.stop ?? 'recovered_case' };
}

/** Derive reports from retained scores only; never re-run a scorer or a model. */
export function campaignReports(plan: CampaignPlan, input: unknown): EvalRun[] {
  const cp = validateCampaignCheckpoint(plan, input);
  const results = selectedResults(cp);
  return ([1, 2, 3, 4] as const).filter(tier => plan.workloads.some(w => w.tier === tier)).map(tier => {
    const models = [...new Set(plan.workloads.filter(w => w.tier === tier).map(w => w.model))].map(modelId => {
      const workloads = plan.workloads.filter(w => w.tier === tier && w.model === modelId);
      const suites: SuiteResult[] = workloads.map(w => {
        const cases = w.cases.flatMap(c => { const result = results.get(itemKey(w, c)); return result ? [result] : []; });
        const report = reportFromCases(modelId, cases); const errors: Record<string, number> = {}; const finishReasons: Record<string, number> = {};
        for (const c of cases) { if (c.errorClass) errors[c.errorClass] = (errors[c.errorClass] ?? 0) + 1; if (c.finishReason) finishReasons[c.finishReason] = (finishReasons[c.finishReason] ?? 0) + 1; }
        return { suite: w.suite, version: w.version, maxTokens: maxTokensFor(tier, w.suite), report, counts: countsOf(report), passed: cases.filter(c => c.passed === true).length, total: cases.length, failedCases: cases.filter(c => c.passed !== true).map(c => c.caseId), errors, finishReasons, caseProvenance: cases.map(c => ({ caseId: c.caseId, ...c.provenance! })) };
      });
      return { ...summarise(modelId, suites), requestProfile: workloads[0]!.profile };
    });
    const args = { tier, models: models.map(m => m.modelId), suites: TIER_SUITES[tier], limit: null, record: false, intervalMs: plan.manifest.intervalMs };
    const evidence = hostEvidenceFor(models, plan.manifest.policy, args);
    return { providerIdentity: plan.manifest.policy.providerIdentity, measurementPolicy: plan.manifest.policy, hostEvidence: evidence, hostProposals: hostProposalsFor(evidence, args), tier, startedAt: cp.startedAt, limit: null, requestIntervalMs: plan.manifest.intervalMs, requestTimeoutMs: plan.manifest.timeoutMs, suiteVersions: Object.fromEntries(plan.workloads.filter(w => w.tier === tier).map(w => [w.suite, w.version])), models, proposedOrder: [], excluded: models.map(m => ({ modelId: m.modelId, reason: 'Review complete host-qualified evidence; no provider-wide order is proposed.' })) };
  });
}
