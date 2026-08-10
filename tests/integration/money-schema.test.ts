import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  categoryId,
  closeMoneyHarness,
  makeAccount,
  rawSql,
  setupMoneyFixture,
  truncateMoney,
  type MoneyFixture,
} from './money-harness';
import { closeHarness, truncateAll } from './harness';

/**
 * The database's own guarantees.
 *
 * Every case here **bypasses the application services deliberately**. The engine
 * rejects these shapes too, and that is what the user sees — but a constraint
 * that only the application enforces is not a constraint. psql, a restore, and
 * any future script must be refused as well, which is what these assert.
 */

let fixture: MoneyFixture;
let bank: string;
let wallet: string;
let food: string;
let salary: string;

beforeAll(async () => {
  await truncateAll();
  fixture = await setupMoneyFixture();
  food = await categoryId(fixture.ctx, 'Food');
  salary = await categoryId(fixture.ctx, 'Salary');
});

beforeEach(async () => {
  await truncateMoney();
  bank = await makeAccount(fixture.ctx, { name: 'Bank', openingBalance: '10000' });
  wallet = await makeAccount(fixture.ctx, { name: 'Wallet', kind: 'wallet' });
});

afterAll(async () => {
  await closeMoneyHarness();
  await closeHarness();
});

/**
 * Insert a header and its entries as **one statement**, via a data-modifying CTE.
 *
 * One statement is its own transaction, so the deferred constraint trigger fires
 * at its end and judges the complete shape. An explicit `begin; … commit;` sent
 * as a single query string would be worse than unnecessary: a failure inside it
 * leaves the pooled connection in an aborted transaction still holding locks,
 * and the next `TRUNCATE` then waits on it forever.
 */
async function insertShape(
  header: { kind: string; categoryId?: string | null; bookedOn?: string },
  entries: { accountId: string; amount: string; currency?: string; rate?: string; base?: string }[],
): Promise<{ rows: unknown[] }> {
  const values = entries
    .map(
      (e, i) =>
        `('${e.accountId}'::uuid, ${e.amount}::numeric, '${e.currency ?? 'INR'}'::char(3), ` +
        `${e.rate ?? '1'}::numeric, ${e.base ?? e.amount}::numeric, ${i}::smallint)`,
    )
    .join(', ');

  return rawSql(`
    with t as (
      insert into transactions (user_id, kind, booked_on, description, category_id)
      values ('${fixture.userId}', '${header.kind}', '${header.bookedOn ?? '2026-08-01'}', 'shape test',
              ${header.categoryId ? `'${header.categoryId}'` : 'null'})
      returning id
    )
    insert into transaction_entries (transaction_id, account_id, amount, currency_code, fx_rate_to_base, base_amount, sort_order)
    select t.id, v.account_id, v.amount, v.currency_code, v.rate, v.base_amount, v.sort_order
      from t, (values ${values}) as v(account_id, amount, currency_code, rate, base_amount, sort_order)
  `);
}

