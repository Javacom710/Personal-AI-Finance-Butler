import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { settings } from '@/server/db/schema';
import {
  aiCapabilityFor,
  checkAiRateLimit,
  isAiEnabled,
  resetAiRateLimits,
  resetAiRuntime,
  runAiCapability,
} from '@/server/ai-runtime';
import { dispatchToolCall } from '@/server/ai/tools/dispatch';
import { allTools } from '@/server/ai/tools/registry';
import { createMemorySink } from '@/server/ai/observability/usage';
import { closeHarness, database, truncateAll } from './harness';
import {
  categoryId,
  closeMoneyHarness,
  makeAccount,
  record,
  setupMoneyFixture,
  type MoneyFixture,
} from './money-harness';

/**
 * Invariant **I-58** — *the kill switch, the rate limiter and user isolation are
 * deterministic server-side controls* ([AI-SYSTEM.md §15](../../docs/AI-SYSTEM.md),
 * `SECURITY.md` §8).
 *
 * These are the properties that cannot be tested without a database, because
 * each of them is enforced by real data: `settings.ai_enabled`, a real session's
 * `userId`, and services that filter on it.
 *
 * The most important assertion here is the simplest: with AI disabled, **no
 * provider call is constructed at all**. Not attempted and discarded — never
 * built. A kill switch that merely throws away a response has still sent the
 * data.
 */

let alice: MoneyFixture;
let bob: MoneyFixture;

beforeAll(async () => {
  await truncateAll();
  alice = await setupMoneyFixture({ now: new Date('2026-08-30T12:00:00Z') });
  bob = await setupMoneyFixture({ now: new Date('2026-08-30T12:00:00Z') });

  const aliceAccount = await makeAccount(alice.ctx, {
    name: 'Alice HDFC',
    openingBalance: '100000',
    openingDate: '2026-08-01',
  });
  await record(alice.ctx, {
    kind: 'expense',
    accountId: aliceAccount,
    categoryId: await categoryId(alice.ctx, 'Groceries'),
    amount: '2500',
    bookedOn: '2026-08-10',
    description: 'Alice groceries',
  });

  const bobAccount = await makeAccount(bob.ctx, {
    name: 'Bob ICICI',
    openingBalance: '7000',
    openingDate: '2026-08-01',
  });
  await record(bob.ctx, {
    kind: 'expense',
    accountId: bobAccount,
    categoryId: await categoryId(bob.ctx, 'Dining'),
    amount: '900',
    bookedOn: '2026-08-11',
    description: 'Bob dinner',
  });
}, 120_000);

afterAll(async () => {
  await closeMoneyHarness();
  await closeHarness();
});

async function setAiEnabled(userId: string, enabled: boolean): Promise<void> {
  await database().update(settings).set({ aiEnabled: enabled }).where(eq(settings.userId, userId));
}

