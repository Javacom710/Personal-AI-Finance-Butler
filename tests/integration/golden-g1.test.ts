import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

import { isoDate } from '@/lib/date';
import { fiscalYearRange, monthRange } from '@/lib/date/periods';
import { toDbString } from '@/lib/decimal/money';
import { formatPercent } from '@/lib/format';
import { combineCashflow } from '@/server/domain/calc/cashflow';
import {
  breakdown,
  createBudget,
  getAccount,
  listBudgetStatuses,
  listTransactions,
  periodSummary,
  unfilteredTotal,
} from '@/server/services';
import { closeHarness, truncateAll } from './harness';
import {
  categoryId,
  closeMoneyHarness,
  makeAccount,
  must,
  record,
  setupMoneyFixture,
  transfer,
  write,
  type MoneyFixture,
} from './money-harness';

/**
 * **Golden scenario G1 — a salaried year** (TESTING.md §5).
 *
 * A full fiscal year of ordinary salaried life: twelve salaries, five recurring
 * expense lines, monthly card repayments and monthly cash withdrawals. Every
 * expected figure was computed by hand once and frozen in
 * `tests/golden/g1-salaried-year.expected.json`.
 *
 * The scenario exists to catch regressions no single unit test would: it is the
 * one place where balances, category rollup, budget utilisation, savings rate
 * and the transfer exclusion are all asserted against the *same* fixture, so a
 * change that fixes one of them by breaking another cannot pass.
 */

const EXPECTED_PATH = path.resolve('tests/golden/g1-salaried-year.expected.json');

interface Expected {
  monthly: { income: string; expenses: string; savings: string; savingsRatePercent: string };
  annual: { income: string; expenses: string; savings: string; savingsRatePercent: string; fxEffect: string };
  expensesByCategory: Record<string, string>;
  balances: { hdfcSavings: string; hdfcCard: string; cash: string };
  budgets: Record<string, { budgeted: string; actual: string; utilizationPercent: string; overBudget: boolean }>;
  transferCount: number;
  transactionCount: number;
}

let expected: Expected;
let fixture: MoneyFixture;
let savings: string;
let card: string;
let cash: string;

const YEAR = fiscalYearRange(isoDate('2026-08-10'), 4); // 2026-04-01 … 2027-03-31

/** The 1st of each month of the fiscal year, in order. */
const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const month = ((3 + i) % 12) + 1;
  const year = 3 + i < 12 ? 2026 : 2027;
  return `${year}-${String(month).padStart(2, '0')}`;
});

beforeAll(async () => {
  expected = JSON.parse(await fs.readFile(EXPECTED_PATH, 'utf8')) as Expected;

  await truncateAll();
  // The last day of the fiscal year, so every month of it counts as elapsed.
  fixture = await setupMoneyFixture({ now: new Date('2027-03-31T12:00:00+05:30') });

  savings = await makeAccount(fixture.ctx, {
    name: 'HDFC Savings',
    openingBalance: '50000',
    openingDate: '2026-04-01',
  });
  card = await makeAccount(fixture.ctx, {
    name: 'HDFC Card',
    kind: 'credit_card',
    creditLimit: '300000',
    openingBalance: '0',
    openingDate: '2026-04-01',
  });
  cash = await makeAccount(fixture.ctx, {
    name: 'Cash',
    kind: 'cash',
    openingBalance: '5000',
    openingDate: '2026-04-01',
  });

  const salary = await categoryId(fixture.ctx, 'Salary');
  const rent = await categoryId(fixture.ctx, 'Rent');
  const groceries = await categoryId(fixture.ctx, 'Groceries');
  const dining = await categoryId(fixture.ctx, 'Dining');
  const fuel = await categoryId(fixture.ctx, 'Fuel');
  const utilities = await categoryId(fixture.ctx, 'Utilities');

  for (const month of MONTHS) {
    await record(fixture.ctx, { kind: 'income', accountId: savings, categoryId: salary, amount: '120000.00', bookedOn: `${month}-01`, description: 'Salary' });
    await record(fixture.ctx, { kind: 'expense', accountId: card, categoryId: rent, amount: '35000.00', bookedOn: `${month}-05`, description: 'Rent' });
    await record(fixture.ctx, { kind: 'expense', accountId: savings, categoryId: groceries, amount: '12000.00', bookedOn: `${month}-07`, description: 'Groceries' });
    await record(fixture.ctx, { kind: 'expense', accountId: card, categoryId: dining, amount: '4500.00', bookedOn: `${month}-12`, description: 'Dining' });
    await record(fixture.ctx, { kind: 'expense', accountId: card, categoryId: fuel, amount: '3800.00', bookedOn: `${month}-15`, description: 'Fuel' });
    await record(fixture.ctx, { kind: 'expense', accountId: card, categoryId: utilities, amount: '2200.00', bookedOn: `${month}-18`, description: 'Utilities' });

    // Two transfers a month. Neither is income or spending, and the whole point
    // of the scenario is that no figure below moves because of them.
    await transfer(fixture.ctx, { fromAccountId: savings, toAccountId: cash, amount: '5000.00', bookedOn: `${month}-20`, description: 'Cash withdrawal' });
    await transfer(fixture.ctx, { fromAccountId: savings, toAccountId: card, amount: '45500.00', bookedOn: `${month}-25`, description: 'Card repayment' });
  }

  const housing = await categoryId(fixture.ctx, 'Housing');
  const food = await categoryId(fixture.ctx, 'Food');
  const transport = await categoryId(fixture.ctx, 'Transport');

  for (const [categoryFor, amount] of [
    [housing, '35000'],
    [food, '15000'],
    [transport, '5000'],
  ] as const) {
    must(
      await write(fixture.ctx, (w) =>
        createBudget(w, {
          categoryId: categoryFor,
          period: 'monthly',
          amount,
          currencyCode: 'INR',
          startsOn: '2026-04-01',
        }),
      ),
    );
  }
}, 180_000);

