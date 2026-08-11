import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { verifyIntegrity } from '@/server/db/integrity';
import { closeHarness, truncateAll } from './harness';
import {
  categoryId,
  closeMoneyHarness,
  makeAccount,
  rawSql,
  record,
  setupMoneyFixture,
  transfer,
  truncateMoney,
  type MoneyFixture,
} from './money-harness';

/**
 * `verify:integrity` (SCHEMA.md §12).
 *
 * The second test is the one that matters: a checker that has never caught
 * anything is indistinguishable from a checker that cannot. Each invariant is
 * therefore deliberately violated — with the triggers disabled, since they exist
 * precisely to make this impossible through normal channels — and the checker is
 * required to notice.
 */

const url = process.env['TEST_DATABASE_URL']!;

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

/** Run a corruption with the shape triggers off, then check and restore. */
async function withTriggersDisabled(fn: () => Promise<void>): Promise<void> {
  await rawSql('alter table transactions disable trigger transactions_shape_check');
  await rawSql('alter table transaction_entries disable trigger transaction_entries_shape_check');
  try {
    await fn();
  } finally {
    await rawSql('alter table transactions enable trigger transactions_shape_check');
    await rawSql('alter table transaction_entries enable trigger transaction_entries_shape_check');
  }
}

/**
 * Drop a `CHECK`, corrupt, verify, and put the constraint back **exactly** as
 * the migration created it.
 *
 * Restoring it as `NOT VALID` would leave the schema subtly different from the
 * one the migration produces, which `migrations.test.ts` compares byte for byte
 * — and it did catch precisely that. The corrupt rows are removed first so the
 * plain `ADD CONSTRAINT` can validate what is left.
 */
async function withConstraintDropped(
  table: string,
  constraint: string,
  definition: string,
  fn: () => Promise<void>,
): Promise<void> {
  await rawSql(`alter table ${table} drop constraint ${constraint}`);
  try {
    await fn();
  } finally {
    await truncateMoney();
    await rawSql(`alter table ${table} add constraint ${constraint} ${definition}`);
  }
}

describe('a healthy database', () => {
  it('passes every applicable invariant when empty', async () => {
    const report = await verifyIntegrity(url);
    expect(report.passed).toBe(true);
    expect(report.failedCount).toBe(0);
  });

  it('passes with a realistic ledger', async () => {
    await record(fixture.ctx, { kind: 'income', accountId: bank, categoryId: salary, amount: '50000', bookedOn: '2026-08-01' });
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: food, amount: '1250', bookedOn: '2026-08-02' });
    await transfer(fixture.ctx, { fromAccountId: bank, toAccountId: wallet, amount: '5000', bookedOn: '2026-08-03' });

    const report = await verifyIntegrity(url);
    expect(report.passed).toBe(true);
  });

  it('reports the later phases’ invariants as not yet applicable, rather than as passing', async () => {
    const report = await verifyIntegrity(url);
    const skipped = report.checks.filter((c) => c.status === 'skipped').map((c) => c.invariant);

    // A checker that silently covers less than it claims is worse than none.
    // Phase 4 moved I-5, I-6, I-7 and I-12 out of this list by implementing the
    // tables they describe; what remains is net worth (Phase 5) and AI (Phase 9).
    expect(skipped).toEqual(expect.arrayContaining(['I-8', 'I-10', 'I-14']));
    expect(skipped).not.toContain('I-5');
    expect(skipped).not.toContain('I-6');
    expect(skipped).not.toContain('I-7');
    expect(skipped).not.toContain('I-12');
  });

  it('checks every investment invariant Phase 4 is responsible for', async () => {
    const report = await verifyIntegrity(url);
    const checked = report.checks.filter((c) => c.status !== 'skipped').map((c) => c.invariant);

    for (const invariant of ['I-5', 'I-6', 'I-7', 'I-12', 'I-13', 'I-15', 'I-16', 'I-17', 'I-18', 'I-19', 'I-20']) {
      expect(checked, `${invariant} must be checked, not skipped`).toContain(invariant);
    }
  });

  it('asserts NEITHER declared non-invariant', async () => {
    // Both are intuitive, will be assumed, and are false (SCHEMA.md §12).
    // Asserting either would fail on legitimate data after a corporate action,
    // or report the whole portfolio stale forever.
    const report = await verifyIntegrity(url);
    const descriptions = report.checks.map((c) => c.description).join(' | ');
    expect(descriptions).not.toMatch(/lot_disposals\.quantity \+ .*original_quantity/);
    expect(descriptions).not.toMatch(/ledger_version\s*=\s*.*investment_ledger_version/);
  });
});

