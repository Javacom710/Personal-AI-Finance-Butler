import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { toDbString } from '@/lib/decimal/money';
import { rToDbString } from '@/lib/decimal/rate';
import {
  allocationScenario,
  createRule,
  financialMetrics,
  investmentScenario,
  materialiseOccurrences,
} from '@/server/services';
import { closeHarness, truncateAll } from './harness';
import { makeInstrument, priceIt, recordBuy, storeClose, truncateInvestments } from './investment-harness';
import {
  categoryId,
  closeMoneyHarness,
  makeAccount,
  must,
  record,
  setupMoneyFixture,
  truncateMoney,
  write,
  type MoneyFixture,
} from './money-harness';

/**
 * Financial metrics and scenarios against real records (OD-18).
 *
 * The engine arithmetic is unit-tested; what is asserted here is that the
 * services feed it the right inputs — the trailing window excludes the current
 * month, liquid cash is the net-worth cash group, only pending expense
 * commitments inside the window count, and a scenario started "from the
 * portfolio" starts from the priced market value.
 */

let fixture: MoneyFixture;
let salary: string;
let food: string;
let housing: string;

// 10 Aug 2026: the trailing three complete months are May, June and July.
const NOW = new Date('2026-08-10T12:00:00+05:30');

beforeAll(async () => {
  await truncateAll();
  fixture = await setupMoneyFixture({ now: NOW });
  salary = await categoryId(fixture.ctx, 'Salary');
  food = await categoryId(fixture.ctx, 'Food');
  housing = await categoryId(fixture.ctx, 'Housing');
});

beforeEach(async () => {
  await truncateInvestments();
  await truncateMoney();
});

afterAll(async () => {
  await closeMoneyHarness();
  await closeHarness();
});

