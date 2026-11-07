import { describe, expect, it } from 'vitest';
import { assessEntry, checkpointReport, candidateReadiness, executePlan, nextEntry, validatePlan, type Context, type Entry, type Progress } from '../../scripts/lib/ai-measurement-workflow';
import { ok } from '@/lib/result';
import { DEFAULT_REQUEST_PROFILE, requestProfileIdentity } from '@/server/ai/config/request-profiles';
import type { AiProvider } from '@/server/ai/provider/types';
import { maxTokensFor, MODEL_SUITES, TIER_SUITES, runEvaluation } from '@/server/ai/eval/runner';

const entry: Entry = { tier: 1, model: 'test-model', suite: 'robustness' };
const context: Context = { providerIdentity: 'https://example.invalid/v1', identity: 'source-profile-fingerprint', profile: requestProfileIdentity(DEFAULT_REQUEST_PROFILE) };
const ids = MODEL_SUITES[entry.suite].build().map(c => c.id);
function checkpoint(n = ids.length) {
  return { identity: context.identity, providerIdentity: context.providerIdentity, model: entry.model, tier: entry.tier, suite: entry.suite, version: MODEL_SUITES[entry.suite].version, maxTokens: maxTokensFor(entry.tier, entry.suite), startedAt: '2026-11-02T00:00:00.000Z', cases: ids.slice(0, n).map(caseId => ({ caseId, suite: entry.suite, modelId: entry.model, passed: true, latencyMs: 100, schemaValid: null, toolCallValid: null, errorClass: null, finishReason: 'stop' })) };
}
function report() {
  const suite = { suite: entry.suite, version: MODEL_SUITES[entry.suite].version, maxTokens: maxTokensFor(entry.tier, entry.suite), passed: ids.length, total: ids.length, failedCases: [] as string[], counts: { answered: ids.length, unanswered: 0, schemaValid: 0, schemaApplicable: 0, toolCallValid: 0, toolCallApplicable: 0 } };
  return { providerIdentity: context.providerIdentity, tier: 1, limit: null, suiteVersions: { [entry.suite]: suite.version }, models: [{ modelId: entry.model, requestProfile: context.profile, suites: [suite] }] };
}
const progress = (suite: Entry['suite'], status: Progress['status'], retained = 0): Progress => ({ ...entry, suite, status, total: 10, retained, passed: retained, answered: retained, unanswered: 0, remainingCaseIds: [] });

