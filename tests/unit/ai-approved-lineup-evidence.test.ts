import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { tierCapabilitiesFromEvaluations, type StoredEvaluation } from '@/server/ai-evaluations';
import { createCapabilityMatrix, DECLARED_CAPABILITIES } from '@/server/ai/config/capabilities';
import { resolveModelConfig } from '@/server/ai/config/models';
import { requirementFor } from '@/server/ai/orchestrator/requirements';
import { selectCandidates } from '@/server/ai/orchestrator/select';
import { createHealthRegistry } from '@/server/ai/orchestrator/breaker';
import type { SuiteCounts } from '@/server/ai/eval/runner';
import type { RequestProfileIdentity } from '@/server/ai/config/request-profiles';

const endpoint = 'https://api.deepinfra.com/v1/openai';
interface ArchivedRun {
  tier: number;
  startedAt: string;
  providerIdentity: string;
  models: { modelId: string; requestProfile: RequestProfileIdentity; suites: {
    suite: string; version: number; passed: number; maxTokens: number;
    p50LatencyMs: number; p95LatencyMs: number; counts: SuiteCounts; failedCases: string[]; errors: Record<string, number>;
  }[] }[];
}
function archivedRows(file: string): StoredEvaluation[] {
  const run: ArchivedRun = JSON.parse(readFileSync(new URL(`../../eval/reports/${file}`, import.meta.url), 'utf8'));
  return run.models.flatMap(model => model.suites.map(suite => ({
    model: model.modelId, tier: run.tier, suite: suite.suite, evalVersion: suite.version,
    casesPassed: suite.passed, p50LatencyMs: suite.p50LatencyMs, p95LatencyMs: suite.p95LatencyMs, runAt: new Date(run.startedAt),
    detail: { ...suite.counts, failedCases: suite.failedCases, errors: suite.errors,
      providerIdentity: run.providerIdentity, requestProfile: model.requestProfile, maxTokens: suite.maxTokens },
  })));
}
it('retains the selected order as policy without treating historical scores as current qualification', () => {
  const config = resolveModelConfig();
  expect(config.candidates(1)).toEqual(['zai-org/GLM-5.3-Flash', 'openai/gpt-oss-120b']);
  for (const tier of [2, 3, 4, 5] as const) expect(config.candidates(tier)).toEqual([]);
  expect(DECLARED_CAPABILITIES['zai-org/GLM-5.3-Flash']).toMatchObject({ tier: 1, source: 'declared', streaming: false });
  const rows = archivedRows('2026-11-07T15-26-03-tier1.json');
  expect(rows.every(row => row.detail.unanswered === 0)).toBe(true);
  expect(rows.every(row => row.detail.providerIdentity === endpoint)).toBe(true);
  // This is the actual historical passing GLM report, not a failing fake score.
  const applicable = rows.reduce((n, r) => n + r.detail.toolCallApplicable, 0);
  const valid = rows.reduce((n, r) => n + r.detail.toolCallValid, 0);
  expect(valid / applicable).toBeGreaterThanOrEqual(0.90);
  const measured = tierCapabilitiesFromEvaluations(rows, undefined, undefined, endpoint);
  expect(measured).toEqual({});
  const selected = selectCandidates(requirementFor('answerFinanceQuestion'), config, createCapabilityMatrix({}, measured), createHealthRegistry(), new Date('2026-11-07T17:00:00Z'));
  expect(selected.candidates).toEqual([]);
});

it.each([
  { model: 'zai-org/GLM-5.3-Flash', validTools: 54 },
  { model: 'openai/gpt-oss-120b', validTools: 53 },
])('loads fresh parse-v3 evidence for $model in memory without granting another tier', ({ model, validTools }) => {
  const rows = archivedRows('deepinfra-2026-11-07-tier1-parse-v3-2026-11-08/tier1.json')
    .filter(row => row.model === model);
  expect(rows).toHaveLength(6);
  expect(rows.find(row => row.suite === 'parse')?.evalVersion).toBe(3);
  expect(rows.every(row => row.detail.unanswered === 0)).toBe(true);
  const measured = tierCapabilitiesFromEvaluations(rows, undefined, undefined, endpoint);
  expect(measured[model]?.[1]).toMatchObject({ source: 'measured',
    scores: { schemaAdherence: 1, toolCallCorrectness: validTools / 57 } });
  expect(Object.keys(measured[model]!)).toEqual(['1']);
  const selected = selectCandidates(requirementFor('answerFinanceQuestion'), resolveModelConfig(),
    createCapabilityMatrix({}, measured), createHealthRegistry(), rows[0]!.runAt);
  expect(selected.candidates).toEqual([model]);
});
it('cannot certify the fallback from its archived answered-only pass with unanswered cases', () => {
  const rows = archivedRows('2026-11-07T15-26-06-tier1.json');
  expect(rows.reduce((n, r) => n + r.detail.unanswered, 0)).toBe(2);
  expect(tierCapabilitiesFromEvaluations(rows, undefined, undefined, endpoint)).toEqual({});
});

it.each(['zai-org/GLM-5.3-Flash', 'openai/gpt-oss-120b'])(
  'rejects %s from the previous passing full campaign after the parse prompt changes', (model) => {
  const rows = archivedRows('deepinfra-2026-11-07-tier1-current-2026-11-08/tier1.json')
    .filter(row => row.model === model);
  expect(rows).toHaveLength(6);
  expect(rows.every(row => row.detail.unanswered === 0)).toBe(true);
  const measured = tierCapabilitiesFromEvaluations(rows, undefined, undefined, endpoint);
  expect(rows.find(row => row.suite === 'parse')?.evalVersion).toBe(2);
  expect(measured).toEqual({});
  const selected = selectCandidates(requirementFor('answerFinanceQuestion'), resolveModelConfig(),
    createCapabilityMatrix({}, measured), createHealthRegistry(), rows[0]!.runAt);
  expect(selected.candidates).toEqual([]);
});
