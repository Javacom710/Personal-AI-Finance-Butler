/** Finite measurement planning and evidence validation; no provider calls. */
import { z } from 'zod';
import type { Tier } from '../../src/server/ai/config/models';
import { countsOf, disqualification, unservedCapabilities, partialRunReason, proposeOrder, summarise, maxTokensFor, MODEL_SUITES, TIER_SUITES, type ModelSuite, type SuiteCounts, type ModelResult, type SuiteResult, type EvalRun } from '../../src/server/ai/eval/runner';
import { DECLARED_CAPABILITIES } from '../../src/server/ai/config/capabilities';
import { reportFromCases, type CaseResult } from '../../src/server/ai/eval/harness';
import { FailureDiagnosticsSchema } from './ai-failure-diagnostics';

export interface Entry { tier: Tier; model: string; suite: ModelSuite; legacyEvidence?: string; }
export interface Context { providerIdentity: string; identity: string; profile: { id: string; fingerprint: string }; }
export interface Progress extends Entry {
  total: number; retained: number; answered: number; unanswered: number; passed: number;
  status: 'pending' | 'partial' | 'report_pending' | 'complete'; remainingCaseIds: string[]; counts?: SuiteCounts;
}
const count = z.number().int().nonnegative().safe();
const countsSchema = z.object({ answered: count, unanswered: count, schemaValid: count, schemaApplicable: count, toolCallValid: count, toolCallApplicable: count });
const caseSchema = z.object({
  caseId: z.string(), suite: z.string(), modelId: z.string(), passed: z.boolean().nullable(), latencyMs: z.number().nonnegative().finite(),
  schemaValid: z.boolean().nullable(), toolCallValid: z.boolean().nullable(),
  errorClass: z.enum(['not_configured', 'unauthorized', 'rate_limited', 'transport', 'timeout', 'invalid_output', 'no_capable_model', 'refused', 'malformed_response']).nullable(),
  finishReason: z.enum(['stop', 'length', 'tool_calls', 'content_filter', 'error']).nullable().optional(),
}).strict();
const checkpointSchema = z.object({ identity: z.string(), providerIdentity: z.string(), model: z.string(), tier: z.number(), suite: z.string(), version: count, maxTokens: count, startedAt: z.iso.datetime(), cases: z.array(caseSchema), diagnostics: z.record(z.string(), FailureDiagnosticsSchema).optional() });
const suiteReportSchema = z.object({ suite: z.string(), version: count, maxTokens: count, passed: count, total: count, failedCases: z.array(z.string()), counts: countsSchema });
const reportSchema = z.object({ providerIdentity: z.string(), tier: z.number(), limit: z.null(), suiteVersions: z.record(z.string(), count), models: z.array(z.object({ modelId: z.string(), requestProfile: z.object({ id: z.string(), fingerprint: z.string() }), suites: z.array(suiteReportSchema) })) });

export function validatePlan(entries: readonly Entry[]): void {
  if (!entries.length) throw new Error('Measurement plan is empty.');
  const seen = new Set<string>();
  for (const e of entries) {
    if (![1, 2, 3, 4].includes(e.tier) || !TIER_SUITES[e.tier]?.includes(e.suite) || !e.model.trim()) throw new Error('Invalid measurement plan entry.');
    const key = JSON.stringify([e.tier, e.model, e.suite]);
    if (seen.has(key)) throw new Error('Duplicate measurement plan entry.');
    seen.add(key);
  }
  // A finite model/tier plan must include that tier's full suite set.
  for (const e of entries) if (TIER_SUITES[e.tier].some(s => !seen.has(JSON.stringify([e.tier, e.model, s])))) throw new Error('Measurement plan omits a required tier suite.');
}

