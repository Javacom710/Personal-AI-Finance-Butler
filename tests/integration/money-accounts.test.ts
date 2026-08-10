import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { toDbString } from '@/lib/decimal/money';
import {
  accountLedger,
  createAccount,
  createTransaction,
  deleteAccount,
  getAccount,
  listAccounts,
  setAccountActive,
  updateAccount,
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
  truncateMoney,
  write,
  type MoneyFixture,
} from './money-harness';

let fixture: MoneyFixture;
let food: string;
let salary: string;

beforeAll(async () => {
  await truncateAll();
  fixture = await setupMoneyFixture();
  food = await categoryId(fixture.ctx, 'Food');
  salary = await categoryId(fixture.ctx, 'Salary');
});

beforeEach(truncateMoney);

afterAll(async () => {
  await closeMoneyHarness();
  await closeHarness();
});

describe('creating accounts', () => {
  it('records the opening balance and derives the balance from it', async () => {
    const id = await makeAccount(fixture.ctx, { name: 'HDFC Savings', openingBalance: '125000.50' });
    const account = must(await getAccount(fixture.ctx, id));

    expect(toDbString(account.openingBalance)).toBe('125000.5000');
    expect(toDbString(account.balance)).toBe('125000.5000');
    expect(account.entryCount).toBe(0);
    expect(account.lastActivityOn).toBeNull();
  });

  it('refuses a duplicate name with a sentence, not a constraint name', async () => {
    await makeAccount(fixture.ctx, { name: 'Duplicate' });
    const second = await write(fixture.ctx, (w) =>
      createAccount(w, {
        name: 'Duplicate',
        kind: 'bank',
        currencyCode: 'INR',
        openingBalance: '0',
        openingDate: '2026-01-01',
      }),
    );

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe('conflict');
    expect(second.error.message).toContain('already exists');
  });

  it('requires a credit limit on a card', async () => {
    const result = await write(fixture.ctx, (w) =>
      createAccount(w, {
        name: 'Limitless card',
        kind: 'credit_card',
        currencyCode: 'INR',
        openingBalance: '0',
        openingDate: '2026-01-01',
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('validation_failed');
  });

  it('computes available credit without counting it as an asset', async () => {
    const card = await makeAccount(fixture.ctx, {
      name: 'HDFC Card',
      kind: 'credit_card',
      creditLimit: '200000',
    });
    await record(fixture.ctx, {
      kind: 'expense',
      accountId: card,
      categoryId: food,
      amount: '45000',
      bookedOn: '2026-08-01',
    });

    const account = must(await getAccount(fixture.ctx, card));
    expect(toDbString(account.balance)).toBe('-45000.0000');
    expect(toDbString(account.availableCredit!)).toBe('155000.0000');
    expect(account.role).toBe('liability');
  });

  it('rejects an amount with more than four decimal places', async () => {
    const result = await write(fixture.ctx, (w) =>
      createAccount(w, {
        name: 'Too precise',
        kind: 'bank',
        currencyCode: 'INR',
        openingBalance: '1.000005',
        openingDate: '2026-01-01',
      }),
    );
    expect(result.ok).toBe(false);
  });
});

describe('balances are derived, never stored', () => {
  it('reflects every entry without a backfill step', async () => {
    const bank = await makeAccount(fixture.ctx, { name: 'Bank', openingBalance: '10000' });

    await record(fixture.ctx, { kind: 'income', accountId: bank, categoryId: salary, amount: '50000', bookedOn: '2026-08-01' });
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: food, amount: '1250.75', bookedOn: '2026-08-02' });
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: food, amount: '899.25', bookedOn: '2026-08-03' });

    const account = must(await getAccount(fixture.ctx, bank));
    expect(toDbString(account.balance)).toBe('57850.0000');
    expect(account.lastActivityOn).toBe('2026-08-03');
    expect(account.entryCount).toBe(3);
  });

  it('answers a historical balance with the same query and a different bound', async () => {
    const bank = await makeAccount(fixture.ctx, { name: 'Bank', openingBalance: '10000' });
    await record(fixture.ctx, { kind: 'income', accountId: bank, categoryId: salary, amount: '5000', bookedOn: '2026-08-01' });
    await record(fixture.ctx, { kind: 'income', accountId: bank, categoryId: salary, amount: '7000', bookedOn: '2026-08-20' });

    const midMonth = must(await getAccount(fixture.ctx, bank, { asOf: '2026-08-10' as never }));
    const now = must(await getAccount(fixture.ctx, bank));

    expect(toDbString(midMonth.balance)).toBe('15000.0000');
    expect(toDbString(now.balance)).toBe('22000.0000');
  });

  it('reports the opening balance for a date before any activity (edge case 14)', async () => {
    const bank = await makeAccount(fixture.ctx, { name: 'Bank', openingBalance: '10000', openingDate: '2026-01-01' });
    await record(fixture.ctx, { kind: 'income', accountId: bank, categoryId: salary, amount: '5000', bookedOn: '2026-08-01' });

    const before = must(await getAccount(fixture.ctx, bank, { asOf: '2026-02-01' as never }));
    expect(toDbString(before.balance)).toBe('10000.0000');
  });

  it('lists every account in one query without losing the empty ones', async () => {
    await makeAccount(fixture.ctx, { name: 'Empty' });
    const used = await makeAccount(fixture.ctx, { name: 'Used', openingBalance: '100' });
    await record(fixture.ctx, { kind: 'expense', accountId: used, categoryId: food, amount: '40', bookedOn: '2026-08-01' });

    const accounts = await listAccounts(fixture.ctx);
    expect(accounts.map((a) => a.name).sort()).toEqual(['Empty', 'Used']);
    expect(toDbString(accounts.find((a) => a.name === 'Empty')!.balance)).toBe('0.0000');
    expect(toDbString(accounts.find((a) => a.name === 'Used')!.balance)).toBe('60.0000');
  });
});