describe('check_transaction_shape — the deferred trigger (I-1, I-2, I-3)', () => {
  it('accepts a well-formed expense', async () => {
    await expect(
      insertShape({ kind: 'expense', categoryId: food }, [{ accountId: bank, amount: '-500' }]),
    ).resolves.toBeDefined();
  });

  it('rejects an expense whose entry is positive', async () => {
    await expect(
      insertShape({ kind: 'expense', categoryId: food }, [{ accountId: bank, amount: '500' }]),
    ).rejects.toThrow(/I-1/);
  });

  it('rejects income whose entry is negative', async () => {
    await expect(
      insertShape({ kind: 'income', categoryId: salary }, [{ accountId: bank, amount: '-500' }]),
    ).rejects.toThrow(/I-1/);
  });

  it('rejects income or expense with two entries', async () => {
    await expect(
      insertShape({ kind: 'expense', categoryId: food }, [
        { accountId: bank, amount: '-500' },
        { accountId: wallet, amount: '-200' },
      ]),
    ).rejects.toThrow(/exactly one entry/);
  });

  it('rejects a header with no entries at all', async () => {
    await expect(
      rawSql(`
        insert into transactions (user_id, kind, booked_on, description, category_id)
        values ('${fixture.userId}', 'expense', '2026-08-01', 'orphan', '${food}')
      `),
    ).rejects.toThrow(/I-1/);
  });

  it('rejects income or expense with no category', async () => {
    await expect(
      insertShape({ kind: 'expense', categoryId: null }, [{ accountId: bank, amount: '-500' }]),
    ).rejects.toThrow(/requires a category/);
  });

  it('rejects an expense filed under an income category (edge case 5)', async () => {
    await expect(
      insertShape({ kind: 'expense', categoryId: salary }, [{ accountId: bank, amount: '-500' }]),
    ).rejects.toThrow(/cannot classify/);
  });

  it('rejects a transfer with a category (I-2) at the CHECK, before the trigger', async () => {
    await expect(
      insertShape({ kind: 'transfer', categoryId: food }, [
        { accountId: bank, amount: '-500' },
        { accountId: wallet, amount: '500' },
      ]),
    ).rejects.toThrow(/transactions_transfer_has_no_category/);
  });

  it('rejects a transfer with one entry', async () => {
    await expect(
      insertShape({ kind: 'transfer' }, [{ accountId: bank, amount: '-500' }]),
    ).rejects.toThrow(/exactly two entries/);
  });

  it('rejects a transfer whose entries share a sign', async () => {
    await expect(
      insertShape({ kind: 'transfer' }, [
        { accountId: bank, amount: '-500' },
        { accountId: wallet, amount: '-500' },
      ]),
    ).rejects.toThrow(/one negative and one positive/);
  });

  it('rejects a transfer to and from the same account (edge case 4)', async () => {
    await expect(
      insertShape({ kind: 'transfer' }, [
        { accountId: bank, amount: '-500' },
        { accountId: bank, amount: '500' },
      ]),
    ).rejects.toThrow(/two distinct accounts/);
  });

  it('rejects a same-currency transfer whose base amounts do not cancel (edge case 27)', async () => {
    await expect(
      insertShape({ kind: 'transfer' }, [
        { accountId: bank, amount: '-500' },
        { accountId: wallet, amount: '499' },
      ]),
    ).rejects.toThrow(/I-3/);
  });

  it('allows a cross-currency transfer to leave a residual (edge case 3)', async () => {
    const usd = await makeAccount(fixture.ctx, { name: 'USD account', currencyCode: 'USD' });
    await expect(
      insertShape({ kind: 'transfer' }, [
        { accountId: usd, amount: '-100', currency: 'USD', rate: '83', base: '-8300' },
        { accountId: bank, amount: '8250', base: '8250' },
      ]),
    ).resolves.toBeDefined();
  });
});

describe('column constraints', () => {
  it('rejects a zero amount (edge case 1)', async () => {
    await expect(
      insertShape({ kind: 'expense', categoryId: food }, [{ accountId: bank, amount: '0' }]),
    ).rejects.toThrow(/tx_entry_amount_non_zero/);
  });

  it('rejects a base amount inconsistent with its rate (edge case 26, I-11)', async () => {
    await expect(
      insertShape({ kind: 'expense', categoryId: food }, [
        { accountId: bank, amount: '-500', rate: '2', base: '-500' },
      ]),
    ).rejects.toThrow(/tx_entry_base_amount_consistent/);
  });

  it('accepts a base amount that matches round(amount × rate, 4) exactly', async () => {
    await expect(
      insertShape({ kind: 'expense', categoryId: food }, [
        { accountId: bank, amount: '-100', currency: 'USD', rate: '83.12345', base: '-8312.3450' },
      ]),
    ).resolves.toBeDefined();
  });

  it('rejects a non-positive FX rate', async () => {
    await expect(
      insertShape({ kind: 'expense', categoryId: food }, [
        { accountId: bank, amount: '-500', rate: '0', base: '0' },
      ]),
    ).rejects.toThrow();
  });

  it('rejects a credit card with no limit', async () => {
    await expect(
      rawSql(`
        insert into accounts (user_id, name, kind, currency_code, opening_date)
        values ('${fixture.userId}', 'Limitless', 'credit_card', 'INR', '2026-01-01')
      `),
    ).rejects.toThrow(/accounts_card_has_limit/);
  });

  it('rejects a duplicate account name for one user', async () => {
    await expect(
      rawSql(`
        insert into accounts (user_id, name, kind, currency_code, opening_date)
        values ('${fixture.userId}', 'Bank', 'bank', 'INR', '2026-01-01')
      `),
    ).rejects.toThrow(/accounts_user_name_uniq/);
  });

  it('rejects a non-positive budget amount', async () => {
    await expect(
      rawSql(`
        insert into budgets (user_id, category_id, period, amount, currency_code, starts_on)
        values ('${fixture.userId}', '${food}', 'monthly', 0, 'INR', '2026-08-01')
      `),
    ).rejects.toThrow(/budgets_amount_positive/);
  });

  it('allows only one active budget per category and period', async () => {
    await rawSql(`
      insert into budgets (user_id, category_id, period, amount, currency_code, starts_on)
      values ('${fixture.userId}', '${food}', 'monthly', 10000, 'INR', '2026-08-01')
    `);
    await expect(
      rawSql(`
        insert into budgets (user_id, category_id, period, amount, currency_code, starts_on)
        values ('${fixture.userId}', '${food}', 'monthly', 20000, 'INR', '2026-08-01')
      `),
    ).rejects.toThrow(/budgets_active_uniq/);
  });

  it('allows a second budget once the first is inactive', async () => {
    await rawSql(`
      insert into budgets (user_id, category_id, period, amount, currency_code, starts_on, is_active)
      values ('${fixture.userId}', '${food}', 'monthly', 10000, 'INR', '2026-01-01', false)
    `);
    await expect(
      rawSql(`
        insert into budgets (user_id, category_id, period, amount, currency_code, starts_on)
        values ('${fixture.userId}', '${food}', 'monthly', 20000, 'INR', '2026-08-01')
      `),
    ).resolves.toBeDefined();
  });

  it('allows only one occurrence per rule and due date (I-9, ADR-15)', async () => {
    const { rows } = await rawSql(`
      insert into recurring_rules (user_id, name, kind, template, rrule, starts_on)
      values ('${fixture.userId}', 'Rent', 'expense', '{}'::jsonb, 'FREQ=MONTHLY', '2026-01-01')
      returning id
    `);
    const ruleId = (rows[0] as { id: string }).id;

    await rawSql(`insert into recurring_occurrences (rule_id, due_on) values ('${ruleId}', '2026-08-01')`);
    await expect(
      rawSql(`insert into recurring_occurrences (rule_id, due_on) values ('${ruleId}', '2026-08-01')`),
    ).rejects.toThrow(/recurring_occurrences_rule_due_uniq/);
  });
});

