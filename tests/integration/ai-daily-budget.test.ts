import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { resetEnvCache } from '@/lib/env';
import { aiUsageDaily, settings } from '@/server/db/schema';
import { err, ok } from '@/lib/result';
import { transport } from '@/server/ai/errors';
import type { AiProvider, ChatRequest } from '@/server/ai/provider/types';
import {
  aiUsageDayFor,
  dailyAiUsage,
  markDailyFallback,
  meterProvider,
  recordDailyAiUsage,
  withMetering,
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

describe('B-3a — every call to the provider is counted, not every run', () => {
  // A provider that fails `failures` times, then answers with fixed usage — the
  // shape of a fallback chain, without the network.
  const fakeProvider = (failures: number): AiProvider => {
    let calls = 0;
    return {
      key: 'fake',
      isConfigured: () => true,
      listModels: async () => ok([]),
      chat: async (request: ChatRequest) => {
        calls += 1;
        if (calls <= failures) return err(transport('down', 503));
        return ok({
          content: 'ok',
          toolCalls: [],
          reasoning: null,
          finishReason: 'stop',
          usage: { promptTokens: 40, completionTokens: 2 },
          model: request.model,
          latencyMs: 1,
        });
      },
    } as AiProvider;
  };
  const ask = (provider: AiProvider, model: string) =>
    provider.chat({ model, messages: [{ role: 'user', content: 'hi' }], maxTokens: 8, timeoutMs: 1000 });

  afterAll(async () => {
    await database().delete(aiUsageDaily);
  });

  it('charges each attempt of a fallback chain, with its own model and tokens', async () => {
    const provider = meterProvider(fakeProvider(2));
    await withMetering({ userId: alice.userId, day: '2026-02-01', tier: 1 }, async () => {
      await ask(provider, 'first');
      await ask(provider, 'second');
      await ask(provider, 'third');
    });
    expect(await dailyAiUsage(alice.userId, '2026-02-01')).toEqual({ requests: 3, tokens: 42 });
    const rows = await database().select().from(aiUsageDaily).where(eq(aiUsageDaily.day, '2026-02-01'));
    const byModel = Object.fromEntries(rows.map((r) => [r.model, r]));
    expect(byModel['first']).toMatchObject({ requests: 1, failures: 1, promptTokens: 0 });
    expect(byModel['second']).toMatchObject({ requests: 1, failures: 1 });
    expect(byModel['third']).toMatchObject({ requests: 1, failures: 0, promptTokens: 40, completionTokens: 2 });

    await markDailyFallback(alice.userId, '2026-02-01', 1, 'third');
    const [third] = await database().select().from(aiUsageDaily).where(eq(aiUsageDaily.model, 'third'));
    expect(third).toMatchObject({ requests: 1, fallbackRequests: 1 });
  });

  it('charges nothing for a call made outside a metered run', async () => {
    const provider = meterProvider(fakeProvider(0));
    await ask(provider, 'unmetered');
    const rows = await database().select().from(aiUsageDaily).where(eq(aiUsageDaily.model, 'unmetered'));
    expect(rows).toEqual([]);
  });

  it('charges nothing for a run refused before any call', async () => {
    resetAiRateLimits();
    await setAiEnabled(alice.userId, false);
    await runAiCapability({
      read: alice.ctx,
      input: { capability: 'summarizeFinancialData', messages: [{ role: 'user', content: 'hi' }] },
      sink: createMemorySink(),
      now: () => new Date('2026-03-01T12:00:00Z'),
    });
    expect(await dailyAiUsage(alice.userId, '2026-03-01')).toEqual({ requests: 0, tokens: 0 });
  });
});