describe('editing and closing', () => {
  it('renames without touching the ledger', async () => {
    const bank = await makeAccount(fixture.ctx, { name: 'Old name', openingBalance: '500' });
    await write(fixture.ctx, (w) => updateAccount(w, bank, { name: 'New name' }));

    const account = must(await getAccount(fixture.ctx, bank));
    expect(account.name).toBe('New name');
    expect(toDbString(account.balance)).toBe('500.0000');
  });

  it('closes an account with a non-zero balance rather than zeroing it (edge case 7)', async () => {
    const bank = await makeAccount(fixture.ctx, { name: 'Closing', openingBalance: '2500' });
    const closed = must(await write(fixture.ctx, (w) => setAccountActive(w, bank, false)));

    expect(closed.isActive).toBe(false);
    // Closing an account does not settle it — the balance stands and is flagged.
    expect(toDbString(closed.balance)).toBe('2500.0000');

    const active = await listAccounts(fixture.ctx);
    expect(active.map((a) => a.name)).not.toContain('Closing');

    const all = await listAccounts(fixture.ctx, { includeInactive: true });
    expect(all.map((a) => a.name)).toContain('Closing');
  });

  it('refuses a new transaction against a closed account', async () => {
    const bank = await makeAccount(fixture.ctx, { name: 'Shut' });
    await write(fixture.ctx, (w) => setAccountActive(w, bank, false));

    const result = await write(fixture.ctx, (w) =>
      createTransaction(w, {
        kind: 'expense',
        accountId: bank,
        categoryId: food,
        amount: '10',
        bookedOn: '2026-08-01',
        description: 'against a closed account',
        tags: [],
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    if (result.error.code !== 'validation_failed') throw new Error('expected a field error');
    expect(result.error.fieldErrors['accountId']?.[0]).toContain('closed');
  });

  it('refuses a transaction dated before the account opened (edge case 2)', async () => {
    const bank = await makeAccount(fixture.ctx, { name: 'Recent', openingDate: '2026-06-01' });

    const result = await write(fixture.ctx, (w) =>
      createTransaction(w, {
        kind: 'expense',
        accountId: bank,
        categoryId: food,
        amount: '10',
        bookedOn: '2026-05-31',
        description: 'before the account existed',
        tags: [],
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    if (result.error.code !== 'validation_failed') throw new Error('expected a field error');
    // The opening balance already accounts for everything before that date.
    expect(result.error.fieldErrors['bookedOn']?.[0]).toContain('opened on 2026-06-01');
  });

  it('reopens a closed account', async () => {
    const bank = await makeAccount(fixture.ctx, { name: 'Reopened' });
    await write(fixture.ctx, (w) => setAccountActive(w, bank, false));
    const reopened = must(await write(fixture.ctx, (w) => setAccountActive(w, bank, true)));
    expect(reopened.isActive).toBe(true);
  });

  it('keeps a closed account in historical totals', async () => {
    const bank = await makeAccount(fixture.ctx, { name: 'Historic', openingBalance: '0' });
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: food, amount: '750', bookedOn: '2026-08-01' });
    await write(fixture.ctx, (w) => setAccountActive(w, bank, false));

    const account = must(await getAccount(fixture.ctx, bank));
    expect(toDbString(account.balance)).toBe('-750.0000');
  });
});

describe('deleting', () => {
  it('deletes an account that has never been used', async () => {
    const bank = await makeAccount(fixture.ctx, { name: 'Never used' });
    const result = await write(fixture.ctx, (w) => deleteAccount(w, bank));
    expect(result.ok).toBe(true);
    expect((await listAccounts(fixture.ctx)).map((a) => a.name)).not.toContain('Never used');
  });

  it('refuses to delete an account with ledger history, naming the alternative', async () => {
    const bank = await makeAccount(fixture.ctx, { name: 'Used' });
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: food, amount: '10', bookedOn: '2026-08-01' });

    const result = await write(fixture.ctx, (w) => deleteAccount(w, bank));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('conflict');
    expect(result.error.message).toContain('Close it instead');
  });
});

describe('the ledger view', () => {
  it('shows a running balance that ends at the derived balance', async () => {
    const bank = await makeAccount(fixture.ctx, { name: 'Ledger', openingBalance: '1000' });
    const wallet = await makeAccount(fixture.ctx, { name: 'Wallet', kind: 'wallet' });

    await record(fixture.ctx, { kind: 'income', accountId: bank, categoryId: salary, amount: '5000', bookedOn: '2026-08-01' });
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: food, amount: '250', bookedOn: '2026-08-02' });
    await transfer(fixture.ctx, { fromAccountId: bank, toAccountId: wallet, amount: '750', bookedOn: '2026-08-03' });

    const view = must(await accountLedger(fixture.ctx, bank));
    expect(view.lines).toHaveLength(3);
    expect(view.lines.map((l) => toDbString(l.balance))).toEqual([
      '6000.0000',
      '5750.0000',
      '5000.0000',
    ]);
    expect(toDbString(view.lines.at(-1)!.balance)).toBe(toDbString(view.account.balance));
  });

  it('names the counterpart account on a transfer line', async () => {
    const bank = await makeAccount(fixture.ctx, { name: 'From' });
    const wallet = await makeAccount(fixture.ctx, { name: 'To', kind: 'wallet' });
    await transfer(fixture.ctx, { fromAccountId: bank, toAccountId: wallet, amount: '100', bookedOn: '2026-08-01' });

    const view = must(await accountLedger(fixture.ctx, bank));
    expect(view.lines[0]!.counterAccountName).toBe('To');
    expect(view.lines[0]!.categoryName).toBeNull();
  });
});

describe('authorization', () => {
  it('reports another user’s account as not found, never as forbidden', async () => {
    const other = await setupMoneyFixture();
    const theirs = await makeAccount(other.ctx, { name: 'Theirs' });

    const result = await getAccount(fixture.ctx, theirs);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Telling an attacker that an id exists but is not theirs is an enumeration
    // oracle, so ownership failures are indistinguishable from absence.
    expect(result.error.code).toBe('not_found');
  });
});
