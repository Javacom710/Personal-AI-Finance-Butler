import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { addDays, isoDate } from '@/lib/date';
import { monthRange } from '@/lib/date/periods';
import { toDbString } from '@/lib/decimal/money';
import { db } from '@/server/db/client';
import {
  createTransaction,
  deleteTransaction,
  getAccount,
  getTransaction,
  listTags,
  listTransactions,
  periodSummary,
  renameTag,
  updateTransaction,
} from '@/server/services';
import { closeHarness, truncateAll } from './harness';
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

let fixture: MoneyFixture;
let bank: string;
let food: string;
let dining: string;
let salary: string;

beforeAll(async () => {
  await truncateAll();
  fixture = await setupMoneyFixture();
  food = await categoryId(fixture.ctx, 'Food');
  dining = await categoryId(fixture.ctx, 'Dining');
  salary = await categoryId(fixture.ctx, 'Salary');
});

beforeEach(async () => {
  await truncateMoney();
  bank = await makeAccount(fixture.ctx, { name: 'Bank', openingBalance: '10000' });
});

afterAll(async () => {
  await closeMoneyHarness();
  await closeHarness();
});

describe('creating', () => {
  it('stores an expense as a negative entry although the caller passed a positive amount', async () => {
    const id = await record(fixture.ctx, {
      kind: 'expense',
      accountId: bank,
      categoryId: dining,
      amount: '1250.50',
      bookedOn: '2026-08-08',
      description: 'Dinner',
    });

    const txn = must(await getTransaction(fixture.ctx, id));
    expect(txn.entries).toHaveLength(1);
    expect(toDbString(txn.entries[0]!.amount)).toBe('-1250.5000');
    // The headline figure is a magnitude; the sign lives in the database.
    expect(toDbString(txn.amount)).toBe('1250.5000');
    expect(txn.categoryName).toBe('Dining');
  });

  it('stores income as a positive entry', async () => {
    const id = await record({ ...fixture.ctx }, {
      kind: 'income',
      accountId: bank,
      categoryId: salary,
      amount: '85000',
      bookedOn: '2026-08-01',
      description: 'August salary',
    });

    const txn = must(await getTransaction(fixture.ctx, id));
    expect(toDbString(txn.entries[0]!.amount)).toBe('85000.0000');
  });

  it('rejects a zero amount (edge case 1)', async () => {
    const result = await write(fixture.ctx, (w) =>
      createTransaction(w, {
        kind: 'expense',
        accountId: bank,
        categoryId: food,
        amount: '0',
        bookedOn: '2026-08-01',
        description: 'nothing',
        tags: [],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects an expense filed under an income category (edge case 5)', async () => {
    const result = await write(fixture.ctx, (w) =>
      createTransaction(w, {
        kind: 'expense',
        accountId: bank,
        categoryId: salary,
        amount: '100',
        bookedOn: '2026-08-01',
        description: 'miscategorised',
        tags: [],
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    if (result.error.code !== 'validation_failed') throw new Error('expected a field error');
    expect(result.error.fieldErrors['categoryId']?.[0]).toContain('income category');
  });

  it('writes an audit row and bumps the ledger version', async () => {
    const before = await ledgerVersion();
    await record(fixture.ctx, {
      kind: 'expense',
      accountId: bank,
      categoryId: food,
      amount: '100',
      bookedOn: '2026-08-01',
    });

    expect(await ledgerVersion()).toBe(before + 1n);

    const { rows } = await db().execute<{ action: string; actor: string }>(
      sql`select action, actor from audit_log order by id desc limit 1`,
    );
    expect(rows[0]).toEqual({ action: 'transaction.create', actor: 'user' });
  });

  it('rolls back completely when a step inside the transaction fails', async () => {
    const before = await ledgerVersion();
    const auditBefore = await auditCount();

    // The category belongs to nobody, so authorization fails after the header
    // would have been written had the boundary not been the service's.
    const result = await write(fixture.ctx, (w) =>
      createTransaction(w, {
        kind: 'expense',
        accountId: bank,
        categoryId: '00000000-0000-0000-0000-000000000000',
        amount: '100',
        bookedOn: '2026-08-01',
        description: 'doomed',
        tags: [],
      }),
    );

    expect(result.ok).toBe(false);
    expect(await ledgerVersion()).toBe(before);
    expect(await auditCount()).toBe(auditBefore);
    expect(must(await listTransactions(fixture.ctx)).total).toBe(0);
  });
});

describe('editing', () => {
  it('rebuilds the entries and corrects every later balance', async () => {
    const id = await record(fixture.ctx, {
      kind: 'expense',
      accountId: bank,
      categoryId: food,
      amount: '1000',
      bookedOn: '2026-03-15',
    });

    expect(toDbString(must(await getAccount(fixture.ctx, bank)).balance)).toBe('9000.0000');

    await write(fixture.ctx, (w) => updateTransaction(w, id, { amount: '250' }));

    // Correcting history is a normal operation: no backfill, no repair script.
    expect(toDbString(must(await getAccount(fixture.ctx, bank)).balance)).toBe('9750.0000');
  });

  it('keeps the sign correct when the amount changes', async () => {
    const id = await record(fixture.ctx, {
      kind: 'expense',
      accountId: bank,
      categoryId: food,
      amount: '100',
      bookedOn: '2026-08-01',
    });
    await write(fixture.ctx, (w) => updateTransaction(w, id, { amount: '999.99' }));

    const txn = must(await getTransaction(fixture.ctx, id));
    expect(toDbString(txn.entries[0]!.amount)).toBe('-999.9900');
  });

  it('records a before and after in the audit log', async () => {
    const id = await record(fixture.ctx, {
      kind: 'expense',
      accountId: bank,
      categoryId: food,
      amount: '100',
      bookedOn: '2026-08-01',
    });
    await write(fixture.ctx, (w) => updateTransaction(w, id, { description: 'Corrected' }));

    const { rows } = await db().execute<{ action: string; before: unknown; after: unknown }>(
      sql`select action, before, after from audit_log where action = 'transaction.update' limit 1`,
    );
    expect(rows[0]?.before).toBeTruthy();
    expect(rows[0]?.after).toBeTruthy();
  });

  it('refuses to edit a transfer through the single-entry path', async () => {
    const wallet = await makeAccount(fixture.ctx, { name: 'Wallet', kind: 'wallet' });
    const { createTransfer } = await import('@/server/services');
    const created = must(
      await write(fixture.ctx, (w) =>
        createTransfer(w, {
          fromAccountId: bank,
          toAccountId: wallet,
          amount: '500',
          bookedOn: '2026-08-01',
          description: 'Move',
          tags: [],
        }),
      ),
    );

    const result = await write(fixture.ctx, (w) =>
      updateTransaction(w, created.transaction.id, { amount: '600' }),
    );
    expect(result.ok).toBe(false);
  });
});

describe('deleting', () => {
  it('removes the transaction and its entries, and corrects the balance', async () => {
    const id = await record(fixture.ctx, {
      kind: 'expense',
      accountId: bank,
      categoryId: food,
      amount: '1000',
      bookedOn: '2026-08-01',
    });

    await write(fixture.ctx, (w) => deleteTransaction(w, id));

    expect(toDbString(must(await getAccount(fixture.ctx, bank)).balance)).toBe('10000.0000');
    expect((await getTransaction(fixture.ctx, id)).ok).toBe(false);

    const { rows } = await db().execute<{ n: string }>(
      sql`select count(*)::text as n from transaction_entries`,
    );
    expect(rows[0]!.n).toBe('0');
  });

  it('captures the full row in the audit log before deleting it', async () => {
    const id = await record(fixture.ctx, {
      kind: 'expense',
      accountId: bank,
      categoryId: food,
      amount: '1000',
      bookedOn: '2026-08-01',
      description: 'Gone but recorded',
    });
    await write(fixture.ctx, (w) => deleteTransaction(w, id));

    const { rows } = await db().execute<{ before: { description: string } }>(
      sql`select before from audit_log where action = 'transaction.delete' limit 1`,
    );
    expect(rows[0]?.before.description).toBe('Gone but recorded');
  });
});

describe('filters', () => {
  beforeEach(async () => {
    await record(fixture.ctx, { kind: 'income', accountId: bank, categoryId: salary, amount: '50000', bookedOn: '2026-07-01', description: 'July salary' });
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: dining, amount: '1200', bookedOn: '2026-08-02', description: 'Dinner out', tags: ['work'] });
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: food, amount: '3400', bookedOn: '2026-08-05', description: 'Weekly shop' });
  });

  it('filters by kind', async () => {
    const income = must(await listTransactions(fixture.ctx, { kind: 'income' }));
    expect(income.total).toBe(1);
    expect(income.rows[0]!.description).toBe('July salary');
  });

  it('filters by date range', async () => {
    const august = must(
      await listTransactions(fixture.ctx, { from: isoDate('2026-08-01'), to: isoDate('2026-08-31') }),
    );
    expect(august.total).toBe(2);
  });

  it('filters a parent category to include its children', async () => {
    // Asking for Food must include Dining — otherwise the question "how much did
    // I spend on food?" has no category to resolve to.
    const result = must(await listTransactions(fixture.ctx, { categoryId: food }));
    expect(result.total).toBe(2);
  });

  it('filters a child category to itself alone', async () => {
    const result = must(await listTransactions(fixture.ctx, { categoryId: dining }));
    expect(result.total).toBe(1);
  });

  it('searches description text', async () => {
    const result = must(await listTransactions(fixture.ctx, { search: 'dinner' }));
    expect(result.total).toBe(1);
  });

  it('escapes wildcard characters in a search rather than matching everything', async () => {
    const result = must(await listTransactions(fixture.ctx, { search: '%' }));
    expect(result.total).toBe(0);
  });

  it('filters by amount range on the base amount', async () => {
    const result = must(await listTransactions(fixture.ctx, { minAmount: '2000' }));
    expect(result.rows.map((r) => r.description).sort()).toEqual(['July salary', 'Weekly shop']);
  });

  it('orders newest first, by a total order', async () => {
    const result = must(await listTransactions(fixture.ctx));
    expect(result.rows.map((r) => r.bookedOn)).toEqual(['2026-08-05', '2026-08-02', '2026-07-01']);
  });

  it('paginates without losing the total', async () => {
    const page = must(await listTransactions(fixture.ctx, { limit: 2, offset: 0 }));
    expect(page.rows).toHaveLength(2);
    expect(page.total).toBe(3);
  });
});

describe('tags', () => {
  it('creates a tag on first use', async () => {
    await record(fixture.ctx, {
      kind: 'expense',
      accountId: bank,
      categoryId: food,
      amount: '100',
      bookedOn: '2026-08-01',
      tags: ['Travel'],
    });

    const tags = await listTags(fixture.ctx);
    expect(tags.map((t) => t.name)).toEqual(['Travel']);
    expect(tags[0]!.transactionCount).toBe(1);
  });

  it('treats two spellings that differ only in case as one tag (edge case 22)', async () => {
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: food, amount: '100', bookedOn: '2026-08-01', tags: ['Travel'] });
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: food, amount: '200', bookedOn: '2026-08-02', tags: ['travel'] });

    const tags = await listTags(fixture.ctx);
    expect(tags).toHaveLength(1);
    expect(tags[0]!.transactionCount).toBe(2);
  });

  it('de-duplicates two spellings inside one submission', async () => {
    await record(fixture.ctx, {
      kind: 'expense',
      accountId: bank,
      categoryId: food,
      amount: '100',
      bookedOn: '2026-08-01',
      tags: ['Travel', 'travel', 'TRAVEL'],
    });

    const tags = await listTags(fixture.ctx);
    expect(tags).toHaveLength(1);
  });

  it('merges when a tag is renamed onto an existing name (edge case 23)', async () => {
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: food, amount: '100', bookedOn: '2026-08-01', tags: ['work', 'client'] });
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: food, amount: '200', bookedOn: '2026-08-02', tags: ['client'] });

    const before = await listTags(fixture.ctx);
    const work = before.find((t) => t.name === 'work')!;

    const merged = must(await write(fixture.ctx, (w) => renameTag(w, work.id, 'client')));
    expect(merged.merged).toBe(true);

    const after = await listTags(fixture.ctx);
    expect(after).toHaveLength(1);
    expect(after[0]!.name).toBe('client');
    // The transaction that held both tags must not now hold `client` twice.
    expect(after[0]!.transactionCount).toBe(2);
  });

  it('replaces the whole tag set on edit rather than appending', async () => {
    const id = await record(fixture.ctx, {
      kind: 'expense',
      accountId: bank,
      categoryId: food,
      amount: '100',
      bookedOn: '2026-08-01',
      tags: ['one', 'two'],
    });

    await write(fixture.ctx, (w) => updateTransaction(w, id, { tags: ['three'] }));
    const txn = must(await getTransaction(fixture.ctx, id));
    expect(txn.tags.map((t) => t.name)).toEqual(['three']);
  });
});