export function assessEntry(entry: Entry, context: Context, checkpointInput?: unknown, reportInput?: unknown): Progress {
  const golden = MODEL_SUITES[entry.suite];
  const ids = golden.build().map(c => c.id);
  const expectedIds = new Set(ids);
  const budget = maxTokensFor(entry.tier, entry.suite);
  const row: Progress = { ...entry, total: ids.length, retained: 0, answered: 0, unanswered: 0, passed: 0, status: 'pending', remainingCaseIds: ids };
  let scored: CaseResult[] | undefined;
  if (checkpointInput !== undefined) {
    const parsed = checkpointSchema.safeParse(checkpointInput);
    // Validation paths can contain an arbitrary key from a modified file. Keep
    // that text out of CLI logs as well as out of retained diagnostic payloads.
    if (!parsed.success) throw new Error('Invalid checkpoint structure or diagnostic metadata.');
    const c = parsed.data;
    if (c.identity !== context.identity || c.providerIdentity !== context.providerIdentity || c.model !== entry.model || c.tier !== entry.tier || c.suite !== entry.suite || c.version !== golden.version || c.maxTokens !== budget) throw new Error('Checkpoint provenance differs from the active measurement.');
    if (new Set(c.cases.map(r => r.caseId)).size !== c.cases.length || c.cases.some(r => !expectedIds.has(r.caseId) || r.modelId !== entry.model || r.suite !== entry.suite)) throw new Error('Invalid checkpoint case coverage.');
    if (c.diagnostics) {
      if (!['analysis', 'document', 'parse', 'injection'].includes(entry.suite)) throw new Error('Unexpected diagnostics for this suite.');
      for (const [id, diagnostic] of Object.entries(c.diagnostics)) {
        const result = c.cases.find(test => test.caseId === id);
        if (!result || result.errorClass !== null || diagnostic.passed !== result.passed) throw new Error('Diagnostic case/verdict differs from retained measurement.');
      }
    }
    scored = c.cases as CaseResult[];
    const counts = countsOf(reportFromCases(entry.model, scored));
    const finished = new Set(scored.map(r => r.caseId));
    Object.assign(row, { retained: scored.length, answered: counts.answered, unanswered: counts.unanswered, passed: scored.filter(r => r.passed === true).length, status: scored.length === ids.length ? 'report_pending' : scored.length ? 'partial' : 'pending', counts, remainingCaseIds: ids.filter(id => !finished.has(id)) });
  }
  if (reportInput !== undefined) {
    if (!scored && !entry.legacyEvidence) throw new Error('A report needs a source-bound checkpoint or an explicit legacy evidence reference.');
    const r = reportSchema.parse(reportInput);
    const models = r.models.filter(m => m.modelId === entry.model);
    if (models.length !== 1) throw new Error('Report must contain exactly one matching model.');
    const m = models[0]!;
    const matching = m?.suites.filter(s => s.suite === entry.suite) ?? [];
    if (r.providerIdentity !== context.providerIdentity || r.tier !== entry.tier || r.suiteVersions[entry.suite] !== golden.version || m?.requestProfile.id !== context.profile.id || m?.requestProfile.fingerprint !== context.profile.fingerprint || matching.length !== 1) throw new Error('Report provider/profile/tier/suite provenance differs.');
    const s = matching[0]!;
    const c = s.counts;
    if (s.version !== golden.version || s.maxTokens !== budget || s.total !== ids.length || c.answered + c.unanswered !== ids.length || s.passed > c.answered || c.schemaValid > c.schemaApplicable || c.schemaApplicable > c.answered || c.toolCallValid > c.toolCallApplicable || c.toolCallApplicable > c.answered || new Set(s.failedCases).size !== s.failedCases.length || s.failedCases.length !== s.total - s.passed || s.failedCases.some(id => !expectedIds.has(id))) throw new Error('Report coverage/counts differ from the golden suite.');
    if (scored) {
      const expected = countsOf(reportFromCases(entry.model, scored));
      if (scored.length !== ids.length || Object.keys(expected).some(k => c[k as keyof typeof c] !== expected[k as keyof typeof expected]) || s.passed !== row.passed) throw new Error('Report does not agree with retained case results.');
      const failed = new Set(scored.filter(c => c.passed !== true).map(c => c.caseId));
      if (s.failedCases.some(id => !failed.has(id))) throw new Error('Report failure IDs differ from retained cases.');
    }
    Object.assign(row, { retained: s.total, answered: c.answered, unanswered: c.unanswered, passed: s.passed, counts: c, status: 'complete', remainingCaseIds: [] });
  }
  return row;
}
export function nextEntry(rows: readonly Progress[]): Progress | undefined {
  return rows.find(r => r.status === 'report_pending') ?? rows.find(r => r.status === 'partial') ?? rows.find(r => r.status === 'pending');
}
export interface Execution { code: number; stopReason?: string; }
export interface Outcome { reason: 'complete' | 'quota_or_no_progress' | 'blocked'; detail?: string; rows: Progress[]; completedInvocations: number; }
/** Every successful iteration completes an entry, so the loop is finite. No retries. */
export async function executePlan(load: () => Promise<Progress[]>, run: (entry: Progress) => Promise<Execution>): Promise<Outcome> {
  let rows = await load();
  let completedInvocations = 0;
  const maximum = rows.length;
  for (let i = 0; i <= maximum; i++) {
    const next = nextEntry(rows);
    if (!next) return { reason: 'complete', rows, completedInvocations };
    const before = next.retained;
    const execution = await run(next);
    rows = await load();
    const after = rows.find(r => r.tier === next.tier && r.model === next.model && r.suite === next.suite);
    if (!after || after.retained < before) throw new Error('Measurement progress disappeared.');
    if (execution.code !== 0 || execution.stopReason) return { reason: 'blocked', detail: execution.stopReason ?? `Evaluator exited ${execution.code}.`, rows, completedInvocations };
    if (after.status !== 'complete') return { reason: 'quota_or_no_progress', detail: after.retained > before ? 'Partial case progress retained; quota or another stop prevented suite completion.' : 'No progress; do not automatically retry.', rows, completedInvocations };
    completedInvocations++;
  }
  throw new Error('Measurement queue exceeded its finite bound.');
}


