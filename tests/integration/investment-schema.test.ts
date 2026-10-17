/**
 * The investment `CHECK` constraints, asserted by **direct `INSERT`s that bypass
 * the service layer** (TESTING.md §4).
 *
 * A rule enforced only in TypeScript is not enforced against a restore, a
 * migration script, or `psql`. Every constraint below is the last line of
 * defence for an invariant the engine also maintains — and the point of these
 * tests is that the two are independent.
 */

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/server/db/client';
import { closeHarness } from './harness';
import { closeMoneyHarness, makeAccount, setupMoneyFixture, truncateMoney } from './money-harness';
import { makeInstrument, rawSql, truncateInvestments } from './investment-harness';

let userId: string;
let accountId: string;
let instrumentId: string;

beforeAll(async () => {
  await truncateInvestments();
  await truncateMoney();
});

beforeEach(async () => {
  await truncateInvestments();
  await truncateMoney();
  const fixture = await setupMoneyFixture();
  userId = fixture.userId;
  accountId = await makeAccount(fixture.ctx, { name: 'Zerodha', kind: 'brokerage' });
  instrumentId = await makeInstrument(fixture.ctx, { symbol: 'RELIANCE' });
});

afterAll(async () => {
  await closeMoneyHarness();
  await closeHarness();
});

/**
 * Insert a ledger row with every column named, so a test can break exactly one
 * of them. Defaults form a valid `buy` of 100 @ ₹100.
 */
async function insertRow(over: Record<string, string> = {}): Promise<void> {
  const v = {
    kind: `'buy'`,
    trade_date: `'2026-01-01'`,
    quantity: `100`,
    price: `100`,
    gross_amount: `10000`,
    fees: `0`,
    taxes: `0`,
    currency_code: `'INR'`,
    net_amount_instrument: `-10000`,
    fx_rate_instrument_to_account: `1`,
    net_amount: `-10000`,
    fx_rate_to_base: `1`,
    base_net_amount: `-10000`,
    ratio_num: `null`,
    ratio_den: `null`,
    original_acquired_on: `null`,
    cash_settled: `true`,
    instrument_id: `'${instrumentId}'::uuid`,
    ...over,
  };

  await rawSql(`
    insert into investment_transactions (
      user_id, account_id, instrument_id, kind, trade_date, quantity, price, gross_amount,
      fees, taxes, currency_code, net_amount_instrument, fx_rate_instrument_to_account,
      net_amount, fx_rate_to_base, base_net_amount, ratio_num, ratio_den,
      original_acquired_on, cash_settled
    ) values (
      '${userId}'::uuid, '${accountId}'::uuid, ${v.instrument_id}, ${v.kind}, ${v.trade_date},
      ${v.quantity}, ${v.price}, ${v.gross_amount}, ${v.fees}, ${v.taxes}, ${v.currency_code},
      ${v.net_amount_instrument}, ${v.fx_rate_instrument_to_account}, ${v.net_amount},
      ${v.fx_rate_to_base}, ${v.base_net_amount}, ${v.ratio_num}, ${v.ratio_den},
      ${v.original_acquired_on}, ${v.cash_settled}
    )
  `);
}

const rejects = async (over: Record<string, string>, constraint: string): Promise<void> => {
  await expect(insertRow(over)).rejects.toThrow(new RegExp(constraint));
};

describe('the baseline row is accepted, so a rejection below means something', () => {
  it('inserts a valid buy', async () => {
    await expect(insertRow()).resolves.toBeUndefined();
    const { rows } = await db().execute<{ n: string }>(
      sql`select count(*)::text as n from investment_transactions where user_id = ${userId}`,
    );
    expect(rows[0]!.n).toBe('1');
  });
});