describe('a 200-transaction fixture', () => {
  it('produces a balance matching the figure computed by hand', async () => {
    // 100 expenses of ₹100.25 and 100 incomes of ₹500.10, on consecutive days.
    // Opening 10,000 + (100 × 500.10) − (100 × 100.25) = 10,000 + 50,010 − 10,025.
    const start = isoDate('2026-01-01');

    for (let i = 0; i < 100; i += 1) {
      await record(fixture.ctx, {
        kind: 'expense',
        accountId: bank,
        categoryId: food,
        amount: '100.25',
        bookedOn: addDays(start, i),
        description: `expense ${i}`,
      });
      await record(fixture.ctx, {
        kind: 'income',
        accountId: bank,
        categoryId: salary,
        amount: '500.10',
        bookedOn: addDays(start, i),
        description: `income ${i}`,
      });
    }

    const account = must(await getAccount(fixture.ctx, bank));
    expect(toDbString(account.balance)).toBe('49985.0000');
    expect(account.entryCount).toBe(200);

    const summary = await periodSummary(fixture.ctx, {
      from: isoDate('2026-01-01'),
      to: isoDate('2026-12-31'),
    });
    expect(toDbString(summary.income)).toBe('50010.0000');
    expect(toDbString(summary.expenses)).toBe('10025.0000');
    expect(toDbString(summary.savings)).toBe('39985.0000');

    // The running balance over all 200 rows ends at the same figure.
    const { accountLedger } = await import('@/server/services');
    const ledger = must(await accountLedger(fixture.ctx, bank, { limit: 500 }));
    expect(toDbString(ledger.lines.at(-1)!.balance)).toBe('49985.0000');
  }, 120_000);
});

