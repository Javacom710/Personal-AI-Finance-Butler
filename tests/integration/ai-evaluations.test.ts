import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { evaluationProviderIdentity, latestEvaluations, measuredCapabilities, recordEvaluationRun } from '@/server/ai-evaluations';
import { aiRuntime, loadMeasuredCapabilities, resetAiRuntime } from '@/server/ai-runtime';
import { DEFAULT_REQUEST_PROFILE, THINKING_DISABLED_PROFILE, requestProfileIdentity } from '@/server/ai/config/request-profiles';
import { MODEL_SUITES, TIER_SUITES, type EvalRun, type ModelSuite } from '@/server/ai/eval/runner';
import type { ModelReport } from '@/server/ai/eval/harness';
import { closeHarness, truncateAll } from './harness';
import { rawSql, closeMoneyHarness } from './money-harness';

/**
 * `ai_model_evaluations` end to end (ADR-44): a run is stored, the latest rows
 * per model and suite are read back, and the runtime loads them as measured
 * capability entries. No provider is called: the run is built here.
 */

import { aiProviderSettings, env } from '@/lib/env';

const MODEL = 'nvidia/nemotron-3-super-120b-a12b';

function run(startedAt: string, passed: number, limit: number | null = null): EvalRun {
  const report: ModelReport = {
    modelId: MODEL,
    cases: [],
    schemaAdherence: null,
    toolCallCorrectness: null,
    retrievalGrounding: null,
    p50LatencyMs: 800,
    p95LatencyMs: 2000,
  };
  const suites = TIER_SUITES[2].map((suite: ModelSuite) => ({
    suite,
    maxTokens: 4096,
    finishReasons: { stop: 10 },
    version: MODEL_SUITES[suite].version,
    report,
    passed,
    total: 10,
    failedCases: [],
    errors: {},
    counts: { answered: 10, unanswered: 0, schemaValid: 0, schemaApplicable: 0, toolCallValid: passed, toolCallApplicable: 10 },
  }));
  return {
    providerIdentity: evaluationProviderIdentity(aiProviderSettings(env()).baseUrl),
    tier: 2,
    requestTimeoutMs: 45000,
    startedAt,
    limit,
    suiteVersions: {},
    models: [
      {
        modelId: MODEL,
        suites,
        schemaAdherence: null,
        toolCallCorrectness: passed / 10,
        retrievalGrounding: passed / 10,
        analysisAccuracy: passed / 10,
        injectionResistance: passed / 10,
        p50LatencyMs: 800,
        p95LatencyMs: 2000,
        unreachable: false,
        unanswered: 0,
      },
    ],
    proposedOrder: [],
    excluded: [],
  };
}

beforeAll(async () => {
  await truncateAll();
  await rawSql('truncate table ai_model_evaluations');
});

afterAll(async () => {
  await rawSql('truncate table ai_model_evaluations');
  resetAiRuntime();
  await loadMeasuredCapabilities(async () => ({}));
  await closeMoneyHarness();
  await closeHarness();
});