/** Display quality with the existing gate function; never accepts an order. */
export function candidateReadiness(rows: readonly Progress[]) {
  const groups = new Map<string, Progress[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.tier, row.model]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].map(group => {
    const first = group[0]!;
    const missing = TIER_SUITES[first.tier].filter(s => !group.some(r => r.suite === s && r.status === 'complete'));
    const sum = (key: keyof SuiteCounts) => group.reduce((n, r) => n + (r.counts?.[key] ?? 0), 0);
    const ratio = (n: number, d: number): number | null => d ? n / d : null;
    const accuracy = (suite: ModelSuite) => { const r = group.find(r => r.suite === suite); return r ? ratio(r.passed, r.answered) : null; };
    const result: ModelResult = {
      modelId: first.model, suites: [], schemaAdherence: ratio(sum('schemaValid'), sum('schemaApplicable')),
      toolCallCorrectness: ratio(sum('toolCallValid'), sum('toolCallApplicable')),
      retrievalGrounding: accuracy('grounding'), analysisAccuracy: accuracy('analysis'), injectionResistance: accuracy('injection'),
      p50LatencyMs: null, p95LatencyMs: null, unanswered: group.reduce((n, r) => n + r.unanswered, 0), unreachable: group.reduce((n, r) => n + r.answered, 0) === 0,
    };
    const base = Object.hasOwn(DECLARED_CAPABILITIES, first.model) ? DECLARED_CAPABILITIES[first.model] : undefined;
    const declarationBlockers = !base ? ['No declared capability entry.'] : [
      ...unservedCapabilities(base, first.tier).map(u => `${u.capability}: ${u.reason}`),
    ];
    const { suites: _suites, ...quality } = result;
    void _suites;
    return { tier: first.tier, ...quality, missingSuites: missing, gateFailure: missing.length ? 'Incomplete tier coverage: no routing proposal.' : disqualification(result, first.tier), declarationBlockers, latencyNote: 'Not pooled or ranked: earlier fetch-guard timings include quota waits.', ownerApprovalRequired: true };
  });
}


/** Re-emit a completed suite after a crash, with no provider request or rescoring. */
export function checkpointReport(entry: Entry, context: Context, input: unknown, timeoutMs = 60_000, intervalMs = 3000): EvalRun {
  const row = assessEntry(entry, context, input);
  if (row.status !== 'report_pending') throw new Error('Cannot finalize an incomplete checkpoint.');
  const cp = checkpointSchema.parse(input);
  const results = MODEL_SUITES[entry.suite].build().map(c => cp.cases.find(r => r.caseId === c.id)!) as CaseResult[];
  const report = reportFromCases(entry.model, results);
  const errors: Record<string, number> = {}; const finishReasons: Record<string, number> = {};
  for (const c of results) {
    if (c.errorClass) errors[c.errorClass] = (errors[c.errorClass] ?? 0) + 1;
    if (c.finishReason) finishReasons[c.finishReason] = (finishReasons[c.finishReason] ?? 0) + 1;
  }
  const suite: SuiteResult = { suite: entry.suite, version: cp.version, maxTokens: cp.maxTokens, report, counts: countsOf(report), total: results.length, passed: row.passed, failedCases: results.filter(c => c.passed !== true).map(c => c.caseId), errors, finishReasons };
  const model = { ...summarise(entry.model, [suite]), requestProfile: context.profile };
  const args = { tier: entry.tier, suites: [entry.suite], models: [entry.model], limit: null, record: false, intervalMs };
  const partial = partialRunReason(args);
  const proposed = partial ? { order: [], excluded: [{ modelId: entry.model, reason: partial }], caveats: [] } : proposeOrder([model], entry.tier);
  return { tier: entry.tier, providerIdentity: context.providerIdentity, startedAt: cp.startedAt, limit: null, requestIntervalMs: intervalMs, requestTimeoutMs: timeoutMs, suiteVersions: { [entry.suite]: cp.version }, models: [model], proposedOrder: proposed.order, excluded: proposed.excluded, caveats: proposed.caveats };
}
