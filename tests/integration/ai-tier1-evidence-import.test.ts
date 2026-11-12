import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import type * as Runner from '@/server/ai/eval/runner';
import { eq } from 'drizzle-orm';
import { resetEnvCache } from '@/lib/env';
import { closeDb, db } from '@/server/db/client';
import { aiModelEvaluations } from '@/server/db/schema';
import { evaluationRowsForRun, measuredCapabilitySnapshot } from '@/server/ai-evaluations';
import { isTier1GenerationReleased } from '@/server/ai-feature-release';
import { prepareTier1Evidence } from '../../scripts/lib/tier1-evidence';
import { recordTier1Evidence } from '../../scripts/lib/record-tier1-evidence';
import { retainedTier1Evidence } from '../helpers/tier1-evidence';
import { closeHarness, truncateAll } from './harness';
import { closeMoneyHarness, rawSql } from './money-harness';

// OD-21 advanced grounding and robustness to v6, so the retained parse-v4
// campaign is no longer current evidence. These tests exercise mechanics with
// that campaign under the contract it was reviewed against (v5); the unit test
// ai-approved-lineup-evidence asserts that the current contracts refuse it.
vi.mock('@/server/ai/eval/runner', async (importOriginal) => {
  const original = await importOriginal<typeof Runner>();
  const suites = original.MODEL_SUITES;
  return {
    ...original,
    MODEL_SUITES: { ...suites, grounding: { ...suites.grounding, version: 5 }, robustness: { ...suites.robustness, version: 5 } },
  };
});