describe('source-bound measurement evidence', () => {
  it('validates diagnostic associations without using comparison verdicts as scores', () => {
    const e: Entry = { tier: 2, model: entry.model, suite: 'analysis' };
    const cp = { ...checkpoint(1), tier: 2, suite: 'analysis', version: MODEL_SUITES.analysis.version, maxTokens: maxTokensFor(2, 'analysis'),
      cases: [{ ...checkpoint(1).cases[0]!, caseId: 'analysis-001', suite: 'analysis', passed: false }],
      diagnostics: { 'analysis-001': { passed: false, reasons: ['missing_mentions'], counts: { missing_mentions: 1 },
        layoutComparison: { lineBreaks: 1, markdownSpans: 0, whitespace: { passed: true, missingMentions: 0, missingMetricBindings: 0 },
          inlineMarkdown: { passed: false, missingMentions: 1, missingMetricBindings: 0 }, combined: { passed: true, missingMentions: 0, missingMetricBindings: 0 } } } } };
    expect(assessEntry(e, context, cp)).toMatchObject({ retained: 1, passed: 0 });
    expect(() => assessEntry(e, context, { ...cp, diagnostics: { 'analysis-002': cp.diagnostics['analysis-001'] } })).toThrow(/case\/verdict/);
    expect(() => assessEntry(e, context, { ...cp, diagnostics: { 'analysis-001': { ...cp.diagnostics['analysis-001'], passed: true } } })).toThrow(/case\/verdict/);
    expect(() => assessEntry(e, context, { ...cp, cases: [{ ...cp.cases[0], errorClass: 'timeout' }] })).toThrow(/case\/verdict/);
    expect(() => assessEntry(entry, context, { ...checkpoint(1), diagnostics: {} })).toThrow(/Unexpected diagnostics/);
  });
  it('retains partial cases, requires final report emission, and then marks full coverage', () => {
    expect(assessEntry(entry, context)).toMatchObject({ status: 'pending', retained: 0, total: ids.length });
    expect(assessEntry(entry, context, checkpoint(3))).toMatchObject({ status: 'partial', retained: 3, remainingCaseIds: ids.slice(3) });
    expect(assessEntry(entry, context, checkpoint())).toMatchObject({ status: 'report_pending', retained: ids.length });
    expect(assessEntry(entry, context, checkpoint(), report())).toMatchObject({ status: 'complete', retained: ids.length });
  });
  it.each(['identity', 'providerIdentity', 'model', 'tier', 'suite', 'version', 'maxTokens'])('rejects mismatched checkpoint %s before any execution', field => {
    const cp = { ...checkpoint(), [field]: 'wrong' };
    expect(() => assessEntry(entry, context, cp)).toThrow();
  });
  it('rejects duplicate, foreign and output-bearing checkpoint cases', () => {
    const cp = checkpoint(2);
    expect(() => assessEntry(entry, context, { ...cp, cases: [cp.cases[0], cp.cases[0]] })).toThrow(/coverage/);
    expect(() => assessEntry(entry, context, { ...cp, cases: [{ ...cp.cases[0], caseId: 'foreign' }] })).toThrow(/coverage/);
    expect(() => assessEntry(entry, context, { ...cp, cases: [{ ...cp.cases[0], content: 'raw model output' }] })).toThrow();
  });
  it('accepts explicitly referenced legacy evidence, not arbitrary loose reports', () => {
    expect(() => assessEntry(entry, context, undefined, report())).toThrow(/explicit legacy/);
    expect(assessEntry({ ...entry, legacyEvidence: 'explicit.json' }, context, undefined, report()).status).toBe('complete');
  });
  it.each(['provider', 'profile', 'budget', 'count', 'failureId', 'partial', 'duplicateModel'])('rejects an incompatible or inconsistent report: %s', change => {
    const r = report(); const s = r.models[0]!.suites[0]!;
    if (change === 'provider') r.providerIdentity = 'https://foreign.invalid';
    if (change === 'profile') r.models[0]!.requestProfile = { id: 'other', fingerprint: 'other' };
    if (change === 'budget') s.maxTokens++;
    if (change === 'count') s.counts.answered--;
    if (change === 'failureId') { s.passed--; s.failedCases = ['unknown']; }
    if (change === 'partial') Object.assign(r, { limit: 3 });
    if (change === 'duplicateModel') r.models.push(r.models[0]!);
    expect(() => assessEntry(entry, context, checkpoint(), r)).toThrow();
  });
  it('retains unanswered failures, independently of coverage completion', () => {
    const cp = checkpoint(); Object.assign(cp.cases[0]!, { passed: false, errorClass: 'transport', finishReason: null });
    const r = report(); const s = r.models[0]!.suites[0]!;
    s.passed--; s.failedCases = [ids[0]!]; s.counts.answered--; s.counts.unanswered++;
    expect(assessEntry(entry, context, cp, r)).toMatchObject({ status: 'complete', unanswered: 1, passed: ids.length - 1 });
  });
  it('rejects report scores inconsistent with the retained cases', () => {
    const r = report(); const s = r.models[0]!.suites[0]!; s.passed--; s.failedCases = [ids[0]!];
    expect(() => assessEntry(entry, context, checkpoint(), r)).toThrow(/agree/);
  });
});