describe('financialMetrics', () => {
  it('reports every ratio as unavailable, with its reason, on an empty ledger', async () => {
    const m = must(await financialMetrics(fixture.ctx));
    expect(toDbString(m.liquidCash)).toBe('0.0000');
    expect(m.expenseRatio.reason).toBe('divide_by_zero');
    expect(m.savingsRate.reason).toBe('divide_by_zero');
    expect(m.trailing.averageMonthlyExpenses.reason).toBe('no_data');
    expect(m.runwayMonths.reason).toBe('no_data');
    expect(m.commitments.coverage.reason).toBe('divide_by_zero');
    expect(m.commitments.commitmentCount).toBe(0);
  });

  it('computes runway from complete months only and coverage from pending expenses in the window', async () => {
    const bank = await makeAccount(fixture.ctx, { name: 'Bank', openingBalance: '300000' });
    // A card in debit is a liability, not negative cash.
    const card = await makeAccount(fixture.ctx, { name: 'Card', kind: 'credit_card', creditLimit: '100000' });

    // Trailing window (May–Jul): 30,000 + 40,000 + 50,000 = 1,20,000 → 40,000 a month.
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: food, amount: '30000', bookedOn: '2026-05-15' });
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: food, amount: '40000', bookedOn: '2026-06-15' });
    await record(fixture.ctx, { kind: 'expense', accountId: card, categoryId: food, amount: '50000', bookedOn: '2026-07-31' });
    // Outside it on both sides: April, and the current month.
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: food, amount: '99999', bookedOn: '2026-04-30' });
    await record(fixture.ctx, { kind: 'income', accountId: bank, categoryId: salary, amount: '100000', bookedOn: '2026-08-01' });
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: food, amount: '25000', bookedOn: '2026-08-05' });

    // Rent on the 1st: within 30 days of 10 Aug only 1 Sep is pending and due.
    must(
      await write(fixture.ctx, (w) =>
        createRule(w, {
          name: 'Rent',
          template: { kind: 'expense', accountId: bank, categoryId: housing, amount: '35000', description: 'Rent' },
          rrule: 'FREQ=MONTHLY;BYMONTHDAY=1',
          startsOn: '2026-09-01',
          endsOn: null,
          autoPost: false,
        }),
      ),
    );
    // Salary on the 1st is income: never a commitment.
    must(
      await write(fixture.ctx, (w) =>
        createRule(w, {
          name: 'Salary',
          template: { kind: 'income', accountId: bank, categoryId: salary, amount: '100000', description: 'Salary' },
          rrule: 'FREQ=MONTHLY;BYMONTHDAY=1',
          startsOn: '2026-09-01',
          endsOn: null,
          autoPost: false,
        }),
      ),
    );
    must(await write(fixture.ctx, (w) => materialiseOccurrences(w)));

    const m = must(await financialMetrics(fixture.ctx));

    // Bank: 300000 − 30000 − 40000 − 99999 + 100000 − 25000 = 205001. The card is not cash.
    expect(toDbString(m.liquidCash)).toBe('205001.0000');

    expect(m.trailing.range).toEqual({ from: '2026-05-01', to: '2026-07-31' });
    expect(toDbString(m.trailing.expenses)).toBe('120000.0000');
    expect(toDbString(m.trailing.averageMonthlyExpenses.value!)).toBe('40000.0000');
    // 205001 / 40000 = 5.125025
    expect(rToDbString(m.runwayMonths.value!)).toBe('5.1250250000');

    // This month: 25,000 spent of 1,00,000 earned.
    expect(rToDbString(m.expenseRatio.value!)).toBe('0.2500000000');
    expect(rToDbString(m.savingsRate.value!)).toBe('0.7500000000');

    expect(m.commitments.commitmentCount).toBe(1);
    expect(toDbString(m.commitments.commitmentsDue)).toBe('35000.0000');
    // 205001 / 35000 = 5.85717142857…
    expect(rToDbString(m.commitments.coverage.value!)).toBe('5.8571714286');
    expect(toDbString(m.commitments.surplus)).toBe('170001.0000');
    expect(m.commitments.unconvertedCount).toBe(0);
    expect(m.cashExcludedCount).toBe(0);
  });

  it('counts every pending expense, past the display list\'s row cap', async () => {
    const bank = await makeAccount(fixture.ctx, { name: 'Bank', openingBalance: '100000' });
    // A daily ₹10 expense and a daily income rule: 31 + 31 occurrences in the
    // window per pair, and eight pairs put well over 200 rows in it.
    for (let i = 0; i < 8; i += 1) {
      for (const kind of ['income', 'expense'] as const) {
        must(
          await write(fixture.ctx, (w) =>
            createRule(w, {
              name: `${kind} ${i}`,
              template: { kind, accountId: bank, categoryId: kind === 'income' ? salary : housing, amount: '10', description: kind },
              rrule: 'FREQ=DAILY',
              startsOn: '2026-08-10',
              endsOn: null,
              autoPost: false,
            }),
          ),
        );
      }
    }
    must(await write(fixture.ctx, (w) => materialiseOccurrences(w)));

    const m = must(await financialMetrics(fixture.ctx));
    // 10 Aug … 9 Sep inclusive is 31 days × 8 expense rules × ₹10.
    expect(m.commitments.commitmentCount).toBe(248);
    expect(toDbString(m.commitments.commitmentsDue)).toBe('2480.0000');
  });

  it('withholds runway and coverage when a cash balance has no exchange rate', async () => {
    const bank = await makeAccount(fixture.ctx, { name: 'Bank', openingBalance: '90000' });
    // A dollar account with money in it and no USD rate loaded.
    await makeAccount(fixture.ctx, { name: 'US Bank', currencyCode: 'USD', openingBalance: '5000' });
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: food, amount: '30000', bookedOn: '2026-07-10' });
    must(
      await write(fixture.ctx, (w) =>
        createRule(w, {
          name: 'Rent',
          template: { kind: 'expense', accountId: bank, categoryId: housing, amount: '35000', description: 'Rent' },
          rrule: 'FREQ=MONTHLY;BYMONTHDAY=1',
          startsOn: '2026-09-01',
          endsOn: null,
          autoPost: false,
        }),
      ),
    );
    must(await write(fixture.ctx, (w) => materialiseOccurrences(w)));

    const m = must(await financialMetrics(fixture.ctx));
    // The rupee balance is still reported, as a floor, and flagged incomplete.
    expect(toDbString(m.liquidCash)).toBe('60000.0000');
    expect(m.cashExcludedCount).toBe(1);
    // Neither ratio is stated on a cash figure known to be short.
    expect(m.runwayMonths.value).toBeNull();
    expect(m.runwayMonths.reason).toBe('no_fx_rate');
    expect(m.commitments.coverage.value).toBeNull();
    expect(m.commitments.coverage.reason).toBe('no_fx_rate');
    expect(toDbString(m.commitments.commitmentsDue)).toBe('35000.0000');
  });

  it('widens both windows on request', async () => {
    const bank = await makeAccount(fixture.ctx, { name: 'Bank', openingBalance: '120000' });
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: food, amount: '60000', bookedOn: '2026-02-10' });

    const narrow = must(await financialMetrics(fixture.ctx));
    expect(narrow.trailing.averageMonthlyExpenses.reason).toBe('no_data');

    const wide = must(await financialMetrics(fixture.ctx, { trailingMonths: 6 }));
    expect(wide.trailing.range).toEqual({ from: '2026-02-01', to: '2026-07-31' });
    expect(toDbString(wide.trailing.averageMonthlyExpenses.value!)).toBe('10000.0000');
    // 60000 left / 10000 a month.
    expect(rToDbString(wide.runwayMonths.value!)).toBe('6.0000000000');
  });
});