describe('check_category_shape', () => {
  it('rejects a third level', async () => {
    const groceries = await categoryId(fixture.ctx, 'Groceries');
    await expect(
      rawSql(`
        insert into categories (user_id, name, kind, parent_id)
        values ('${fixture.userId}', 'Organic', 'expense', '${groceries}')
      `),
    ).rejects.toThrow(/two levels/);
  });

  it('rejects a child whose kind differs from its parent’s', async () => {
    await expect(
      rawSql(`
        insert into categories (user_id, name, kind, parent_id)
        values ('${fixture.userId}', 'Refunds', 'income', '${food}')
      `),
    ).rejects.toThrow(/share its parent/);
  });

  it('rejects a category that is its own parent', async () => {
    await expect(
      rawSql(`update categories set parent_id = id where id = '${food}'`),
    ).rejects.toThrow(/own parent/);
  });

  it('rejects turning a parent into a child', async () => {
    const transport = await categoryId(fixture.ctx, 'Transport');
    await expect(
      rawSql(`update categories set parent_id = '${transport}' where id = '${food}'`),
    ).rejects.toThrow(/has children/);
  });

  it('rejects two top-level categories with the same name (NULLS NOT DISTINCT)', async () => {
    await expect(
      rawSql(`
        insert into categories (user_id, name, kind) values ('${fixture.userId}', 'Food', 'expense')
      `),
    ).rejects.toThrow(/categories_user_parent_name_uniq/);
  });
});

describe('referential integrity', () => {
  it('blocks deleting a category that classifies a transaction (edge case 6)', async () => {
    await insertShape({ kind: 'expense', categoryId: food }, [{ accountId: bank, amount: '-500' }]);
    await expect(rawSql(`delete from categories where id = '${food}'`)).rejects.toThrow();
  });

  it('blocks deleting an account with ledger entries', async () => {
    await insertShape({ kind: 'expense', categoryId: food }, [{ accountId: bank, amount: '-500' }]);
    await expect(rawSql(`delete from accounts where id = '${bank}'`)).rejects.toThrow();
  });

  it('cascades entries when their transaction is deleted', async () => {
    await insertShape({ kind: 'expense', categoryId: food }, [{ accountId: bank, amount: '-500' }]);
    await rawSql(`delete from transactions where user_id = '${fixture.userId}'`);
    const { rows } = await rawSql('select count(*)::int as n from transaction_entries');
    expect((rows[0] as { n: number }).n).toBe(0);
  });

  it('keeps only one tag per name, case-insensitively', async () => {
    await rawSql(`insert into tags (user_id, name) values ('${fixture.userId}', 'Travel')`);
    await expect(
      rawSql(`insert into tags (user_id, name) values ('${fixture.userId}', 'travel')`),
    ).rejects.toThrow(/tags_user_name_ci_uniq/);
  });
});