describe('ai_model_evaluations', () => {
  it('stores one row per model and suite, and refuses a wire check', async () => {
    expect(await recordEvaluationRun(run('2026-10-30T10:00:00Z', 7))).toBe(TIER_SUITES[2].length);
    await expect(recordEvaluationRun(run('2026-10-30T11:00:00Z', 7, 3))).rejects.toThrow(/never stored/);
  });

  it('reads back only the latest row per model and suite', async () => {
    await recordEvaluationRun(run('2026-11-01T10:00:00Z', 9));
    const latest = await latestEvaluations();
    expect(latest).toHaveLength(TIER_SUITES[2].length);
    expect(latest.every((r) => r.casesPassed === 9)).toBe(true);
    expect(latest.every((r) => r.detail.maxTokens === 4096 && r.detail.requestTimeoutMs === 45000 && r.detail.finishReasons?.stop === 10)).toBe(true);
  });

  it('becomes a measured entry the runtime routes on', async () => {
    const measured = await measuredCapabilities();
    expect(measured[MODEL]).toMatchObject({ source: 'measured', scores: { toolCallCorrectness: 0.9 } });
    expect(await loadMeasuredCapabilities()).toBe(1);
    // The runtime rebuilds with the measured matrix; building it must not throw.
    expect(() => aiRuntime()).not.toThrow();
  });

  it('a database the runtime cannot read leaves the declared matrix, and says so', async () => {
    expect(await loadMeasuredCapabilities(async () => { throw new Error('offline'); })).toBe(0);
  });

  it('the table rejects an impossible row', async () => {
    await expect(
      rawSql(
        `insert into ai_model_evaluations (model, tier, eval_version, suite, cases_total, cases_passed, score)
         values ('m', 2, 1, 'grounding', 5, 6, 1.0)`,
      ),
    ).rejects.toThrow();
  });

  it('retains separate default and thinking-disabled histories and refuses forged provenance', async () => {
    const model = 'nvidia/nemotron-3.5-lightning-30b-a3b';
    const source = run('2026-11-02T07:00:00Z', 9);
    const withProfile = (identity: typeof DEFAULT_REQUEST_PROFILE, startedAt: string): EvalRun => ({
      ...source,
      startedAt,
      models: source.models.map(m => ({ ...m, modelId: model, requestProfile: requestProfileIdentity(identity) })),
    });
    await recordEvaluationRun(withProfile(DEFAULT_REQUEST_PROFILE, '2026-11-02T07:00:00Z'));
    await recordEvaluationRun(withProfile(THINKING_DISABLED_PROFILE, '2026-11-02T08:00:00Z'));
    await recordEvaluationRun(withProfile(DEFAULT_REQUEST_PROFILE, '2026-11-02T09:00:00Z'));
    const latest = (await latestEvaluations()).filter(r => r.model === model);
    expect(latest).toHaveLength(TIER_SUITES[2].length * 2);
    const defaultRows = latest.filter(r => r.detail.requestProfile?.id === DEFAULT_REQUEST_PROFILE.id);
    const disabledRows = latest.filter(r => r.detail.requestProfile?.id === THINKING_DISABLED_PROFILE.id);
    expect(defaultRows.every(r => r.runAt.toISOString() === '2026-11-02T09:00:00.000Z')).toBe(true);
    expect(disabledRows.every(r => r.runAt.toISOString() === '2026-11-02T08:00:00.000Z')).toBe(true);
    expect(defaultRows[0]!.detail.requestProfile).toEqual(requestProfileIdentity(DEFAULT_REQUEST_PROFILE));
    expect(disabledRows[0]!.detail.requestProfile).toEqual(requestProfileIdentity(THINKING_DISABLED_PROFILE));
    const forged = withProfile(THINKING_DISABLED_PROFILE, '2026-11-02T10:00:00Z');
    await expect(recordEvaluationRun({ ...forged, models: forged.models.map(m => ({ ...m, requestProfile: { id: THINKING_DISABLED_PROFILE.id, fingerprint: 'forged' } })) })).rejects.toThrow(/provenance/);
    expect((await latestEvaluations()).filter(r => r.model === model)).toHaveLength(latest.length);
  });
});

describe('stored provider provenance', () => {
  it('rejects unlabelled and foreign runs before inserting rows', async () => {
    const source = run('2026-11-02T12:00:00Z', 10);
    await expect(recordEvaluationRun({ ...source, providerIdentity: undefined })).rejects.toThrow(/provider provenance/);
    await expect(recordEvaluationRun({ ...source, providerIdentity: 'https://other.invalid/v1' })).rejects.toThrow(/provider provenance/);
  });

  it('foreign and unlabelled newer rows cannot shadow this provider', async () => {
    const source = run('2026-11-02T12:00:00Z', 10);
    await recordEvaluationRun(source);
    await rawSql(`insert into ai_model_evaluations (model, tier, eval_version, suite, cases_total, cases_passed, score, detail, run_at)
      select model, tier, eval_version, suite, cases_total, 0, 0,
             jsonb_set(detail, '{providerIdentity}', '"https://other.invalid/v1"'::jsonb), '2026-11-03T00:00:00Z'
      from ai_model_evaluations where model = '${MODEL}' and run_at = '2026-11-02T12:00:00Z'`);
    await rawSql(`insert into ai_model_evaluations (model, tier, eval_version, suite, cases_total, cases_passed, score, detail, run_at)
      select model, tier, eval_version, suite, cases_total, 0, 0,
             detail - 'providerIdentity', '2026-11-04T00:00:00Z'
      from ai_model_evaluations where model = '${MODEL}' and run_at = '2026-11-02T12:00:00Z'`);
    const latest = (await latestEvaluations()).filter(r => r.model === MODEL);
    expect(latest).toHaveLength(TIER_SUITES[2].length);
    expect(latest.every(r => r.casesPassed === 10 && r.detail.providerIdentity === source.providerIdentity)).toBe(true);
    expect((await measuredCapabilities())[MODEL]?.scores?.toolCallCorrectness).toBe(1);
  });
});
