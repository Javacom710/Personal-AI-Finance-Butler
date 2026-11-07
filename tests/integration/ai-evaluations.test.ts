import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { evaluationProviderIdentity, latestEvaluations, measuredCapabilities, measuredCapabilitySnapshot, recordEvaluationRun } from '@/server/ai-evaluations';
import { createCapabilityMatrix } from '@/server/ai/config/capabilities';
import { resolveModelConfig } from '@/server/ai/config/models';
import { selectCandidates } from '@/server/ai/orchestrator/select';
import { requirementFor } from '@/server/ai/orchestrator/requirements';
import { createHealthRegistry } from '@/server/ai/orchestrator/breaker';
import { aiRuntime, loadMeasuredCapabilities, resetAiRuntime } from '@/server/ai-runtime';
import { DEFAULT_REQUEST_PROFILE, THINKING_DISABLED_PROFILE, requestProfileIdentity } from '@/server/ai/config/request-profiles';
import { maxTokensFor, MODEL_SUITES, TIER_SUITES, type EvalRun, type ModelSuite } from '@/server/ai/eval/runner';
import type { Tier } from '@/server/ai/config/models';
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

function run(startedAt: string, passed: number, limit: number | null = null, tier: Tier = 2, model = MODEL): EvalRun {
  const report: ModelReport = {
    modelId: model,
    cases: [],
    schemaAdherence: null,
    toolCallCorrectness: null,
    retrievalGrounding: null,
    p50LatencyMs: 800,
    p95LatencyMs: 2000,
  };
  const suites = TIER_SUITES[tier].map((suite: ModelSuite) => {
    const total = MODEL_SUITES[suite].build().length;
    const schema = ['parse', 'classify', 'document'].includes(suite) ? total : 0;
    const tools = ['tool-select', 'injection'].includes(suite) ? total : 0;
    return {
    suite,
    maxTokens: maxTokensFor(tier, suite),
    finishReasons: { stop: 10 },
    version: MODEL_SUITES[suite].version,
    report,
    passed,
    total,
    failedCases: [],
    errors: {},
    counts: { answered: total, unanswered: 0, schemaValid: Math.floor(schema * passed / 10), schemaApplicable: schema, toolCallValid: Math.ceil(tools * passed / 10), toolCallApplicable: tools },
  }; });
  return {
    providerIdentity: evaluationProviderIdentity(aiProviderSettings(env()).baseUrl),
    tier,
    requestTimeoutMs: 45000,
    startedAt,
    limit,
    suiteVersions: {},
    models: [
      {
        modelId: model,
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
  await loadMeasuredCapabilities(async () => ({ declaredTier: {}, byTier: {} }));
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
    expect(measured[MODEL]).toMatchObject({ source: 'measured', scores: { toolCallCorrectness: 50 / 55 } });
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

describe('stored tier provenance', () => {
  it('preserves latest histories per tier without allowing newer Tier 2 rows to shadow Tier 1', async () => {
    const model = 'openai/gpt-oss-120b';
    await recordEvaluationRun(run('2026-11-05T01:00:00Z', 10, null, 1, model));
    await recordEvaluationRun(run('2026-11-06T01:00:00Z', 0, null, 2, model));
    const latest = (await latestEvaluations()).filter(r => r.model === model);
    expect(latest.filter(r => r.tier === 1)).toHaveLength(TIER_SUITES[1].length);
    expect(latest.filter(r => r.tier === 2)).toHaveLength(TIER_SUITES[2].length);
    expect((await measuredCapabilities())[model]).toMatchObject({ tier: 1, source: 'measured', scores: { toolCallCorrectness: 1 } });
  });

  it('does not let Tier 3 certify a Tier 2 model or override its lower Tier 2 score', async () => {
    const model = 'deepseek-ai/deepseek-v4-flash-0731';
    await recordEvaluationRun(run('2026-11-06T02:00:00Z', 10, null, 3, model));
    expect((await measuredCapabilities())[model]).toBeUndefined();
    await recordEvaluationRun(run('2026-11-05T02:00:00Z', 7, null, 2, model));
    const latest = (await latestEvaluations()).filter(r => r.model === model);
    expect(latest).toHaveLength(TIER_SUITES[2].length + TIER_SUITES[3].length);
    expect((await measuredCapabilities())[model]).toMatchObject({ tier: 2, scores: { toolCallCorrectness: 39 / 55 } });
  });
});

describe('independent tier eligibility from stored full measurements', () => {
  function completeRun(tier: Tier, good: boolean, startedAt: string): EvalRun {
    const source = run(startedAt, 0, null, tier, 'openai/gpt-oss-120b');
    return { ...source, models: source.models.map(model => ({ ...model, suites: model.suites.map(s => {
      const n = s.total;
      const schema = ['parse', 'classify', 'document'].includes(s.suite) ? n : 0;
      const tools = ['tool-select', 'injection'].includes(s.suite) ? n : 0;
      return { ...s, passed: good ? n : 0, failedCases: good ? [] : MODEL_SUITES[s.suite].build().map(c => c.id),
        counts: { answered: n, unanswered: 0, schemaApplicable: schema, schemaValid: good ? schema : 0, toolCallApplicable: tools, toolCallValid: good ? tools : 0 } };
    }) })) };
  }

  it('loads and selects Tier 2 independently while the same model fails Tier 1', async () => {
    const model = 'openai/gpt-oss-120b';
    await recordEvaluationRun(completeRun(1, false, '2026-11-07T01:00:00Z'));
    await recordEvaluationRun(completeRun(2, true, '2026-11-07T02:00:00Z'));
    const snapshot = await measuredCapabilitySnapshot();
    expect(snapshot.byTier[model]?.[1]?.scores?.toolCallCorrectness).toBe(0);
    expect(snapshot.byTier[model]?.[2]?.scores?.toolCallCorrectness).toBe(1);
    expect(snapshot.byTier[model]?.[3]).toBeUndefined();
    const matrix = createCapabilityMatrix(snapshot.declaredTier, snapshot.byTier);
    const config = resolveModelConfig({ tier1: model, tier2: model });
    const select = (capability: Parameters<typeof requirementFor>[0]) => selectCandidates(requirementFor(capability), config, matrix, createHealthRegistry(), new Date('2026-11-07'));
    expect(select('analyzePortfolio').candidates).toEqual([model]);
    expect(select('answerFinanceQuestion').candidates).toEqual([]);
    expect(await loadMeasuredCapabilities()).toBeGreaterThan(0);
    expect(() => aiRuntime()).not.toThrow();
  });

  it('does not revive older Tier 2 evidence after a newer incomplete suite', async () => {
    const source = completeRun(2, false, '2026-11-07T03:00:00Z');
    const oneSuite = source.models[0]!.suites[0]!;
    const partial = { ...oneSuite, counts: { ...oneSuite.counts, answered: oneSuite.total - 1 } };
    await recordEvaluationRun({ ...source, models: source.models.map(m => ({ ...m, suites: [partial] })) });
    expect((await measuredCapabilitySnapshot()).byTier['openai/gpt-oss-120b']?.[2]).toBeUndefined();
  });
});
