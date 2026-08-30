import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/date';
import { monthRange } from '@/lib/date/periods';
import { toDbString } from '@/lib/decimal/money';
import {
  breakdown,
  createTransfer,
  getAccount,
  listTransactions,
  periodSummary,
  sumRows,
  unfilteredTotal,
  updateTransfer,
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

/**
 * **Transfers appear in neither income nor expense totals — anywhere.**
 *
 * This is the product invariant with the most ways to go wrong, so it is
 * asserted at every level it could leak: the headline summary, the category
 * breakdown, the tag breakdown, and an unfiltered sum over every entry.
 */

let fixture: MoneyFixture;
let bank: string;
let wallet: string;
let food: string;
let salary: string;

const AUGUST = monthRange(isoDate('2026-08-15'));

beforeAll(async () => {
  await truncateAll();
  fixture = await setupMoneyFixture();
  food = await categoryId(fixture.ctx, 'Food');
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

describe('same-currency transfers', () => {
  it('moves money between two accounts without changing the total', async () => {
    await transfer(fixture.ctx, {
      fromAccountId: bank,
      toAccountId: wallet,
      amount: '5000',
      bookedOn: '2026-08-05',
    });

    expect(toDbString(must(await getAccount(fixture.ctx, bank)).balance)).toBe('95000.0000');
    expect(toDbString(must(await getAccount(fixture.ctx, wallet)).balance)).toBe('5000.0000');
  });

  it('leaves exactly zero residual in base currency (I-3)', async () => {
    const result = await transfer(fixture.ctx, {
      fromAccountId: bank,
      toAccountId: wallet,
      amount: '5000',
      bookedOn: '2026-08-05',
    });
    expect(toDbString(result.fxResidual)).toBe('0.0000');
  });

  it('appears in neither income nor expenses', async () => {
    await record(fixture.ctx, { kind: 'income', accountId: bank, categoryId: salary, amount: '50000', bookedOn: '2026-08-01' });
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: food, amount: '12000', bookedOn: '2026-08-02' });
    await transfer(fixture.ctx, { fromAccountId: bank, toAccountId: wallet, amount: '20000', bookedOn: '2026-08-03' });

    const summary = await periodSummary(fixture.ctx, AUGUST);
    expect(toDbString(summary.income)).toBe('50000.0000');
    expect(toDbString(summary.expenses)).toBe('12000.0000');
    expect(toDbString(summary.savings)).toBe('38000.0000');
    expect(toDbString(summary.fxEffect)).toBe('0.0000');
  });

  it('leaves the unfiltered sum equal to net cash flow (edge case 28)', async () => {
    await record(fixture.ctx, { kind: 'income', accountId: bank, categoryId: salary, amount: '50000', bookedOn: '2026-08-01' });
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: food, amount: '12000', bookedOn: '2026-08-02' });
    await transfer(fixture.ctx, { fromAccountId: bank, toAccountId: wallet, amount: '20000', bookedOn: '2026-08-03' });

    // The safety net behind the `kind` filter: even with no filter at all the
    // total is unchanged, because the two legs cancel exactly.
    const total = await unfilteredTotal(fixture.ctx, AUGUST);
    const summary = await periodSummary(fixture.ctx, AUGUST);
    expect(toDbString(total)).toBe(toDbString(summary.netCashFlow));
  });

  it('carries no category, so it cannot reach a category report', async () => {
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: food, amount: '1000', bookedOn: '2026-08-01' });
    await transfer(fixture.ctx, { fromAccountId: bank, toAccountId: wallet, amount: '90000', bookedOn: '2026-08-02' });

    const result = await breakdown(fixture.ctx, AUGUST, 'category', 'expense');
    // The rows partition the expense total exactly, so the 90,000 transfer is
    // absent by arithmetic rather than by inspection: were it counted, the sum
    // could not still be 1,000.
    expect(result.additivity).toBe('partition');
    expect(result.rows.find((r) => r.label === 'Food')).toBeDefined();
    expect(toDbString(result.total)).toBe('1000.0000');
    expect(toDbString(sumRows(result.rows, fixture.ctx.base))).toBe('1000.0000');
  });

  it('is excluded from a tag report even when it carries the same tag (edge case 21)', async () => {
    await record(fixture.ctx, {
      kind: 'expense',
      accountId: bank,
      categoryId: food,
      amount: '2500',
      bookedOn: '2026-08-01',
      tags: ['holiday'],
    });
    await transfer(fixture.ctx, {
      fromAccountId: bank,
      toAccountId: wallet,
      amount: '50000',
      bookedOn: '2026-08-02',
      tags: ['holiday'],
    });

    const result = await breakdown(fixture.ctx, AUGUST, 'tag', 'expense');
    expect(result.rows).toHaveLength(1);
    // Without the kind filter this would read 102,500: the expense plus both
    // legs of the transfer.
    expect(toDbString(result.rows[0]!.total)).toBe('2500.0000');
    // A tag row set never partitions the total — one transaction can carry
    // several tags, and an untagged one carries none (ADR-34).
    expect(result.additivity).toBe('overlapping');
  });

  it('still shows up in a transaction list, where it belongs', async () => {
    await transfer(fixture.ctx, { fromAccountId: bank, toAccountId: wallet, amount: '5000', bookedOn: '2026-08-05' });

    const all = must(await listTransactions(fixture.ctx));
    expect(all.total).toBe(1);
    expect(all.rows[0]!.kind).toBe('transfer');
    expect(all.rows[0]!.entries).toHaveLength(2);
    expect(all.rows[0]!.categoryName).toBeNull();

    const asExpense = must(await listTransactions(fixture.ctx, { kind: 'expense' }));
    expect(asExpense.total).toBe(0);
  });

  it('rejects a transfer to the account it came from (edge case 4)', async () => {
    const result = await write(fixture.ctx, (w) =>
      createTransfer(w, {
        fromAccountId: bank,
        toAccountId: bank,
        amount: '100',
        bookedOn: '2026-08-01',
        description: 'circular',
        tags: [],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects mismatched amounts between two accounts of the same currency', async () => {
    const result = await write(fixture.ctx, (w) =>
      createTransfer(w, {
        fromAccountId: bank,
        toAccountId: wallet,
        fromAmount: '5000',
        toAmount: '4900',
        bookedOn: '2026-08-01',
        description: 'phantom exchange',
        tags: [],
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    if (result.error.code !== 'validation_failed') throw new Error('expected a field error');
    expect(result.error.fieldErrors['toAmount']?.[0]).toContain('must match');
  });
});

describe('cross-currency transfers', () => {
  beforeEach(async () => {
    await addFxRate('USD', 'INR', '2026-08-01', '83.0000000000');
  });

  it('records both amounts and reports the residual as a realised FX effect (edge case 3)', async () => {
    const ctx = await refreshCtx(fixture);
    const usd = await makeAccount(ctx, { name: 'US brokerage', currencyCode: 'USD', kind: 'brokerage' });

    // 100 USD leaves (₹8,300 at the stored rate) and ₹8,250 arrives: a ₹50
    // realised exchange difference the user actually bore.
    const result = must(
      await write(ctx, (w) =>
        createTransfer(w, {
          fromAccountId: usd,
          toAccountId: bank,
          fromAmount: '100',
          toAmount: '8250',
          bookedOn: '2026-08-05',
          description: 'Repatriation',
          tags: [],
        }),
      ),
    );

    expect(toDbString(result.fxResidual)).toBe('-50.0000');
    expect(toDbString(must(await getAccount(ctx, usd)).balance)).toBe('-100.0000');
    expect(toDbString(must(await getAccount(ctx, bank)).balance)).toBe('108250.0000');
  });

  it('reports the residual as fxEffect, never as income or expense', async () => {
    const ctx = await refreshCtx(fixture);
    const usd = await makeAccount(ctx, { name: 'US brokerage', currencyCode: 'USD', kind: 'brokerage' });

    await write(ctx, (w) =>
      createTransfer(w, {
        fromAccountId: usd,
        toAccountId: bank,
        fromAmount: '100',
        toAmount: '8250',
        bookedOn: '2026-08-05',
        description: 'Repatriation',
        tags: [],
      }),
    );

    const summary = await periodSummary(ctx, AUGUST);
    expect(toDbString(summary.income)).toBe('0.0000');
    expect(toDbString(summary.expenses)).toBe('0.0000');
    expect(toDbString(summary.fxEffect)).toBe('-50.0000');
  });

  it('requires both amounts when the currencies differ', async () => {
    const ctx = await refreshCtx(fixture);
    const usd = await makeAccount(ctx, { name: 'US brokerage', currencyCode: 'USD', kind: 'brokerage' });

    const result = await write(ctx, (w) =>
      createTransfer(w, {
        fromAccountId: usd,
        toAccountId: bank,
        amount: '100',
        bookedOn: '2026-08-05',
        description: 'ambiguous',
        tags: [],
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    if (result.error.code !== 'validation_failed') throw new Error('expected a field error');
    expect(result.error.fieldErrors['fromAmount']?.[0]).toContain('both the amount debited');
  });

  it('refuses rather than inventing a rate when none is on file (edge case 17)', async () => {
    const ctx = await refreshCtx(fixture);
    const eur = await makeAccount(ctx, { name: 'Euro account', currencyCode: 'EUR' });

    const result = await write(ctx, (w) =>
      createTransfer(w, {
        fromAccountId: eur,
        toAccountId: bank,
        fromAmount: '100',
        toAmount: '9500',
        bookedOn: '2026-08-05',
        description: 'no rate on file',
        tags: [],
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('insufficient_data');
    // Defaulting to 1 would silently mis-state every total the entry appears in.
    expect(result.error.message).toContain('No exchange rate');
  });

  it('falls back to the most recent earlier rate', async () => {
    await addFxRate('USD', 'INR', '2026-08-10', '84.0000000000');
    const ctx = await refreshCtx(fixture);
    const usd = await makeAccount(ctx, { name: 'US brokerage', currencyCode: 'USD', kind: 'brokerage' });

    // Booked on the 7th: the rate in force is the one dated the 1st, not the 10th.
    const result = must(
      await write(ctx, (w) =>
        createTransfer(w, {
          fromAccountId: usd,
          toAccountId: bank,
          fromAmount: '100',
          toAmount: '8300',
          bookedOn: '2026-08-07',
          description: 'earlier rate',
          tags: [],
        }),
      ),
    );

    expect(toDbString(result.fxResidual)).toBe('0.0000');
  });
});

describe('editing a transfer', () => {
  it('rebuilds both legs together', async () => {
    const created = await transfer(fixture.ctx, {
      fromAccountId: bank,
      toAccountId: wallet,
      amount: '5000',
      bookedOn: '2026-08-05',
    });

    must(
      await write(fixture.ctx, (w) =>
        updateTransfer(w, created.transaction.id, {
          fromAccountId: bank,
          toAccountId: wallet,
          amount: '7500',
          bookedOn: '2026-08-05',
          description: 'Corrected',
          tags: [],
        }),
      ),
    );

    expect(toDbString(must(await getAccount(fixture.ctx, bank)).balance)).toBe('92500.0000');
    expect(toDbString(must(await getAccount(fixture.ctx, wallet)).balance)).toBe('7500.0000');
  });

  it('still counts as neither income nor expense after an edit', async () => {
    const created = await transfer(fixture.ctx, {
      fromAccountId: bank,
      toAccountId: wallet,
      amount: '5000',
      bookedOn: '2026-08-05',
    });

    await write(fixture.ctx, (w) =>
      updateTransfer(w, created.transaction.id, {
        fromAccountId: bank,
        toAccountId: wallet,
        amount: '9999',
        bookedOn: '2026-08-06',
        description: 'Corrected',
        tags: [],
      }),
    );

    const summary = await periodSummary(fixture.ctx, AUGUST);
    expect(toDbString(summary.income)).toBe('0.0000');
    expect(toDbString(summary.expenses)).toBe('0.0000');
  });
});