describe('finite task execution', () => {
  it('requires a nonempty, unique, complete model/tier suite plan', () => {
    const entries = TIER_SUITES[1].map(suite => ({ ...entry, suite }));
    expect(() => validatePlan(entries)).not.toThrow();
    expect(() => validatePlan([])).toThrow(/empty/);
    expect(() => validatePlan(entries.slice(1))).toThrow(/omits/);
    expect(() => validatePlan([...entries, entries[0]!])).toThrow(/Duplicate/);
    expect(() => validatePlan([{ ...entry, suite: 'document' }])).toThrow(/Invalid/);
  });
  it('finishes an interrupted report first, then partial cases, before starting new suites', () => {
    const rows = [progress('parse', 'pending'), progress('classify', 'partial', 4), progress('robustness', 'report_pending', 10)];
    expect(nextEntry(rows)?.suite).toBe('robustness');
    expect(nextEntry(rows.slice(0, 2))?.suite).toBe('classify');
  });
  it('executes all remaining entries in one invocation, skipping completed work', async () => {
    let rows = [progress('parse', 'complete', 10), progress('classify', 'pending'), progress('robustness', 'partial', 8)];
    const runs: string[] = [];
    const result = await executePlan(async () => rows, async next => {
      runs.push(next.suite); rows = rows.map(r => r.suite === next.suite ? { ...r, status: 'complete', retained: 10 } : r);
      return { code: 0 };
    });
    expect(runs).toEqual(['robustness', 'classify']);
    expect(result.reason).toBe('complete');
    expect(result.completedInvocations).toBe(2);
  });
  it('stops after a partial quota window without retrying or discarding progress', async () => {
    let row = progress('robustness', 'partial', 8); let runs = 0;
    const result = await executePlan(async () => [row], async () => { runs++; row = { ...row, retained: 9 }; return { code: 0 }; });
    expect(runs).toBe(1); expect(result.reason).toBe('quota_or_no_progress'); expect(result.rows[0]!.retained).toBe(9);
  });
  it('stops a zero-progress run once and an HTTP 429 even if the final case completed', async () => {
    let runs = 0; const row = progress('robustness', 'partial', 8);
    const noProgress = await executePlan(async () => [row], async () => { runs++; return { code: 0 }; });
    expect(noProgress.reason).toBe('quota_or_no_progress'); expect(runs).toBe(1);
    let rows = [row, progress('classify', 'pending')]; runs = 0;
    const limited = await executePlan(async () => rows, async () => { runs++; rows = [{ ...row, retained: 10, status: 'complete' }, rows[1]!]; return { code: 0, stopReason: 'HTTP 429' }; });
    expect(limited.reason).toBe('blocked'); expect(runs).toBe(1);
  });
  it('stops on child failure and refuses disappearing evidence', async () => {
    const row = progress('robustness', 'partial', 8);
    expect((await executePlan(async () => [row], async () => ({ code: 1 }))).reason).toBe('blocked');
    let rows = [row];
    await expect(executePlan(async () => rows, async () => { rows = []; return { code: 0 }; })).rejects.toThrow(/disappeared/);
  });
});