describe('period summaries', () => {
  it('counts only the period asked for', async () => {
    await record(fixture.ctx, { kind: 'income', accountId: bank, categoryId: salary, amount: '50000', bookedOn: '2026-07-31' });
    await record(fixture.ctx, { kind: 'income', accountId: bank, categoryId: salary, amount: '60000', bookedOn: '2026-08-01' });
    await record(fixture.ctx, { kind: 'income', accountId: bank, categoryId: salary, amount: '70000', bookedOn: '2026-09-01' });

    const august = await periodSummary(fixture.ctx, monthRange(isoDate('2026-08-15')));
    expect(toDbString(august.income)).toBe('60000.0000');
  });

  it('reports an empty period as zero with an unavailable rate', async () => {
    const summary = await periodSummary(fixture.ctx, monthRange(isoDate('2026-08-15')));
    expect(toDbString(summary.income)).toBe('0.0000');
    expect(summary.savingsRate.value).toBeNull();
    expect(summary.savingsRate.reason).toBe('divide_by_zero');
  });
});

async function ledgerVersion(): Promise<bigint> {
  const { rows } = await db().execute<{ v: string }>(
    sql`select money_ledger_version::text as v from user_state where user_id = ${fixture.userId}`,
  );
  return BigInt(rows[0]!.v);
}

async function auditCount(): Promise<number> {
  const { rows } = await db().execute<{ n: string }>(sql`select count(*)::text as n from audit_log`);
  return Number(rows[0]!.n);
}