describe('I-58 — the kill switch is real', () => {
  it('reads settings.ai_enabled rather than assuming', async () => {
    await setAiEnabled(alice.userId, true);
    expect(await isAiEnabled(alice.userId)).toBe(true);
    await setAiEnabled(alice.userId, false);
    expect(await isAiEnabled(alice.userId)).toBe(false);
  });

  it('fails closed for a user with no settings row', async () => {
    // A kill switch that fails open is not a kill switch.
    expect(await isAiEnabled('00000000-0000-0000-0000-000000000000')).toBe(false);
  });

  it('produces zero egress when disabled — no provider call is constructed', async () => {
    await setAiEnabled(alice.userId, false);
    resetAiRuntime();
    resetAiRateLimits();
    const sink = createMemorySink();

    const result = await runAiCapability({
      read: alice.ctx,
      input: { capability: 'summarizeFinancialData', messages: [{ role: 'user', content: 'hi' }], withTools: true },
      sink,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('refused');
      if (result.error.kind === 'refused') expect(result.error.reason).toBe('ai_disabled');
    }
    // Recorded as a refusal, so the switch is observable rather than silent.
    expect(sink.entries()[0]?.outcome).toBe('refused');
    expect(sink.entries()[0]?.modelId).toBeNull();
  });

  it('leaves every other feature working while disabled', async () => {
    // The other half of the requirement: disabling AI must not degrade the
    // application. The capability still reads; only the model is unreachable.
    await setAiEnabled(alice.userId, false);
    const ai = aiCapabilityFor(alice.ctx);
    const outcome = await dispatchToolCall(ai, { id: 'c', name: 'get_accounts', argumentsJson: '{}' });
    expect(outcome.failed).toBe(false);
  });
});

describe('I-58 — rate limiting', () => {
  it('admits up to the limit and then refuses, without calling out', () => {
    resetAiRateLimits();
    const now = new Date('2026-08-30T12:00:00Z');
    for (let i = 0; i < 3; i += 1) {
      expect(checkAiRateLimit('u', now, 3)).toBe(true);
    }
    expect(checkAiRateLimit('u', now, 3)).toBe(false);
  });

  it('opens a fresh window after a minute', () => {
    resetAiRateLimits();
    const now = new Date('2026-08-30T12:00:00Z');
    expect(checkAiRateLimit('u', now, 1)).toBe(true);
    expect(checkAiRateLimit('u', now, 1)).toBe(false);
    expect(checkAiRateLimit('u', new Date(now.getTime() + 60_001), 1)).toBe(true);
  });

  it('counts per user, so one user cannot exhaust another', () => {
    resetAiRateLimits();
    const now = new Date('2026-08-30T12:00:00Z');
    expect(checkAiRateLimit('alice', now, 1)).toBe(true);
    expect(checkAiRateLimit('alice', now, 1)).toBe(false);
    expect(checkAiRateLimit('bob', now, 1)).toBe(true);
  });
});

describe('I-58 — user isolation is enforced by the capability, not by arguments', () => {
  it('returns only the calling user’s accounts', async () => {
    const aliceView = await dispatchToolCall(aiCapabilityFor(alice.ctx), {
      id: 'c',
      name: 'get_accounts',
      argumentsJson: '{}',
    });
    const bobView = await dispatchToolCall(aiCapabilityFor(bob.ctx), {
      id: 'c',
      name: 'get_accounts',
      argumentsJson: '{}',
    });

    const names = (o: typeof aliceView) => JSON.stringify(o.result);
    expect(names(aliceView)).toContain('Alice HDFC');
    expect(names(aliceView)).not.toContain('Bob ICICI');
    expect(names(bobView)).toContain('Bob ICICI');
    expect(names(bobView)).not.toContain('Alice HDFC');
  });

  it('cannot be redirected by an argument, because there is none to supply', async () => {
    // Every spelling a model might try. Each is refused by the schema before a
    // handler runs — `.strict()` rejects the field rather than ignoring it.
    for (const attempt of [
      '{"userId":"' + bob.userId + '"}',
      '{"user_id":"' + bob.userId + '"}',
      '{"asOf":"2026-08-30","userId":"' + bob.userId + '"}',
    ]) {
      const outcome = await dispatchToolCall(aiCapabilityFor(alice.ctx), {
        id: 'c',
        name: 'get_accounts',
        argumentsJson: attempt,
      });
      expect(outcome.failed, attempt).toBe(true);
      expect(JSON.stringify(outcome.result)).not.toContain('Bob ICICI');
    }
  });

  it('keeps every tool inside the caller’s data', async () => {
    // Swept across the whole registry rather than spot-checked: isolation that
    // holds for one tool and not another is not isolation.
    const ai = aiCapabilityFor(alice.ctx);
    for (const tool of allTools()) {
      const args = tool.name === 'get_net_worth_history' ? '{"dates":["2026-08-30"]}' : '{}';
      const outcome = await dispatchToolCall(ai, { id: 'c', name: tool.name, argumentsJson: args });
      expect(JSON.stringify(outcome.result), tool.name).not.toContain('Bob ICICI');
      expect(JSON.stringify(outcome.result), tool.name).not.toContain('Bob dinner');
    }
  }, 60_000);
});

describe('I-58 — tool results are projected, never raw', () => {
  it('emits no bigint and no JSON number for a figure', async () => {
    const outcome = await dispatchToolCall(aiCapabilityFor(alice.ctx), {
      id: 'c',
      name: 'get_accounts',
      argumentsJson: '{}',
    });
    const json = JSON.stringify(outcome.result);
    // Figures are tagged digit strings. A bare number here would mean a
    // precision-losing conversion happened somewhere on the way out.
    expect(json).toContain('"kind":"money"');
    expect(json).not.toMatch(/"amount":\s*-?\d/);
  });

  it('carries the breakdown contract to the model', async () => {
    const outcome = await dispatchToolCall(aiCapabilityFor(alice.ctx), {
      id: 'c',
      name: 'get_expense_summary',
      argumentsJson: '{"asOf":"2026-08-10"}',
    });
    const result = outcome.result as { ok: boolean; data: { additivity: string; total: unknown } };
    expect(result.ok).toBe(true);
    // Both travel, always: the authoritative total so the model never adds, and
    // the additivity flag so it knows whether it could (ADR-37).
    expect(result.data.additivity).toBe('partition');
    expect(result.data.total).toMatchObject({ kind: 'money' });
  });

  it('declares a tag breakdown non-additive', async () => {
    const outcome = await dispatchToolCall(aiCapabilityFor(alice.ctx), {
      id: 'c',
      name: 'get_expense_summary',
      argumentsJson: '{"asOf":"2026-08-10","groupBy":"tag"}',
    });
    const result = outcome.result as { data: { additivity: string } };
    expect(result.data.additivity).toBe('overlapping');
  });

  it('projects a domain error without its entity id', async () => {
    // The residual the adversarial review recorded: a settings error's entity id
    // IS the user id, so a raw DomainError would leak it to a third party.
    const outcome = await dispatchToolCall(aiCapabilityFor(alice.ctx), {
      id: 'c',
      name: 'get_net_worth_history',
      argumentsJson: '{"dates":[]}',
    });
    expect(outcome.failed).toBe(true);
    expect(JSON.stringify(outcome.result)).not.toContain(alice.userId);
  });
});

describe('B-3c — row caps, truncation and the byte budget, through the tool', () => {
  // A user of their own, so the volume here moves nobody else's figures.
  let carol: MoneyFixture;
  const COUNT = 205;
  // 400 rupee signs is the longest description the schema allows, and 1,200
  // bytes on the wire: enough that a full page of 200 rows crosses the budget.
  const HEAVY = '₹'.repeat(400);

  beforeAll(async () => {
    carol = await setupMoneyFixture({ now: new Date('2026-08-30T12:00:00Z') });
    const account = await makeAccount(carol.ctx, {
      name: 'Carol SBI',
      openingBalance: '1000000',
      openingDate: '2026-01-01',
    });
    const groceries = await categoryId(carol.ctx, 'Groceries');
    for (let i = 0; i < COUNT; i += 1) {
      await record(carol.ctx, {
        kind: 'expense',
        accountId: account,
        categoryId: groceries,
        amount: '10',
        bookedOn: '2026-08-01',
        description: HEAVY,
      });
    }
  }, 300_000);

  type Page = {
    ok: boolean;
    data: { transactions: unknown[] };
    meta: { rowCount: number; truncated: boolean; totalMatching?: number };
  };
  const page = async (args: string) => {
    const outcome = await dispatchToolCall(aiCapabilityFor(carol.ctx), {
      id: 'c',
      name: 'get_transactions',
      argumentsJson: args,
    });
    return { outcome, result: outcome.result as Page };
  };

  it('returns the default page and says there is more', async () => {
    const { outcome, result } = await page('{}');
    expect(outcome.failed).toBe(false);
    expect(result.meta.rowCount).toBe(50);
    expect(result.data.transactions).toHaveLength(50);
    expect(result.meta.truncated).toBe(true);
    expect(result.meta.totalMatching).toBe(COUNT);
  });

  it('honours a small limit', async () => {
    const { result } = await page('{"limit":5}');
    expect(result.data.transactions).toHaveLength(5);
    expect(result.meta.truncated).toBe(true);
  });

  it('refuses a limit above the maximum before any query runs', async () => {
    const { outcome } = await page('{"limit":999}');
    expect(outcome.failed).toBe(true);
  });

  it('clips a full page at the byte budget, flags it, and still fits the wire', async () => {
    const { outcome, result } = await page('{"limit":200}');
    expect(outcome.failed).toBe(false);
    expect(result.meta.truncated).toBe(true);
    expect(result.meta.rowCount).toBeGreaterThan(0);
    expect(result.meta.rowCount).toBeLessThan(200);
    expect(result.meta.rowCount).toBe(result.data.transactions.length);
    expect(Buffer.byteLength(JSON.stringify(result.data.transactions), 'utf8')).toBeLessThanOrEqual(150 * 1024 + 2);
  });
}, 300_000);
