/**
 * ARCHITECTURE.md §9 performance targets on a seeded five-year history.
 *
 *   BENCH=1 npx vitest run --project bench
 *
 * Seeds through the real application services, then times the exact service
 * calls each screen makes. The Overview row repeats `app/(app)/page.tsx`'s two
 * `Promise.all` waves, so it is the page's server data time without rendering.
 * Each figure is the median of nine runs after one warm-up.
 *
 * The history is larger than the target user's: ~3,800 money transactions,
 * ~800 investment transactions across 12 instruments with five years of
 * month-end and recent daily prices, one instrument left unpriced (OD-21's
 * path), budgets and a recurring rule.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';

import { addDays, isoDate, type IsoDate } from '@/lib/date';
import { periodContaining } from '@/lib/date/periods';
import {
  assetAllocation,
  listAccounts,
  listBudgetStatuses,
  listInstruments,
  listTransactions,
  netWorthAsOf,
  netWorthChange,
  netWorthReconciliation,
  netWorthSeries,
  periodSummary,
  portfolio,
  upcomingCommitments,
} from '@/server/services';
import { closeHarness, truncateAll } from '../integration/harness';
import {
  categoryId,
  closeMoneyHarness,
  makeAccount,
  record,
  refreshCtx,
  setupMoneyFixture,
  transfer,
  type MoneyFixture,
} from '../integration/money-harness';
import { makeInstrument, recordBuy, recordDividend, recordSell, storeClose } from '../integration/investment-harness';
import type { RequestCtx } from '@/server/services/_ctx';

const NOW = new Date('2026-11-12T06:00:00Z');
const MONTHS = 60;
let fixture: MoneyFixture;
let ctx: RequestCtx;
const results: { operation: string; targetMs: number; medianMs: number }[] = [];

/** Deterministic pseudo-random amounts, so two runs seed the same history. */
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const amount = (lo: number, hi: number) => (lo + rand() * (hi - lo)).toFixed(2);
const monthStart = (i: number): IsoDate => {
  const d = new Date(Date.UTC(2021, 11 + i, 1));
  return isoDate(d.toISOString().slice(0, 10));
};
const monthEnd = (i: number): IsoDate => addDays(monthStart(i + 1), -1);