const files = retainedTier1Evidence();
const prepared = prepareTier1Evidence(files);
const names = ['AI_API_KEY', 'AI_BASE_URL', 'AI_TIER1_MODELS', 'AI_REQUEST_PROFILES'] as const;
const original = Object.fromEntries(names.map(name => [name, process.env[name]]));
const rows = () => db().select().from(aiModelEvaluations);
beforeEach(async () => {
  await truncateAll();
  process.env['AI_API_KEY'] = 'offline-evidence-key';
  process.env['AI_BASE_URL'] = 'https://api.deepinfra.com/v1/openai';
  process.env['AI_TIER1_MODELS'] = 'zai-org/GLM-5.3-Flash,openai/gpt-oss-120b';
  process.env['AI_REQUEST_PROFILES'] = ''; resetEnvCache();
});
afterAll(async () => {
  await truncateAll();
  for (const name of names) { const value = original[name]; if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  resetEnvCache(); await closeMoneyHarness(); await closeHarness(); await closeDb();
});
it('records the complete retained batch only in the disposable test DB and is idempotent without releasing generation', async () => {
  expect(await recordTier1Evidence(files, prepared.preview.digest)).toMatchObject({ status: 'recorded', insertedRows: 12 });
  const stored = await rows(); expect(stored).toHaveLength(12);
  expect(await recordTier1Evidence(files, prepared.preview.digest)).toMatchObject({ status: 'already_recorded', insertedRows: 0 });
  expect(await rows()).toEqual(stored);
  const measured = await measuredCapabilitySnapshot();
  expect(Object.keys(measured.byTier).sort()).toEqual(['openai/gpt-oss-120b', 'zai-org/GLM-5.3-Flash']);
  expect(Object.values(measured.byTier).every(tiers => Object.keys(tiers).join(',') === '1')).toBe(true);
  expect(measured.byTier['zai-org/GLM-5.3-Flash']?.[1]?.scores?.toolCallCorrectness).toBe(54 / 57);
  expect(isTier1GenerationReleased()).toBe(false);
});
it('serializes concurrent duplicate imports into one batch and one no-op', async () => {
  const results = await Promise.all([recordTier1Evidence(files, prepared.preview.digest), recordTier1Evidence(files, prepared.preview.digest)]);
  expect(results.map(r => r.status).sort()).toEqual(['already_recorded', 'recorded']); expect(await rows()).toHaveLength(12);
});
it('refuses a changed byte digest before inserting anything', async () => {
  const changed = { ...files, 'tier1.json': files['tier1.json']! + '\n' };
  await expect(recordTier1Evidence(changed, prepared.preview.digest)).rejects.toThrow('digest'); expect(await rows()).toEqual([]);
});
it.each([
  ['endpoint', 'AI_BASE_URL', 'https://api.groq.com/openai/v1'],
  ['model order', 'AI_TIER1_MODELS', 'openai/gpt-oss-120b,zai-org/GLM-5.3-Flash'],
  ['request profile', 'AI_REQUEST_PROFILES', '{"zai-org/GLM-5.3-Flash":"unknown-profile"}'],
] as const)('refuses deployment %s mismatch without writes', async (_name, variable, value) => {
  process.env[variable] = value; resetEnvCache();
  await expect(recordTier1Evidence(files, prepared.preview.digest)).rejects.toThrow(); expect(await rows()).toEqual([]);
});
it('refuses a partial existing batch rather than completing or overwriting it', async () => {
  await db().insert(aiModelEvaluations).values(prepared.rows[0]!); const before = await rows();
  await expect(recordTier1Evidence(files, prepared.preview.digest)).rejects.toThrow('partial'); expect(await rows()).toEqual(before);
});
it('refuses an altered existing batch rather than accepting matching row counts', async () => {
  await recordTier1Evidence(files, prepared.preview.digest);
  const first = (await rows())[0]!; await db().update(aiModelEvaluations).set({ casesPassed: 0 }).where(eq(aiModelEvaluations.id, first.id));
  const before = await rows(); await expect(recordTier1Evidence(files, prepared.preview.digest)).rejects.toThrow('Conflicting'); expect(await rows()).toEqual(before);
});
it('does not revive older evidence when a newer matching row exists', async () => {
  await db().insert(aiModelEvaluations).values({ ...prepared.rows[0]!, runAt: new Date('2026-11-09T00:00:00Z') });
  const before = await rows(); await expect(recordTier1Evidence(files, prepared.preview.digest)).rejects.toThrow('Newer'); expect(await rows()).toEqual(before);
});
it('refuses a foreign-provider collision at the database unique key without replacing it', async () => {
  const foreign = { ...prepared.rows[0]!, detail: { ...prepared.rows[0]!.detail, providerIdentity: 'https://api.groq.com/openai/v1' } };
  await db().insert(aiModelEvaluations).values(foreign); const before = await rows();
  await expect(recordTier1Evidence(files, prepared.preview.digest)).rejects.toThrow('Conflicting'); expect(await rows()).toEqual(before);
});
it('does not pool newer other-provider evidence into the current import', async () => {
  await db().insert(aiModelEvaluations).values({ ...prepared.rows[0]!, runAt: new Date('2026-11-09T00:00:00Z'), detail: { ...prepared.rows[0]!.detail, providerIdentity: 'https://api.groq.com/openai/v1' } });
  expect(await recordTier1Evidence(files, prepared.preview.digest)).toMatchObject({ status: 'recorded', insertedRows: 12 }); expect(await rows()).toHaveLength(13);
});
it('rolls the entire import back on a database failure at the last suite', async () => {
  await rawSql(`create function test_refuse_last_evidence() returns trigger language plpgsql as $$ begin if new.model = 'openai/gpt-oss-120b' and new.suite = 'injection' then raise exception 'test forced final-row failure'; end if; return new; end $$`);
  try {
    await rawSql('create trigger test_refuse_last_evidence before insert on ai_model_evaluations for each row execute function test_refuse_last_evidence()');
    await expect(recordTier1Evidence(files, prepared.preview.digest)).rejects.toMatchObject({ cause: { message: 'test forced final-row failure' } }); expect(await rows()).toEqual([]);
  } finally { await rawSql('drop trigger if exists test_refuse_last_evidence on ai_model_evaluations'); await rawSql('drop function test_refuse_last_evidence()'); }
});
it('uses the normal recording row encoder without changing retained timestamps or provenance', () => {
  expect(evaluationRowsForRun(prepared.run, prepared.run.providerIdentity!)).toEqual(prepared.rows);
  expect(prepared.rows.every(r => r.runAt.toISOString() === prepared.run.startedAt && r.detail.requestTimeoutMs === 60000)).toBe(true);
});
