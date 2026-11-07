import { afterAll, beforeAll, expect, it } from 'vitest';
import { resetEnvCache } from '@/lib/env';
import { latestEvaluations, measuredCapabilities, recordEvaluationRun } from '@/server/ai-evaluations';
import type { EvalRun } from '@/server/ai/eval/runner';
import { aiModelEvaluations } from '@/server/db/schema';
import { closeHarness, database, truncateAll } from './harness';
import { closeMoneyHarness } from './money-harness';
const BASE = 'https://openrouter.ai/api/v1';
beforeAll(async () => { await truncateAll(); });
afterAll(async () => { await truncateAll(); await closeMoneyHarness(); await closeHarness(); });
async function withOpenRouter(run: () => Promise<void>) {
  const before = { AI_API_KEY: process.env.AI_API_KEY, AI_BASE_URL: process.env.AI_BASE_URL };
  process.env.AI_API_KEY = 'fake-openrouter-test-key'; process.env.AI_BASE_URL = BASE; resetEnvCache();
  try { await run(); }
  finally { for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } resetEnvCache(); }
}
it('refuses recording even an endpoint-matched run and leaves the database unchanged', async () => {
  await withOpenRouter(async () => {
    const run: EvalRun = { providerIdentity: BASE, tier: 1, startedAt: '2026-11-03T08:00:00Z', limit: null, models: [], proposedOrder: [], excluded: [], suiteVersions: {} };
    await expect(recordEvaluationRun(run)).rejects.toThrow(/review-only.*no-record/);
    expect(await database().select().from(aiModelEvaluations)).toEqual([]);
  });
});
it('does not load manually inserted endpoint-only OpenRouter evidence as runtime capabilities', async () => {
  await database().insert(aiModelEvaluations).values({ model: 'synthetic-only', tier: 1, suite: 'parse', evalVersion: 1, casesTotal: 1, casesPassed: 1, score: '1.0000', detail: { providerIdentity: BASE, answered: 1, unanswered: 0, schemaValid: 1, schemaApplicable: 1, toolCallValid: 0, toolCallApplicable: 0, failedCases: [], errors: {} } });
  await withOpenRouter(async () => {
    expect(await latestEvaluations()).toEqual([]); expect(await measuredCapabilities()).toEqual({});
    expect(await database().select().from(aiModelEvaluations)).toHaveLength(1);
  });
});