describe('investment_transactions CHECK constraints', () => {
  it('I-16 — rejects an unsettled row that carries a cash effect', async () => {
    // Every other constraint is satisfied: the three denominations are
    // consistent with each other and the buy identity holds. Only
    // `cash_settled = false` with a non-zero amount is wrong, so the rejection
    // isolates I-16 rather than tripping over a neighbouring constraint.
    await rejects({ cash_settled: 'false' }, 'inv_txn_unsettled_moves_no_cash');
  });

  it('I-16 — rejects a corporate action that moves cash', async () => {
    await rejects(
      {
        kind: `'split'`,
        quantity: 'null',
        price: 'null',
        gross_amount: 'null',
        ratio_num: '2',
        ratio_den: '1',
        cash_settled: 'false',
        net_amount: '-1',
        net_amount_instrument: '-1',
        base_net_amount: '-1',
      },
      'inv_txn_(unsettled_moves_no_cash|corporate_action_shape)',
    );
  });

  it('rejects a gross_amount that disagrees with |quantity| × price', async () => {
    await rejects(
      { gross_amount: '9999', net_amount_instrument: '-9999', net_amount: '-9999', base_net_amount: '-9999' },
      'inv_txn_gross_identity',
    );
  });

  it('rejects a buy whose net does not equal −(gross + fees + taxes)', async () => {
    await rejects(
      { fees: '50', net_amount_instrument: '-10000', net_amount: '-10000', base_net_amount: '-10000' },
      'inv_txn_buy_net_identity',
    );
  });

  it('rejects a sell whose net does not equal gross − fees − taxes', async () => {
    await rejects(
      {
        kind: `'sell'`,
        quantity: '-100',
        fees: '30',
        net_amount_instrument: '10000',
        net_amount: '10000',
        base_net_amount: '10000',
      },
      'inv_txn_sell_net_identity',
    );
  });

  it('I-12 — rejects a dividend whose net does not equal gross − fees − taxes', async () => {
    await rejects(
      {
        kind: `'dividend'`,
        quantity: 'null',
        price: 'null',
        gross_amount: '500',
        taxes: '50',
        net_amount_instrument: '500',
        net_amount: '500',
        base_net_amount: '500',
      },
      'inv_txn_income_identity',
    );
  });

  it('I-12 — rejects a dividend with a non-positive net', async () => {
    await rejects(
      {
        kind: `'dividend'`,
        quantity: 'null',
        price: 'null',
        gross_amount: '50',
        taxes: '50',
        net_amount_instrument: '0',
        net_amount: '0',
        base_net_amount: '0',
      },
      'inv_txn_income_identity',
    );
  });

  it('rejects a split carrying a quantity or a price', async () => {
    await rejects(
      {
        kind: `'split'`,
        ratio_num: '5',
        ratio_den: '1',
        cash_settled: 'false',
        net_amount: '0',
        net_amount_instrument: '0',
        base_net_amount: '0',
      },
      'inv_txn_(ratio_shape|corporate_action_shape)',
    );
  });

  it('rejects a ratio on anything but a corporate action', async () => {
    await rejects({ ratio_num: '5', ratio_den: '1' }, 'inv_txn_ratio_only_on_corporate_actions');
  });

  it('rejects a transfer carrying fees', async () => {
    await rejects(
      {
        kind: `'transfer_in'`,
        fees: '10',
        net_amount: '0',
        net_amount_instrument: '0',
        base_net_amount: '0',
        cash_settled: 'false',
      },
      'inv_txn_transfer_no_cash',
    );
  });

  it('rejects a transfer that moves cash', async () => {
    await rejects(
      { kind: `'transfer_out'`, quantity: '-100', cash_settled: 'false' },
      'inv_txn_(transfer_no_cash|unsettled_moves_no_cash)',
    );
  });

  it('rejects a buy with a negative quantity, and a sell with a positive one', async () => {
    await rejects({ quantity: '-100' }, 'inv_txn_acquire_shape');
    await rejects(
      {
        kind: `'sell'`,
        quantity: '100',
        net_amount_instrument: '10000',
        net_amount: '10000',
        base_net_amount: '10000',
      },
      'inv_txn_dispose_shape',
    );
  });

  it('rejects a trade with no instrument', async () => {
    await rejects({ instrument_id: 'null' }, 'inv_txn_instrument_required');
  });

  it('rejects an acquisition whose total cost rounds to zero', async () => {
    // A lot with units and no basis is forbidden by I-19, so the purchase that
    // would create one is refused at the source rather than mid-rebuild.
    await rejects(
      {
        quantity: '0.00000001',
        price: '0.00000001',
        gross_amount: '0',
        net_amount_instrument: '0',
        net_amount: '0',
        base_net_amount: '0',
      },
      'inv_txn_acquisition_has_cost',
    );
  });

  it('I-11 — rejects a broken link in the three-denomination chain', async () => {
    await rejects(
      { fx_rate_instrument_to_account: '2', net_amount: '-10000' },
      'inv_txn_account_amount_consistent',
    );
    await rejects({ fx_rate_to_base: '2', base_net_amount: '-10000' }, 'inv_txn_base_amount_consistent');
  });

  it('rejects a negative fee or tax', async () => {
    await rejects(
      { fees: '-1', net_amount_instrument: '-9999', net_amount: '-9999', base_net_amount: '-9999' },
      'inv_txn_fees_non_negative',
    );
  });

  it('rejects a non-positive FX rate', async () => {
    // The chain stays consistent at a rate of zero (0 × anything is 0), so this
    // rejection is the positivity check and not a knock-on failure.
    await rejects(
      { fx_rate_instrument_to_account: '0', net_amount: '0', base_net_amount: '0' },
      'inv_txn_fx_instrument_positive',
    );
  });

  it('rejects an original acquisition date after the trade date', async () => {
    // holding_days would be negative, and the failure would otherwise surface
    // against `lot_disposals` mid-rebuild rather than against the row at fault.
    await rejects(
      {
        kind: `'transfer_in'`,
        net_amount: '0',
        net_amount_instrument: '0',
        base_net_amount: '0',
        cash_settled: 'false',
        original_acquired_on: `'2027-01-01'`,
      },
      'inv_txn_original_acquired_not_in_future',
    );
  });

  it('rejects an original acquisition date on anything but a transfer_in', async () => {
    await rejects(
      { original_acquired_on: `'2025-01-01'` },
      'inv_txn_original_acquired_only_on_transfer_in',
    );
  });
});