describe('investmentScenario', () => {
  const base = { monthlyContribution: '25000', years: '5', annualReturnPcts: ['8', '12'] };

  it('projects from zero and keeps contributions apart from outcomes', async () => {
    const s = must(await investmentScenario(fixture.ctx, { ...base, annualInflationPct: '6' }));
    expect(s.start).toEqual({ kind: 'zero' });
    expect(toDbString(s.projection.deterministic.totalContributions)).toBe('1500000.0000');
    expect(s.projection.outcomes.map((o) => o.label)).toEqual(['8.00% a year', '12.00% a year']);
    // ₹25,000 × 60 at 12%, annuity-due: 2,062,159.16…
    expect(toDbString(s.projection.outcomes[1]!.finalValue)).toMatch(/^2062159\.1/);
    expect(s.projection.outcomes[1]!.realFinalValue!.minor).toBeLessThan(s.projection.outcomes[1]!.finalValue.minor);
  });

  it('starts from the priced portfolio value and discloses coverage', async () => {
    const demat = await makeAccount(fixture.ctx, { name: 'Demat', kind: 'brokerage' });
    const priced = await makeInstrument(fixture.ctx, { symbol: 'PRICED' });
    const unpriced = await makeInstrument(fixture.ctx, { symbol: 'UNPRICED' });
    must(await recordBuy(fixture.ctx, { accountId: demat, instrumentId: priced, on: '2026-01-05', qty: '100', price: '1000' }));
    must(await recordBuy(fixture.ctx, { accountId: demat, instrumentId: unpriced, on: '2026-01-05', qty: '10', price: '2500' }));
    await priceIt(fixture.ctx, priced, '1200');

    const s = must(await investmentScenario(fixture.ctx, { ...base, startFrom: 'portfolio', annualReturnPcts: ['0'] }));
    // 100 × 1200; the unpriced holding is left out and said to be.
    expect(toDbString(s.projection.deterministic.startingBalance)).toBe('120000.0000');
    expect(s.start.kind).toBe('portfolio');
    if (s.start.kind !== 'portfolio') throw new Error('unreachable');
    expect(s.start.unpricedCount).toBe(1);
    expect(s.start.staleCount).toBe(0);
    // Cost covered: 100000 of 125000.
    expect(rToDbString(s.start.coverage)).toBe('0.8000000000');
    expect(toDbString(s.projection.outcomes[0]!.finalValue)).toBe('1620000.0000');
  });

  it('counts a stale holding and says it is stale, in both scenarios', async () => {
    const demat = await makeAccount(fixture.ctx, { name: 'Demat', kind: 'brokerage' });
    const old = await makeInstrument(fixture.ctx, { symbol: 'OLDPX' });
    must(await recordBuy(fixture.ctx, { accountId: demat, instrumentId: old, on: '2026-01-05', qty: '100', price: '1000' }));
    // Last priced on 1 June; today is 10 August.
    await storeClose(fixture.ctx, { instrumentId: old, on: '2026-06-01', close: '1100' });

    const s = must(await investmentScenario(fixture.ctx, { ...base, startFrom: 'portfolio' }));
    if (s.start.kind !== 'portfolio') throw new Error('unreachable');
    // Used at its last known price, and flagged — never passed off as today's.
    expect(toDbString(s.projection.deterministic.startingBalance)).toBe('110000.0000');
    expect(s.start.staleCount).toBe(1);

    const a = must(await allocationScenario(fixture.ctx, { additions: [{ assetClass: 'gold', amount: '1000' }] }));
    expect(a.staleCount).toBe(1);
  });

  it('rejects what a person can mistype, beside the field', async () => {
    const fields = async (raw: unknown) => {
      const result = await investmentScenario(fixture.ctx, raw);
      if (result.ok || result.error.code !== 'validation_failed') throw new Error('expected validation_failed');
      return Object.keys(result.error.fieldErrors);
    };
    expect(await fields({ ...base, annualReturnPcts: ['120'] })).toEqual(['annualReturnPcts.0']);
    expect(await fields({ ...base, annualReturnPcts: [] })).toEqual(['annualReturnPcts']);
    expect(await fields({ ...base, years: '0' })).toEqual(['years']);
    expect(await fields({ ...base, years: '51' })).toEqual(['years']);
    expect(await fields({ ...base, monthlyContribution: '-5' })).toEqual(['monthlyContribution']);
    expect(await fields({ ...base, monthlyContribution: '1,5' })).toEqual(['monthlyContribution']);
    expect(await fields({ ...base, startFrom: 'amount' })).toEqual(['startingAmount']);
    // A JSON number is not an amount.
    expect(await fields({ ...base, monthlyContribution: 25000 })).toEqual(['monthlyContribution']);
  });
});