describe('a corrupted database', () => {
  it('catches an entry count that does not match the kind (I-1)', async () => {
    const id = await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: food, amount: '500', bookedOn: '2026-08-01' });

    await withTriggersDisabled(async () => {
      await rawSql(
        `insert into transaction_entries (transaction_id, account_id, amount, currency_code, fx_rate_to_base, base_amount)
         values ($1, $2, -100, 'INR', 1, -100)`,
        [id, wallet],
      );
    });

    const report = await verifyIntegrity(url);
    expect(report.passed).toBe(false);
    const check = report.checks.find((c) => c.invariant === 'I-1')!;
    expect(check.status).toBe('failed');
    expect(check.violations).toBe(1);
  });

  it('catches a transfer that acquired a category (I-2)', async () => {
    const created = await transfer(fixture.ctx, { fromAccountId: bank, toAccountId: wallet, amount: '500', bookedOn: '2026-08-01' });

    // The CHECK constraint has to go too — it is a stronger guard than the trigger.
    await withConstraintDropped(
      'transactions',
      'transactions_transfer_has_no_category',
      `check (kind <> 'transfer' or category_id is null)`,
      async () => {
        await withTriggersDisabled(async () => {
          await rawSql('update transactions set category_id = $1 where id = $2', [food, created.transaction.id]);
        });

        const report = await verifyIntegrity(url);
        expect(report.checks.find((c) => c.invariant === 'I-2')!.status).toBe('failed');
      },
    );
  });

  it('catches an expense filed under an income category (I-2b)', async () => {
    const id = await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: food, amount: '500', bookedOn: '2026-08-01' });

    await withTriggersDisabled(async () => {
      await rawSql('update transactions set category_id = $1 where id = $2', [salary, id]);
    });

    const report = await verifyIntegrity(url);
    expect(report.checks.find((c) => c.invariant === 'I-2b')!.status).toBe('failed');
  });

  it('catches a same-currency transfer that no longer nets to zero (I-3)', async () => {
    const created = await transfer(fixture.ctx, { fromAccountId: bank, toAccountId: wallet, amount: '500', bookedOn: '2026-08-01' });

    await withTriggersDisabled(async () => {
      await rawSql(
        `update transaction_entries set amount = 499, base_amount = 499
          where transaction_id = $1 and amount > 0`,
        [created.transaction.id],
      );
    });

    const report = await verifyIntegrity(url);
    expect(report.checks.find((c) => c.invariant === 'I-3')!.status).toBe('failed');
  });

  it('catches an entry whose currency no longer matches its account (I-4)', async () => {
    const id = await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: food, amount: '500', bookedOn: '2026-08-01' });

    await withConstraintDropped(
      'transaction_entries',
      'tx_entry_base_amount_consistent',
      'check (base_amount = round(amount * fx_rate_to_base, 4))',
      async () => {
        await withTriggersDisabled(async () => {
          await rawSql(`update transaction_entries set currency_code = 'USD' where transaction_id = $1`, [id]);
        });

        const report = await verifyIntegrity(url);
        expect(report.checks.find((c) => c.invariant === 'I-4')!.status).toBe('failed');
      },
    );
  });

  it('catches a base amount that drifted from its rate (I-11)', async () => {
    const id = await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: food, amount: '500', bookedOn: '2026-08-01' });

    await withConstraintDropped(
      'transaction_entries',
      'tx_entry_base_amount_consistent',
      'check (base_amount = round(amount * fx_rate_to_base, 4))',
      async () => {
        await withTriggersDisabled(async () => {
          await rawSql('update transaction_entries set base_amount = -999 where transaction_id = $1', [id]);
        });

        const report = await verifyIntegrity(url);
        expect(report.checks.find((c) => c.invariant === 'I-11')!.status).toBe('failed');
      },
    );
  });

  it('catches an occurrence marked posted with no transaction behind it (I-9)', async () => {
    const { rows } = await rawSql(
      `insert into recurring_rules (user_id, name, kind, template, rrule, starts_on)
       values ($1, 'Rent', 'expense', '{}'::jsonb, 'FREQ=MONTHLY', '2026-01-01')
       returning id`,
      [fixture.userId],
    );
    const ruleId = (rows[0] as { id: string }).id;

    await rawSql(
      `insert into recurring_occurrences (rule_id, due_on, status) values ($1, '2026-08-01', 'posted')`,
      [ruleId],
    );

    const report = await verifyIntegrity(url);
    expect(report.checks.find((c) => c.invariant === 'I-9')!.status).toBe('failed');
  });

  it('reports a sample of the offending rows, not just a count', async () => {
    const id = await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: food, amount: '500', bookedOn: '2026-08-01' });
    await withTriggersDisabled(async () => {
      await rawSql('update transactions set category_id = $1 where id = $2', [salary, id]);
    });

    const report = await verifyIntegrity(url);
    const check = report.checks.find((c) => c.invariant === 'I-2b')!;
    expect(check.samples).toHaveLength(1);
    expect(check.samples[0]).toMatchObject({ transaction_kind: 'expense', category_kind: 'income' });
  });
});