describe('tax_lots and lot_disposals CHECK constraints', () => {
  async function insertLot(over: Record<string, string> = {}): Promise<string> {
    await insertRow();
    const { rows } = await db().execute<{ id: string }>(
      sql`select id::text from investment_transactions where user_id = ${userId} limit 1`,
    );
    const txnId = rows[0]!.id;

    const v = {
      original_quantity: '100',
      remaining_quantity: '100',
      cost_total: '10000',
      remaining_cost: '10000',
      ...over,
    };

    await rawSql(`
      insert into tax_lots (
        user_id, account_id, instrument_id, opened_by_txn_id, opened_on, acquired_on,
        original_quantity, remaining_quantity, cost_total, remaining_cost,
        currency_code, fx_rate_to_base
      ) values (
        '${userId}'::uuid, '${accountId}'::uuid, '${instrumentId}'::uuid, '${txnId}'::uuid,
        '2026-01-01', '2026-01-01', ${v.original_quantity}, ${v.remaining_quantity},
        ${v.cost_total}, ${v.remaining_cost}, 'INR', 1
      )
    `);
    return txnId;
  }

  it('accepts a well-formed lot', async () => {
    await expect(insertLot()).resolves.toBeDefined();
  });

  it('I-19 — rejects a lot with units but no basis', async () => {
    await expect(insertLot({ remaining_cost: '0' })).rejects.toThrow(
      /tax_lots_units_and_basis_drain_together/,
    );
  });

  it('I-19 — rejects a lot with basis but no units', async () => {
    await expect(insertLot({ remaining_quantity: '0' })).rejects.toThrow(
      /tax_lots_units_and_basis_drain_together/,
    );
  });

  it('rejects remaining beyond original, in units and in money', async () => {
    await expect(insertLot({ remaining_quantity: '150' })).rejects.toThrow(
      /tax_lots_remaining_within_original_qty/,
    );
    await expect(insertLot({ remaining_cost: '15000' })).rejects.toThrow(
      /tax_lots_remaining_within_original_cost/,
    );
  });

  it('I-15 — rejects a disposal where realized_pnl ≠ proceeds − cost_consumed', async () => {
    const txnId = await insertLot({ remaining_quantity: '60', remaining_cost: '6000' });
    const { rows } = await db().execute<{ id: string }>(
      sql`select id::text from tax_lots where user_id = ${userId} limit 1`,
    );
    const lotId = rows[0]!.id;

    await expect(
      rawSql(`
        insert into lot_disposals (
          user_id, lot_id, closed_by_txn_id, closed_on, quantity, proceeds, cost_consumed,
          realized_pnl, fx_rate_to_base, base_realized_pnl, base_fx_component, holding_days
        ) values (
          '${userId}'::uuid, '${lotId}'::uuid, '${txnId}'::uuid, '2026-06-01',
          40, 6000, 4000, 9999, 1, 2000, 0, 151
        )
      `),
    ).rejects.toThrow(/lot_disposal_pnl_identity/);
  });
});

