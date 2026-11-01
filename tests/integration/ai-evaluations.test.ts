import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { latestEvaluations, measuredCapabilities, recordEvaluationRun } from '@/server/ai-evaluations';
import { aiRuntime, loadMeasuredCapabilities, resetAiRuntime } from '@/server/ai-runtime';
import { MODEL_SUITES, TIER_SUITES, type EvalRun, type ModelSuite } from '@/server/ai/eval/runner';
import type { ModelReport } from '@/server/ai/eval/harness';
import { closeHarness, truncateAll } from './harness';
import { rawSql, closeMoneyHarness } from './money-harness';

/**
 * `ai_model_evaluations` end to end (ADR-44): a run is stored, the latest rows
 * per model and suite are read back, and the runtime loads them as measured
 * capability entries. No provider is called: the run is built here.
 */

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
    version: MODEL_SUITES[suite].version,
    report,
    passed,
    total: 10,
    failedCases: [],
    errors: {},
    counts: { answered: 10, unanswered: 0, schemaValid: 0, schemaApplicable: 0, toolCallValid: passed, toolCallApplicable: 10 },
  }));
  return {
    tier: 2,
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
});