async function median(fn: () => Promise<unknown>): Promise<number> {
  await fn();
  const times: number[] = [];
  for (let i = 0; i < 9; i++) {
    const t = performance.now();
    await fn();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  return times[4]!;
}

beforeAll(async () => {
  await truncateAll();
  fixture = await setupMoneyFixture({ now: NOW });
  const c = fixture.ctx;
  const opening = '2021-12-01';
  const bank = await makeAccount(c, { name: 'Salary bank', openingBalance: '200000', openingDate: opening });
  const card = await makeAccount(c, { name: 'Credit card', kind: 'credit_card', openingBalance: '0', openingDate: opening, creditLimit: '300000' });
  const cash = await makeAccount(c, { name: 'Cash', kind: 'cash', openingBalance: '5000', openingDate: opening });
  const broker = await makeAccount(c, { name: 'Brokerage', kind: 'brokerage', openingBalance: '5000000', openingDate: opening });
  const cats = Object.fromEntries(await Promise.all(
    ['Salary', 'Groceries', 'Dining', 'Fuel', 'Rent', 'Utilities', 'Shopping', 'Health', 'Entertainment', 'Cabs']
      .map(async (n) => [n, await categoryId(c, n)] as const),
  ));
  const spend = ['Groceries', 'Dining', 'Fuel', 'Utilities', 'Shopping', 'Health', 'Entertainment', 'Cabs'];

  for (let m = 0; m < MONTHS; m++) {
    const start = monthStart(m);
    await record(c, { kind: 'income', accountId: bank, categoryId: cats['Salary']!, amount: '185000.00', bookedOn: start, description: 'Salary' });
    await record(c, { kind: 'expense', accountId: bank, categoryId: cats['Rent']!, amount: '45000.00', bookedOn: start, description: 'Rent' });
    for (let k = 0; k < 60; k++) {
      const name = spend[k % spend.length]!;
      const account = k % 3 === 0 ? card : k % 7 === 0 ? cash : bank;
      await record(c, { kind: 'expense', accountId: account, categoryId: cats[name]!, amount: amount(80, 2500), bookedOn: addDays(start, k % 28), description: `${name} ${k}` });
    }
    await transfer(c, { fromAccountId: bank, toAccountId: card, amount: '30000.00', bookedOn: addDays(start, 20), description: 'Card bill' });
  }

  const instruments: string[] = [];
  for (let n = 0; n < 12; n++) {
    instruments.push(await makeInstrument(c, { symbol: `BENCH${n}`, name: `Bench equity ${n}` }));
  }
  for (let m = 0; m < MONTHS; m++) {
    const on = addDays(monthStart(m), 4);
    for (let n = 0; n < instruments.length; n++) {
      await recordBuy(c, { accountId: broker, instrumentId: instruments[n]!, on, qty: '10', price: (100 + n * 10 + m).toFixed(2), fees: '15' });
    }
    if (m % 3 === 2) {
      for (let n = 0; n < 4; n++) await recordDividend(c, { accountId: broker, instrumentId: instruments[n]!, on: addDays(on, 10), gross: '450.00' });
    }
    if (m % 12 === 11) await recordSell(c, { accountId: broker, instrumentId: instruments[5]!, on: addDays(on, 12), qty: '40', price: (160 + m).toFixed(2), fees: '20' });
  }
  // Prices: month-end closes for five years, daily for the last three weeks.
  // BENCH11 is left unpriced on purpose.
  const priced = instruments.slice(0, 11);
  for (let m = 0; m < MONTHS - 1; m++) {
    for (let n = 0; n < priced.length; n++) {
      await storeClose(c, { instrumentId: priced[n]!, on: monthEnd(m), close: (105 + n * 10 + m * 1.1).toFixed(2) });
    }
  }
  const today = isoDate('2026-11-12');
  for (let d = 21; d >= 1; d--) {
    for (let n = 0; n < priced.length; n++) {
      await storeClose(c, { instrumentId: priced[n]!, on: addDays(today, -d), close: (170 + n * 10 + d * 0.3).toFixed(2) });
    }
  }
  ctx = await refreshCtx(fixture);
}, 1_800_000);

afterAll(async () => {
  // Written directly: the test setup silences console output.
  process.stdout.write(
    `\nARCHITECTURE.md §9, median of 9 runs on a 5-year history:\n${results
      .map((r) => `  ${r.operation.padEnd(30)} ${String(Math.round(r.medianMs)).padStart(5)} ms  (target < ${r.targetMs} ms) ${r.medianMs < r.targetMs ? 'met' : 'MISSED'}`)
      .join('\n')}\n`,
  );
  await truncateAll();
  await closeMoneyHarness();
  await closeHarness();
});

it('Overview first render data: < 400 ms', async () => {
  const period = periodContaining(ctx.today, 'monthly', ctx.fiscalYearStartMonth);
  const ms = await median(async () => {
    const [, , nw] = await Promise.all([listAccounts(ctx), listInstruments(ctx), netWorthReconciliation(ctx)]);
    expect(nw.ok).toBe(true);
    const [, , invested] = await Promise.all([
      netWorthChange(ctx, addDays(ctx.today, -30), ctx.today),
      periodSummary(ctx, period),
      portfolio(ctx),
      assetAllocation(ctx, 'asset_class'),
      upcomingCommitments(ctx, 14),
      listBudgetStatuses(ctx),
    ]);
    expect(invested.ok).toBe(true);
  });
  results.push({ operation: 'Overview data', targetMs: 400, medianMs: ms });
  expect(ms).toBeLessThan(400);
});

it('Transactions list, page of 100, filtered: < 150 ms', async () => {
  const ms = await median(async () => {
    const page = await listTransactions(ctx, { kind: 'expense', from: isoDate('2024-01-01'), search: 'Dining', limit: 100 });
    expect(page.ok).toBe(true);
  });
  results.push({ operation: 'Transactions page', targetMs: 150, medianMs: ms });
  expect(ms).toBeLessThan(150);
});

it('Net worth for one date: < 500 ms', async () => {
  const ms = await median(async () => {
    expect((await netWorthAsOf(ctx)).ok).toBe(true);
  });
  results.push({ operation: 'Net worth, one date', targetMs: 500, medianMs: ms });
  expect(ms).toBeLessThan(500);
});

it('Net-worth series, 60 month-ends: < 1 s', async () => {
  const dates = Array.from({ length: MONTHS - 1 }, (_, m) => monthEnd(m));
  const ms = await median(async () => {
    expect((await netWorthSeries(ctx, dates)).length).toBe(dates.length);
  });
  results.push({ operation: 'Net-worth series (59 points)', targetMs: 1000, medianMs: ms });
  expect(ms).toBeLessThan(1000);
});