describe('positions CHECK constraints', () => {
  it('I-7 — rejects a negative position quantity', async () => {
    await expect(
      rawSql(`
        insert into positions (
          user_id, account_id, instrument_id, quantity, cost_basis, base_cost_basis, ledger_version
        ) values ('${userId}'::uuid, '${accountId}'::uuid, '${instrumentId}'::uuid, -1, 100, 100, 1)
      `),
    ).rejects.toThrow(/positions_quantity_non_negative/);
  });

  it('rejects a position with units but no basis', async () => {
    await expect(
      rawSql(`
        insert into positions (
          user_id, account_id, instrument_id, quantity, cost_basis, base_cost_basis, ledger_version
        ) values ('${userId}'::uuid, '${accountId}'::uuid, '${instrumentId}'::uuid, 10, 0, 0, 1)
      `),
    ).rejects.toThrow(/positions_units_and_basis_agree/);
  });
});

/**
 * A foreign key's `ON DELETE` rule, read from the catalogue (`'r'` = RESTRICT).
 *
 * The rule is asserted directly rather than through the error. PostgreSQL 18
 * reports a RESTRICT violation with its own SQLSTATE (`23001`
 * restrict_violation) and message ("violates RESTRICT setting of foreign key
 * constraint"). PostgreSQL 17 — the version the schema targets, CI runs and
 * production deploys — reports RESTRICT and NO ACTION alike (`23503`
 * foreign_key_violation), so the error alone cannot tell them apart there.
 */
async function deleteRuleOf(constraint: string): Promise<string> {
  const { rows } = await rawSql(`select confdeltype from pg_constraint where conname = $1`, [
    constraint,
  ]);
  expect(rows).toHaveLength(1);
  return (rows[0] as { confdeltype: string }).confdeltype;
}

/** The delete was refused by a foreign key: `23001` on PostgreSQL 18+, `23503` before. */
const FK_DELETE_REFUSED = expect.stringMatching(/^(23001|23503)$/);

describe('foreign keys and uniqueness', () => {
  it('blocks deleting an account that carries investment history', async () => {
    await insertRow();
    await expect(rawSql(`delete from accounts where id = '${accountId}'`)).rejects.toMatchObject({
      code: FK_DELETE_REFUSED,
      constraint: 'investment_transactions_account_id_accounts_id_fk',
    });
    expect(await deleteRuleOf('investment_transactions_account_id_accounts_id_fk')).toBe('r');
  });

  it('blocks deleting an instrument that has been traded', async () => {
    await insertRow();
    await expect(
      rawSql(`delete from instruments where id = '${instrumentId}'`),
    ).rejects.toMatchObject({
      code: FK_DELETE_REFUSED,
      constraint: 'investment_transactions_instrument_id_instruments_id_fk',
    });
    expect(await deleteRuleOf('investment_transactions_instrument_id_instruments_id_fk')).toBe('r');
  });

  it('treats a null exchange as NOT distinct, so a mutual fund cannot be created twice', async () => {
    await rawSql(`
      insert into instruments (user_id, symbol, exchange, name, asset_class, currency_code)
      values ('${userId}'::uuid, 'PPFAS', null, 'PPFAS Flexi Cap', 'mutual_fund', 'INR')
    `);
    await expect(
      rawSql(`
        insert into instruments (user_id, symbol, exchange, name, asset_class, currency_code)
        values ('${userId}'::uuid, 'PPFAS', null, 'PPFAS Flexi Cap', 'mutual_fund', 'INR')
      `),
    ).rejects.toThrow(/instruments_user_symbol_exchange_uniq/);
  });
});