describe('consolidated candidate readiness', () => {
  const completeRows = () => TIER_SUITES[1].map(suite => {
    const total = MODEL_SUITES[suite].build().length;
    const schema = suite === 'parse' || suite === 'classify';
    const tools = suite === 'tool-select' || suite === 'injection';
    return { ...progress(suite, 'complete', total), total, counts: { answered: total, unanswered: 0, schemaValid: schema ? total : 0, schemaApplicable: schema ? total : 0, toolCallValid: tools ? total : 0, toolCallApplicable: tools ? total : 0 } };
  });
  it('keeps incomplete coverage separate from high partial scores', () => {
    const rows = completeRows().slice(1);
    const result = candidateReadiness(rows)[0]!;
    expect(result.missingSuites).toEqual(['parse']);
    expect(result.gateFailure).toMatch(/Incomplete/);
    expect(result.ownerApprovalRequired).toBe(true);
  });
  it('uses the unchanged gate and reports missing declarations even when scores pass', () => {
    const good = candidateReadiness(completeRows())[0]!;
    expect(good.gateFailure).toBeNull();
    expect(good.declarationBlockers).toEqual(['No declared capability entry.']);
    const rows = completeRows();
    rows.find(r => r.suite === 'tool-select')!.counts!.toolCallValid = 0;
    const bad = candidateReadiness(rows)[0]!;
    expect(bad.toolCallCorrectness).toBeCloseTo(25 / 55);
    expect(bad.gateFailure).toMatch(/tool-call correctness/);
  });
  it('combines exact counts instead of averaging suite rates and preserves unanswered exclusion', () => {
    const rows = completeRows();
    rows[0]!.counts!.schemaValid = 36;
    rows[1]!.counts!.schemaValid = 48;
    const candidate = candidateReadiness(rows)[0]!;
    expect(candidate.schemaAdherence).toBeCloseTo(84 / 100);
    rows[0]!.unanswered = 1; rows[0]!.answered--; rows[0]!.passed = 35;
    rows[0]!.counts!.answered--; rows[0]!.counts!.schemaApplicable--; rows[0]!.counts!.schemaValid--;
    expect(candidateReadiness(rows)[0]!.gateFailure).toMatch(/unanswered/);
    expect(candidate.p50LatencyMs).toBeNull();
    expect(candidate.latencyNote).toMatch(/Not pooled/);
  });
});


describe('offline report recovery', () => {
  it('cannot finalize missing coverage and round-trips a completed checkpoint', () => {
    expect(() => checkpointReport(entry, context, checkpoint(3))).toThrow(/incomplete/);
    const recovered = checkpointReport(entry, context, checkpoint());
    const serialized = { ...recovered, models: recovered.models.map(m => ({ ...m, suites: m.suites.map(({ report: _report, ...s }) => { void _report; return s; }) })) };
    expect(assessEntry(entry, context, checkpoint(), serialized).status).toBe('complete');
    expect(JSON.stringify(serialized)).not.toContain('latencyMs');
    expect(recovered.proposedOrder).toEqual([]);
  });
  it('retains provider failures without retrying or turning them into passing cases', () => {
    const cp = checkpoint(); Object.assign(cp.cases[0]!, { passed: false, errorClass: 'transport', finishReason: null });
    const recovered = checkpointReport(entry, context, cp);
    expect(recovered.models[0]!.unanswered).toBe(1);
    expect(recovered.models[0]!.suites[0]!.errors).toEqual({ transport: 1 });
    expect(recovered.models[0]!.suites[0]!.failedCases).toEqual([ids[0]]);
  });
  it('matches the ordinary runner exactly when resuming its scored cases', async () => {
    const provider: AiProvider = { key: 'fake', isConfigured: () => true, listModels: async () => ok([]), requestProfileFor: () => context.profile, chat: async () => ok({ model: entry.model, content: 'No records.', toolCalls: [], reasoning: null, finishReason: 'stop', latencyMs: 12, usage: { promptTokens: 1, completionTokens: 1 } }) };
    const original = await runEvaluation({ provider, args: { tier: 1, suites: [entry.suite], models: [entry.model], record: false, limit: null, intervalMs: 0 }, models: [entry.model], timeoutMs: 1000, now: () => new Date('2026-11-02T00:00:00.000Z') });
    const cp = { ...checkpoint(), cases: original.models[0]!.suites[0]!.report.cases };
    const recovered = checkpointReport(entry, context, cp, 1000, 0);
    expect(recovered.models).toEqual(original.models);
    expect(recovered.excluded).toEqual(original.excluded);
    expect(recovered.suiteVersions).toEqual(original.suiteVersions);
    expect(recovered.proposedOrder).toEqual(original.proposedOrder);
  });
});