afterAll(async () => {
  await closeMoneyHarness();
  await closeHarness();
});

describe('G1 — the fixture itself', () => {
  it('recorded the expected number of transactions and transfers', async () => {
    const all = must(await listTransactions(fixture.ctx, { limit: 500 }));
    const transfers = must(await listTransactions(fixture.ctx, { kind: 'transfer', limit: 500 }));

    expect(all.total).toBe(expected.transactionCount);
    expect(transfers.total).toBe(expected.transferCount);
  });
});

describe('G1 — monthly figures', () => {
  it('matches the hand-computed month', async () => {
    const august = await periodSummary(fixture.ctx, monthRange(isoDate('2026-08-15')));

    expect(toDbString(august.income)).toBe(expected.monthly.income);
    expect(toDbString(august.expenses)).toBe(expected.monthly.expenses);
    expect(toDbString(august.savings)).toBe(expected.monthly.savings);
    expect(formatPercent(august.savingsRate.value!)).toBe(`${expected.monthly.savingsRatePercent}%`);
  });

  it('gives the same answer for every month of the year', async () => {
    for (const month of MONTHS) {
      const summary = await periodSummary(fixture.ctx, monthRange(isoDate(`${month}-15`)));
      expect(toDbString(summary.income), month).toBe(expected.monthly.income);
      expect(toDbString(summary.expenses), month).toBe(expected.monthly.expenses);
    }
  }, 60_000);
});

describe('G1 — annual figures', () => {
  it('matches the hand-computed year', async () => {
    const year = await periodSummary(fixture.ctx, YEAR);

    expect(toDbString(year.income)).toBe(expected.annual.income);
    expect(toDbString(year.expenses)).toBe(expected.annual.expenses);
    expect(toDbString(year.savings)).toBe(expected.annual.savings);
    expect(toDbString(year.fxEffect)).toBe(expected.annual.fxEffect);
    expect(formatPercent(year.savingsRate.value!)).toBe(`${expected.annual.savingsRatePercent}%`);
  });

  it('equals the sum of its twelve months', async () => {
    const months = [];
    for (const month of MONTHS) {
      months.push(await periodSummary(fixture.ctx, monthRange(isoDate(`${month}-15`))));
    }

    const combined = combineCashflow(months, fixture.ctx.base);
    const year = await periodSummary(fixture.ctx, YEAR);

    expect(toDbString(combined.income)).toBe(toDbString(year.income));
    expect(toDbString(combined.expenses)).toBe(toDbString(year.expenses));
    expect(toDbString(combined.savings)).toBe(toDbString(year.savings));
  }, 60_000);

  it('is unchanged by the 24 transfers, even with no kind filter at all', async () => {
    const year = await periodSummary(fixture.ctx, YEAR);
    const unfiltered = await unfilteredTotal(fixture.ctx, YEAR);

    // The safety net: every same-currency transfer's legs cancel, so summing
    // every entry still gives net cash flow.
    expect(toDbString(unfiltered)).toBe(toDbString(year.netCashFlow));
  });
});