describe('allocationScenario', () => {
  it('shows the split before and after an addition, at today\'s values', async () => {
    const demat = await makeAccount(fixture.ctx, { name: 'Demat', kind: 'brokerage' });
    const stock = await makeInstrument(fixture.ctx, { symbol: 'STOCK' });
    const fund = await makeInstrument(fixture.ctx, { symbol: 'FUND', assetClass: 'mutual_fund' });
    must(await recordBuy(fixture.ctx, { accountId: demat, instrumentId: stock, on: '2026-01-05', qty: '100', price: '5000' }));
    must(await recordBuy(fixture.ctx, { accountId: demat, instrumentId: fund, on: '2026-01-05', qty: '1000', price: '300' }, 'mf_purchase'));
    await priceIt(fixture.ctx, stock, '6000');
    await priceIt(fixture.ctx, fund, '400');

    const s = must(await allocationScenario(fixture.ctx, { additions: [{ assetClass: 'gold', amount: '200000' }] }));
    expect(toDbString(s.shift.totalBefore)).toBe('1000000.0000');
    expect(toDbString(s.shift.totalAfter)).toBe('1200000.0000');
    const row = (key: string) => s.shift.rows.find((r) => r.key === key)!;
    expect(rToDbString(row('equity').weightBefore!)).toBe('0.6000000000');
    expect(rToDbString(row('equity').weightAfter)).toBe('0.5000000000');
    expect(row('gold').label).toBe('Gold');
    expect(rToDbString(row('gold').weightAfter)).toBe('0.1666666667');
    expect(s.unpricedCount).toBe(0);
  });

  it('rejects an asset class that does not exist', async () => {
    const result = await allocationScenario(fixture.ctx, { additions: [{ assetClass: 'nft', amount: '1' }] });
    expect(result.ok).toBe(false);
  });
});
