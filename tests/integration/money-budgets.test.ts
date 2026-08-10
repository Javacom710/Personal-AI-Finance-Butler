import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/date';
import { toDbString } from '@/lib/decimal/money';
import { rToDbString } from '@/lib/decimal/rate';
import {
  createBudget,
  deleteBudget,
  listBudgetStatuses,
  overBudgetCount,
  updateBudget,
} from '@/server/services';
import { closeHarness, truncateAll } from './harness';
import {
  addFxRate,
  categoryId,
  closeMoneyHarness,
  makeAccount,
  must,
  record,
  refreshCtx,
  setupMoneyFixture,
  transfer,
  truncateMoney,
  write,
  type MoneyFixture,
} from './money-harness';

let fixture: MoneyFixture;
let bank: string;
let wallet: string;
let food: string;
let groceries: string;
let dining: string;
let salary: string;

/** Fixed so "days elapsed" is deterministic: 10 August is day 10 of 31. */
const NOW = new Date('2026-08-10T12:00:00+05:30');

beforeAll(async () => {
  await truncateAll();
  fixture = await setupMoneyFixture({ now: NOW });
  food = await categoryId(fixture.ctx, 'Food');
  groceries = await categoryId(fixture.ctx, 'Groceries');
  dining = await categoryId(fixture.ctx, 'Dining');
  salary = await categoryId(fixture.ctx, 'Salary');
});

beforeEach(async () => {
  await truncateMoney();
  bank = await makeAccount(fixture.ctx, { name: 'Bank', openingBalance: '100000' });
  wallet = await makeAccount(fixture.ctx, { name: 'Wallet', kind: 'wallet' });
});

afterAll(async () => {
  await closeMoneyHarness();
  await closeHarness();
});

async function budget(categoryFor: string, amount: string, period = 'monthly'): Promise<string> {
  return must(
    await write(fixture.ctx, (w) =>
      createBudget(w, {
        categoryId: categoryFor,
        period,
        amount,
        currencyCode: 'INR',
        startsOn: '2026-01-01',
      }),
    ),
  );
}

describe('budget status', () => {
  it('compares spending against the budget for the current period', async () => {
    await budget(food, '20000');
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: dining, amount: '5000', bookedOn: '2026-08-03' });

    const [status] = must(await listBudgetStatuses(fixture.ctx));
    expect(toDbString(status!.status.budgeted)).toBe('20000.0000');
    expect(toDbString(status!.status.actual)).toBe('5000.0000');
    expect(toDbString(status!.status.remaining)).toBe('15000.0000');
    expect(rToDbString(status!.status.utilization.value!)).toBe('0.2500000000');
    expect(status!.status.daysElapsed).toBe(10);
    expect(status!.status.daysTotal).toBe(31);
  });

  it('rolls a parent budget up over its children', async () => {
    await budget(food, '20000');
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: groceries, amount: '8000', bookedOn: '2026-08-02' });
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: dining, amount: '4840', bookedOn: '2026-08-05' });

    const [status] = must(await listBudgetStatuses(fixture.ctx));
    // Budgeting Food covers Groceries and Dining.
    expect(toDbString(status!.status.actual)).toBe('12840.0000');
  });

  it('counts only the budget’s own subtree', async () => {
    await budget(dining, '5000');
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: groceries, amount: '8000', bookedOn: '2026-08-02' });
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: dining, amount: '1200', bookedOn: '2026-08-05' });

    const [status] = must(await listBudgetStatuses(fixture.ctx));
    expect(toDbString(status!.status.actual)).toBe('1200.0000');
  });

  it('never counts income or transfers against a budget', async () => {
    await budget(food, '20000');
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: dining, amount: '1000', bookedOn: '2026-08-02' });
    await record(fixture.ctx, { kind: 'income', accountId: bank, categoryId: salary, amount: '50000', bookedOn: '2026-08-03' });
    await transfer(fixture.ctx, { fromAccountId: bank, toAccountId: wallet, amount: '30000', bookedOn: '2026-08-04' });

    const [status] = must(await listBudgetStatuses(fixture.ctx));
    expect(toDbString(status!.status.actual)).toBe('1000.0000');
  });

  it('ignores spending outside the period', async () => {
    await budget(food, '20000');
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: dining, amount: '9999', bookedOn: '2026-07-31' });
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: dining, amount: '500', bookedOn: '2026-08-01' });

    const [status] = must(await listBudgetStatuses(fixture.ctx));
    expect(toDbString(status!.status.actual)).toBe('500.0000');
  });

  it('reports over budget as a state, showing the overspend', async () => {
    await budget(food, '5000');
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: dining, amount: '7500', bookedOn: '2026-08-02' });

    const [status] = must(await listBudgetStatuses(fixture.ctx));
    expect(status!.status.isOverBudget).toBe(true);
    expect(toDbString(status!.status.remaining)).toBe('-2500.0000');
    expect(await overBudgetCount(fixture.ctx)).toBe(1);
  });

  it('spans a fiscal-year boundary for a yearly budget (edge case 8)', async () => {
    await budget(food, '500000', 'yearly');
    // The Indian fiscal year runs April to March, so both dates fall in FY2026-27.
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: dining, amount: '1000', bookedOn: '2026-04-01' });
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: dining, amount: '2000', bookedOn: '2027-03-31' });
    // And this one does not.
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: dining, amount: '9999', bookedOn: '2026-03-31' });

    const [status] = must(await listBudgetStatuses(fixture.ctx));
    expect(status!.range).toEqual({ from: '2026-04-01', to: '2027-03-31' });
    expect(toDbString(status!.status.actual)).toBe('3000.0000');
  });

  it('aligns a quarterly budget to the fiscal year', async () => {
    await budget(food, '60000', 'quarterly');
    const [status] = must(await listBudgetStatuses(fixture.ctx));
    // August falls in Jul–Sep, the second quarter of an April fiscal year.
    expect(status!.range).toEqual({ from: '2026-07-01', to: '2026-09-30' });
  });
});