describe('G1 — category rollup', () => {
  it('matches the hand-computed annual totals, with children rolled into parents', async () => {
    const rows = await breakdown(fixture.ctx, YEAR, 'category', 'expense');
    const byLabel = new Map(rows.map((r) => [r.label, toDbString(r.total)]));

    for (const [label, amount] of Object.entries(expected.expensesByCategory)) {
      expect(byLabel.get(label), label).toBe(amount);
    }
  });

  it('has no transfer among the categories', async () => {
    const rows = await breakdown(fixture.ctx, YEAR, 'category', 'expense');
    // The 45,500 card repayments and 5,000 withdrawals must appear nowhere.
    expect(rows.some((r) => r.total.minor === 546_000n * 10_000n)).toBe(false);
    expect(rows.some((r) => r.total.minor === 60_000n * 10_000n)).toBe(false);
  });

  it('sums the top-level categories back to the annual expense figure', async () => {
    const rows = await breakdown(fixture.ctx, YEAR, 'category', 'expense');
    const year = await periodSummary(fixture.ctx, YEAR);

    // Only parents, so children are not counted twice.
    const topLevel = rows.filter((r) => !r.label.includes('›'));
    const total = topLevel.reduce((acc, r) => acc + r.total.minor, 0n);
    expect(total).toBe(year.expenses.minor);
  });
});

describe('G1 — balances', () => {
  it('matches the hand-computed closing balances', async () => {
    expect(toDbString(must(await getAccount(fixture.ctx, savings)).balance)).toBe(
      expected.balances.hdfcSavings,
    );
    expect(toDbString(must(await getAccount(fixture.ctx, card)).balance)).toBe(
      expected.balances.hdfcCard,
    );
    expect(toDbString(must(await getAccount(fixture.ctx, cash)).balance)).toBe(
      expected.balances.cash,
    );
  });

  it('leaves the card at zero, because every charge was repaid', async () => {
    const account = must(await getAccount(fixture.ctx, card));

    // `'none'`, not `'liability'` — and this assertion was inverted by ADR-25,
    // not by a regression. Classification is by the economic **sign** of the
    // balance, so a card that owes nothing sits on neither side of the sheet.
    // Under the previous kind-driven rule it was a liability of ₹0, which was
    // harmless here and wrong for an overpaid card: the same rule reported a
    // ₹5,000 credit as a ₹5,000 debt.
    expect(toDbString(account.balance)).toBe('0.0000');
    expect(account.role).toBe('none');

    // Available credit is the full limit, and is counted in no total.
    expect(toDbString(account.availableCredit!)).toBe('300000.0000');
  });

  it('conserves value: the three balances move by exactly net cash flow', async () => {
    const year = await periodSummary(fixture.ctx, YEAR);

    const opening = 50_000n + 0n + 5_000n;
    const closing =
      must(await getAccount(fixture.ctx, savings)).balance.minor +
      must(await getAccount(fixture.ctx, card)).balance.minor +
      must(await getAccount(fixture.ctx, cash)).balance.minor;

    // Transfers move money between the three accounts and therefore cannot
    // change their sum. Anything that did would be money invented or lost.
    expect(closing - opening * 10_000n).toBe(year.netCashFlow.minor);
  });
});

describe('G1 — budgets', () => {
  it('matches the hand-computed utilisation for the final month', async () => {
    const statuses = must(await listBudgetStatuses(fixture.ctx, { asOf: isoDate('2027-03-31') }));
    const byLabel = new Map(statuses.map((s) => [s.categoryLabel, s]));

    for (const [label, want] of Object.entries(expected.budgets)) {
      const status = byLabel.get(label);
      expect(status, label).toBeDefined();
      expect(toDbString(status!.status.budgeted), label).toBe(want.budgeted);
      expect(toDbString(status!.status.actual), label).toBe(want.actual);
      expect(formatPercent(status!.status.utilization.value!), label).toBe(
        `${want.utilizationPercent}%`,
      );
      expect(status!.status.isOverBudget, label).toBe(want.overBudget);
    }
  });

  it('counts the Food budget over both of its children', async () => {
    const statuses = must(await listBudgetStatuses(fixture.ctx, { asOf: isoDate('2027-03-31') }));
    const food = statuses.find((s) => s.categoryLabel === 'Food')!;
    // 12,000 groceries + 4,500 dining = 16,500 against a 15,000 budget.
    expect(toDbString(food.status.actual)).toBe('16500.0000');
    expect(food.status.isOverBudget).toBe(true);
  });
});
