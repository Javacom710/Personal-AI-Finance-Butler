import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { resetEnvCache } from '@/lib/env';
import { aiUsageDaily, settings } from '@/server/db/schema';
import {
  aiUsageDayFor,
  dailyAiUsage,
  recordDailyAiUsage,
  resetAiRateLimits,
  resetAiRuntime,
  runAiCapability,
} from '@/server/ai-runtime';
import { createMemorySink } from '@/server/ai/observability/usage';
import { closeHarness, database, truncateAll } from './harness';
import { closeMoneyHarness, setupMoneyFixture, type MoneyFixture } from './money-harness';

/**
 * Finding **B-3a** — ROADMAP Phase 7: *"Daily budget is checked **before** the
 * request"*. Decided 2026-10-26: the count lives in `ai_usage_daily`, so a
 * restart cannot reset it.
 */

let alice: MoneyFixture;
let bob: MoneyFixture;

beforeAll(async () => {
  await truncateAll();
  alice = await setupMoneyFixture({ now: new Date('2026-08-30T12:00:00Z') });
  bob = await setupMoneyFixture({ now: new Date('2026-08-30T12:00:00Z') });
}, 120_000);

afterAll(async () => {
  await closeMoneyHarness();
  await closeHarness();
});

async function setAiEnabled(userId: string, enabled: boolean): Promise<void> {
  await database().update(settings).set({ aiEnabled: enabled }).where(eq(settings.userId, userId));
}

describe('B-3a — the daily budget is checked before the request, from a table', () => {
  const NOW = new Date('2026-08-30T12:00:00Z');
  const run = () =>
    runAiCapability({
      read: alice.ctx,
      input: { capability: 'summarizeFinancialData', messages: [{ role: 'user', content: 'hi' }] },
      sink: createMemorySink(),
      now: () => NOW,
    });
  const reasonOf = (result: Awaited<ReturnType<typeof run>>) =>
    !result.ok && result.error.kind === 'refused' ? result.error.reason : result.ok ? 'ok' : result.error.kind;

  // The 'room left' cases rely on the next gate refusing for want of a key, so
  // the key is removed for this block: with one configured (a developer's
  // .env), they would otherwise send a real request.
  const savedKey = process.env['NVIDIA_API_KEY'];
  beforeAll(async () => {
    delete process.env['NVIDIA_API_KEY'];
    resetEnvCache();
    resetAiRuntime();
    await setAiEnabled(alice.userId, true);
  });
  afterAll(async () => {
    if (savedKey !== undefined) process.env['NVIDIA_API_KEY'] = savedKey;
    resetEnvCache();
    resetAiRuntime();
    await database().delete(aiUsageDaily);
    await setAiEnabled(alice.userId, false);
  });

  it('counts the day in the user\'s own timezone', async () => {
    // 20:00 UTC on the 30th is already the 31st in Asia/Kolkata.
    expect(await aiUsageDayFor(alice.userId, new Date('2026-08-30T20:00:00Z'))).toBe('2026-08-31');
    expect(await aiUsageDayFor('00000000-0000-0000-0000-000000000000', NOW)).toBeNull();
  });

  it('adds every request to one ledger row per day, tier and model', async () => {
    const base = { userId: alice.userId, day: '2026-01-01', tier: 1, model: 'm', fallback: false };
    await recordDailyAiUsage({ ...base, failed: false, promptTokens: 100, completionTokens: 20 });
    await recordDailyAiUsage({ ...base, failed: true, promptTokens: 5, completionTokens: 0 });
    expect(await dailyAiUsage(alice.userId, '2026-01-01')).toEqual({ requests: 2, tokens: 125 });
    const rows = await database().select().from(aiUsageDaily).where(eq(aiUsageDaily.day, '2026-01-01'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ requests: 2, failures: 1, promptTokens: 105, completionTokens: 20 });
    // Another user's usage is theirs alone.
    expect(await dailyAiUsage(bob.userId, '2026-01-01')).toEqual({ requests: 0, tokens: 0 });
  });

  it('lets a request through while the day has room', async () => {
    resetAiRateLimits();
    resetAiRuntime();
    // No key in the test environment, so the next gate refuses — which proves
    // the budget let it pass.
    expect(reasonOf(await run())).toBe('unsupported_capability');
  });

  it('refuses before any request exists once the request limit is reached', async () => {
    resetAiRateLimits();
    await database().insert(aiUsageDaily).values({
      userId: alice.userId,
      day: '2026-08-30',
      tier: 1,
      model: 'm',
      requests: 200,
    });
    expect(reasonOf(await run())).toBe('daily_budget');
    await database().delete(aiUsageDaily).where(eq(aiUsageDaily.day, '2026-08-30'));
  });

  it('refuses once the token limit is reached, whatever the request count', async () => {
    resetAiRateLimits();
    await database().insert(aiUsageDaily).values({
      userId: alice.userId,
      day: '2026-08-30',
      tier: 2,
      model: 'm',
      requests: 1,
      promptTokens: 999_990,
      completionTokens: 10,
    });
    expect(reasonOf(await run())).toBe('daily_budget');
    await database().delete(aiUsageDaily).where(eq(aiUsageDaily.day, '2026-08-30'));
  });

  it('opens again on the next day', async () => {
    resetAiRateLimits();
    await database().insert(aiUsageDaily).values({
      userId: alice.userId,
      day: '2026-08-29',
      tier: 1,
      model: 'm',
      requests: 10_000,
    });
    expect(reasonOf(await run())).toBe('unsupported_capability');
  });
});