describe('creating budgets', () => {
  it('rejects a zero or negative amount (edge case 9)', async () => {
    for (const amount of ['0', '-100']) {
      const result = await write(fixture.ctx, (w) =>
        createBudget(w, {
          categoryId: food,
          period: 'monthly',
          amount,
          currencyCode: 'INR',
          startsOn: '2026-01-01',
        }),
      );
      expect(result.ok).toBe(false);
    }
  });

  it('rejects a budget on an income category', async () => {
    const result = await write(fixture.ctx, (w) =>
      createBudget(w, {
        categoryId: salary,
        period: 'monthly',
        amount: '1000',
        currencyCode: 'INR',
        startsOn: '2026-01-01',
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    if (result.error.code !== 'validation_failed') throw new Error('expected a field error');
    expect(result.error.fieldErrors['categoryId']?.[0]).toContain('income category');
  });

  it('refuses a second active budget for the same category and period', async () => {
    await budget(food, '20000');
    const second = await write(fixture.ctx, (w) =>
      createBudget(w, {
        categoryId: food,
        period: 'monthly',
        amount: '30000',
        currencyCode: 'INR',
        startsOn: '2026-01-01',
      }),
    );

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe('conflict');
  });

  it('allows the same category in two different periods', async () => {
    await budget(food, '20000', 'monthly');
    const yearly = await write(fixture.ctx, (w) =>
      createBudget(w, {
        categoryId: food,
        period: 'yearly',
        amount: '240000',
        currencyCode: 'INR',
        startsOn: '2026-01-01',
      }),
    );
    expect(yearly.ok).toBe(true);
  });
});

describe('multi-currency budgets', () => {
  it('converts the budget at the period-start rate and reports the conversion', async () => {
    await addFxRate('USD', 'INR', '2026-08-01', '83.0000000000');
    // A later rate exists but must not be used: a budget that moved mid-month
    // would make yesterday's utilisation wrong.
    await addFxRate('USD', 'INR', '2026-08-09', '90.0000000000');
    const ctx = await refreshCtx(fixture);

    must(
      await write(ctx, (w) =>
        createBudget(w, {
          categoryId: food,
          period: 'monthly',
          amount: '100',
          currencyCode: 'USD',
          startsOn: '2026-01-01',
        }),
      ),
    );

    const [status] = must(await listBudgetStatuses(ctx));
    expect(toDbString(status!.status.budgeted)).toBe('8300.0000');
    expect(rToDbString(status!.conversionRate!)).toBe('83.0000000000');
  });

  it('reports insufficient data rather than guessing when no rate exists', async () => {
    const ctx = await refreshCtx(fixture);
    must(
      await write(ctx, (w) =>
        createBudget(w, {
          categoryId: food,
          period: 'monthly',
          amount: '100',
          currencyCode: 'EUR',
          startsOn: '2026-01-01',
        }),
      ),
    );

    const result = await listBudgetStatuses(ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('insufficient_data');
  });
});

describe('editing and removing', () => {
  it('changes the amount', async () => {
    const id = await budget(food, '20000');
    must(await write(fixture.ctx, (w) => updateBudget(w, id, { amount: '25000' })));

    const [status] = must(await listBudgetStatuses(fixture.ctx));
    expect(toDbString(status!.status.budgeted)).toBe('25000.0000');
  });

  it('deactivates rather than deleting when asked to', async () => {
    const id = await budget(food, '20000');
    must(await write(fixture.ctx, (w) => updateBudget(w, id, { isActive: false })));

    expect(must(await listBudgetStatuses(fixture.ctx))).toHaveLength(0);
    expect(must(await listBudgetStatuses(fixture.ctx, { includeInactive: true }))).toHaveLength(1);
  });

  it('removes a budget', async () => {
    const id = await budget(food, '20000');
    must(await write(fixture.ctx, (w) => deleteBudget(w, id)));
    expect(must(await listBudgetStatuses(fixture.ctx, { includeInactive: true }))).toHaveLength(0);
  });
});

describe('period progress', () => {
  it('reports the whole period once it has ended', async () => {
    await budget(food, '20000');
    const [status] = must(await listBudgetStatuses(fixture.ctx, { asOf: isoDate('2026-08-31') }));
    expect(status!.status.daysElapsed).toBe(31);
    expect(status!.status.daysTotal).toBe(31);
  });

  it('reports one day on the first of the month', async () => {
    await budget(food, '20000');
    const [status] = must(await listBudgetStatuses(fixture.ctx, { asOf: isoDate('2026-08-01') }));
    expect(status!.status.daysElapsed).toBe(1);
  });
});
