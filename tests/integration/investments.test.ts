/**
 * The investment write path, against a real database (TESTING.md §4).
 *
 * These are the tests that only a database can run: the rebuild sharing the
 * mutation's transaction, the three-denomination cash chain, and the Phase 3
 * integration points where an investment movement has to reach an account
 * balance without also becoming income or an expense.
 */

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/server/db/client';
import { isoDate } from '@/lib/date';
import { toDbString } from '@/lib/decimal/money';
import {
  accountLedger,
  periodSummary,
  createReadCtx,
  getAccount,
  listInvestmentTransactions,
  portfolio,
  rebuildAllPositions,
  type RequestCtx,
} from '@/server/services';
import { closeHarness } from './harness';
import {
  addFxRate,
  categoryId,
  closeMoneyHarness,
  makeAccount,
  must,
  record,
  setupMoneyFixture,
  transfer,
  truncateMoney,
  write,
} from './money-harness';
import {
  derivedFingerprint,
  investmentLedgerVersion,
  lotSnapshot,
  makeInstrument,
  positionSnapshot,
  priceIt,
  recordBuy,
  recordCharge,
  recordCorporateAction,
  recordDividend,
  recordSell,
  recordTransferIn,
  recordTransferOut,
  truncateInvestments,
} from './investment-harness';

let userId: string;
let ctx: RequestCtx;
let brokerage: string;
let bank: string;
let reliance: string;

const NOW = new Date('2026-08-11T12:00:00Z');

/** One user per file: provisioning one costs eleven Argon2id hashes at 128 MiB. */
beforeAll(async () => {
  await truncateInvestments();
  await truncateMoney();
  const fixture = await setupMoneyFixture({ now: NOW });
  userId = fixture.userId;
});

beforeEach(async () => {
  await truncateInvestments();
  await truncateMoney();
  const rebuilt = await createReadCtx(userId, { now: NOW });
  if (!rebuilt.ok) throw new Error('context');
  ctx = rebuilt.value;

  brokerage = await makeAccount(ctx, {
    name: 'Zerodha',
    kind: 'brokerage',
    openingBalance: '100000',
    openingDate: '2025-01-01',
  });
  bank = await makeAccount(ctx, {
    name: 'HDFC',
    kind: 'bank',
    openingBalance: '500000',
    openingDate: '2025-01-01',
  });
  reliance = await makeInstrument(ctx, { symbol: 'RELIANCE', name: 'Reliance Industries' });
});

afterAll(async () => {
  await closeMoneyHarness();
  await closeHarness();
});

const balanceOf = async (accountId: string): Promise<string> => {
  const account = must(await getAccount(ctx, accountId));
  return toDbString(account.balance);
};

// ---------------------------------------------------------------------------
// buys, cash and lots
// ---------------------------------------------------------------------------

describe('a purchase', () => {
  it('opens a lot, creates a position, and reduces the brokerage cash', async () => {
    must(
      await recordBuy(ctx, {
        accountId: brokerage,
        instrumentId: reliance,
        on: '2026-01-01',
        qty: '100',
        price: '100',
        fees: '50',
      }),
    );

    const lots = await lotSnapshot(userId, reliance);
    expect(lots).toHaveLength(1);
    expect(lots[0]!.costTotal).toBe('10050.0000');
    expect(lots[0]!.remainingQuantity).toBe('100.00000000');

    const position = await positionSnapshot(userId, reliance);
    expect(position?.costBasis).toBe('10050.0000');
    expect(position?.baseCostBasis).toBe('10050.0000');

    // ₹100,000 − ₹10,050. The cash effect reaches the balance through the
    // investment ledger alone; no mirroring `transactions` row exists.
    expect(await balanceOf(brokerage)).toBe('89950.0000');
  });

  it('writes no mirroring transactions row — I-13', async () => {
    must(
      await recordBuy(ctx, {
        accountId: brokerage,
        instrumentId: reliance,
        on: '2026-01-01',
        qty: '100',
        price: '100',
      }),
    );
    const { rows } = await db().execute<{ n: string }>(
      sql`select count(*)::text as n from transactions where user_id = ${userId}`,
    );
    expect(rows[0]!.n).toBe('0');
  });

  it('refuses a trade dated before the account opened', async () => {
    const result = await recordBuy(ctx, {
      accountId: brokerage,
      instrumentId: reliance,
      on: '2024-06-01',
      qty: '100',
      price: '100',
    });
    expect(result.ok).toBe(false);
  });

  it('refuses a trade on a closed account', async () => {
    await db().execute(sql`update accounts set is_active = false where id = ${brokerage}`);
    const result = await recordBuy(ctx, {
      accountId: brokerage,
      instrumentId: reliance,
      on: '2026-01-01',
      qty: '100',
      price: '100',
    });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FIFO through the service
// ---------------------------------------------------------------------------

describe('FIFO across the whole write path', () => {
  beforeEach(async () => {
    must(await recordBuy(ctx, { accountId: brokerage, instrumentId: reliance, on: '2026-01-01', qty: '100', price: '100' }));
    must(await recordBuy(ctx, { accountId: brokerage, instrumentId: reliance, on: '2026-02-01', qty: '100', price: '150' }));
  });

  it('consumes the oldest lot first and leaves the newer basis', async () => {
    must(await recordSell(ctx, { accountId: brokerage, instrumentId: reliance, on: '2026-03-01', qty: '100', price: '200' }));

    const position = await positionSnapshot(userId, reliance);
    expect(position?.quantity).toBe('100.00000000');
    expect(position?.costBasis).toBe('15000.0000');
    expect(position?.realizedPnl).toBe('10000.0000');

    const lots = await lotSnapshot(userId, reliance);
    expect(lots).toHaveLength(2);
    // The closed lot is retained at zero, not deleted.
    expect(lots[0]!.remainingQuantity).toBe('0.00000000');
    expect(lots[0]!.remainingCost).toBe('0.0000');
    expect(lots[1]!.remainingCost).toBe('15000.0000');

    // −10,000 −15,000 +20,000 = −5,000
    expect(await balanceOf(brokerage)).toBe('95000.0000');
  });

  it('rejects an oversell and writes nothing at all', async () => {
    const before = await derivedFingerprint(userId);
    const versionBefore = await investmentLedgerVersion(userId);

    const result = await recordSell(ctx, {
      accountId: brokerage,
      instrumentId: reliance,
      on: '2026-03-01',
      qty: '250',
      price: '200',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('insufficient_data');
      expect(result.error.message).toMatch(/50\.00000000 more units/);
      expect(result.error.message).toMatch(/200\.00000000 are held/);
    }

    expect(await derivedFingerprint(userId)).toBe(before);
    expect(await investmentLedgerVersion(userId)).toBe(versionBefore);

    const { rows } = await db().execute<{ n: string }>(
      sql`select count(*)::text as n from investment_transactions where user_id = ${userId} and kind = 'sell'`,
    );
    expect(rows[0]!.n).toBe('0');
  });

  it('case 30 — a BACKDATED oversell rolls the whole mutation back', async () => {
    // The sale is dated before both purchases, so at that instant nothing is
    // held. The insert succeeds; the rebuild that follows it does not.
    const before = await derivedFingerprint(userId);
    const versionBefore = await investmentLedgerVersion(userId);

    const result = await recordSell(ctx, {
      accountId: brokerage,
      instrumentId: reliance,
      on: '2025-06-01',
      qty: '10',
      price: '200',
    });

    expect(result.ok).toBe(false);
    expect(await derivedFingerprint(userId)).toBe(before);
    expect(await investmentLedgerVersion(userId)).toBe(versionBefore);
    expect(await balanceOf(brokerage)).toBe('75000.0000'); // unchanged: 100,000 − 25,000

    const { rows } = await db().execute<{ n: string }>(
      sql`select count(*)::text as n from audit_log where user_id = ${userId} and action = 'investment_transaction.create' `,
    );
    // Two purchases, and no third entry from the failed sale.
    expect(rows[0]!.n).toBe('2');
  });

  it('rebuilds identically whether incrementally or from scratch', async () => {
    must(await recordSell(ctx, { accountId: brokerage, instrumentId: reliance, on: '2026-03-01', qty: '120', price: '200' }));
    const incremental = await derivedFingerprint(userId);

    must(await write(ctx, (w) => rebuildAllPositions(w)));
    expect(await derivedFingerprint(userId)).toBe(incremental);

    // Twice more, to prove the rebuild is idempotent rather than merely correct once.
    must(await write(ctx, (w) => rebuildAllPositions(w)));
    must(await write(ctx, (w) => rebuildAllPositions(w)));
    expect(await derivedFingerprint(userId)).toBe(incremental);
  });

  it('replays a backdated purchase into the right FIFO position', async () => {
    // Entered last, dated first: it must be consumed first.
    must(await recordBuy(ctx, { accountId: brokerage, instrumentId: reliance, on: '2025-12-01', qty: '50', price: '10' }));
    must(await recordSell(ctx, { accountId: brokerage, instrumentId: reliance, on: '2026-03-01', qty: '50', price: '200' }));

    const position = await positionSnapshot(userId, reliance);
    // The ₹10 lot is consumed: 10,000 − 500 = 9,500 realised.
    expect(position?.realizedPnl).toBe('9500.0000');
    expect(position?.costBasis).toBe('25000.0000');
  });
});

// ---------------------------------------------------------------------------
// income, charges, corporate actions
// ---------------------------------------------------------------------------

describe('a dividend', () => {
  beforeEach(async () => {
    must(await recordBuy(ctx, { accountId: brokerage, instrumentId: reliance, on: '2026-01-01', qty: '100', price: '100' }));
  });

  it('accrues gross to income and the withholding to taxes, and pays net into cash', async () => {
    must(await recordDividend(ctx, { accountId: brokerage, instrumentId: reliance, on: '2026-04-01', gross: '500', taxes: '50' }));

    const position = await positionSnapshot(userId, reliance);
    expect(position?.incomeTotal).toBe('500.0000');
    expect(position?.taxesTotal).toBe('50.0000');
    // Untouched: a dividend is a return ON the investment, not a refund OF it.
    expect(position?.costBasis).toBe('10000.0000');

    // 100,000 − 10,000 + 450
    expect(await balanceOf(brokerage)).toBe('90450.0000');
  });

  it('case 5c — raises the balance exactly once', async () => {
    must(await recordDividend(ctx, { accountId: brokerage, instrumentId: reliance, on: '2026-04-01', gross: '500', taxes: '50' }));
    const { rows } = await db().execute<{ n: string }>(
      sql`select count(*)::text as n from transactions where user_id = ${userId}`,
    );
    expect(rows[0]!.n).toBe('0');
    expect(await balanceOf(brokerage)).toBe('90450.0000'); // not 90,900
  });

  it('refuses one whose charges exceed the declared amount', async () => {
    const result = await recordDividend(ctx, {
      accountId: brokerage,
      instrumentId: reliance,
      on: '2026-04-01',
      gross: '50',
      taxes: '60',
    });
    expect(result.ok).toBe(false);
  });
});

describe('account-level charges', () => {
  it('case 19 — a fee with no instrument reduces cash and belongs to no position', async () => {
    must(await recordBuy(ctx, { accountId: brokerage, instrumentId: reliance, on: '2026-01-01', qty: '100', price: '100' }));
    must(await recordCharge(ctx, { accountId: brokerage, on: '2026-03-31', amount: '944' }));

    const position = await positionSnapshot(userId, reliance);
    expect(position?.feesTotal).toBe('0.0000');

    expect(await balanceOf(brokerage)).toBe('89056.0000'); // 100,000 − 10,000 − 944

    const result = must(await portfolio(ctx));
    expect(toDbString(result.summary.fees)).toBe('944.0000');
    // It appears in no allocation slice, because it has no position to sit in.
    expect(result.holdings).toHaveLength(1);
  });

  it('attributes an instrument-level fee to that position', async () => {
    must(await recordBuy(ctx, { accountId: brokerage, instrumentId: reliance, on: '2026-01-01', qty: '100', price: '100' }));
    must(await recordCharge(ctx, { accountId: brokerage, instrumentId: reliance, on: '2026-03-31', amount: '120' }));

    const position = await positionSnapshot(userId, reliance);
    expect(position?.feesTotal).toBe('120.0000');
  });
});

describe('corporate actions', () => {
  beforeEach(async () => {
    must(await recordBuy(ctx, { accountId: brokerage, instrumentId: reliance, on: '2026-01-01', qty: '100', price: '100' }));
  });

  it('a split scales units and leaves the basis byte-identical', async () => {
    const costBefore = (await lotSnapshot(userId, reliance))[0]!.costTotal;
    must(await recordCorporateAction(ctx, { accountId: brokerage, instrumentId: reliance, on: '2026-03-01', num: 5, den: 1 }));

    const lots = await lotSnapshot(userId, reliance);
    expect(lots[0]!.remainingQuantity).toBe('500.00000000');
    expect(lots[0]!.costTotal).toBe(costBefore);
    expect(await balanceOf(brokerage)).toBe('90000.0000'); // no cash moved
  });

  it('a bonus adds units at zero cost', async () => {
    must(await recordCorporateAction(ctx, { accountId: brokerage, instrumentId: reliance, on: '2026-03-01', num: 1, den: 1 }, 'bonus'));
    const position = await positionSnapshot(userId, reliance);
    expect(position?.quantity).toBe('200.00000000');
    expect(position?.costBasis).toBe('10000.0000');
  });

  it('case 25 — a same-day buy and split give the same answer in either entry order', async () => {
    // Entered buy-then-split.
    must(await recordBuy(ctx, { accountId: brokerage, instrumentId: reliance, on: '2026-06-01', qty: '100', price: '200' }));
    must(await recordCorporateAction(ctx, { accountId: brokerage, instrumentId: reliance, on: '2026-06-01', num: 2, den: 1 }));
    const buyFirst = await derivedFingerprint(userId);

    // Rebuild from a clean slate with the split entered first.
    await truncateInvestments();
    reliance = await makeInstrument(ctx, { symbol: 'RELIANCE', name: 'Reliance Industries' });
    must(await recordBuy(ctx, { accountId: brokerage, instrumentId: reliance, on: '2026-01-01', qty: '100', price: '100' }));
    must(await recordCorporateAction(ctx, { accountId: brokerage, instrumentId: reliance, on: '2026-06-01', num: 2, den: 1 }));
    must(await recordBuy(ctx, { accountId: brokerage, instrumentId: reliance, on: '2026-06-01', qty: '100', price: '200' }));
    const splitFirst = await derivedFingerprint(userId);

    // The instrument was recreated, so its id differs; the FIGURES are what must
    // match. Without `kind_rank` they would not: the same-day purchase would be
    // scaled by the split in one entry order and left unscaled in the other.
    const figures = (fingerprint: string): string =>
      fingerprint
        .split('\n')
        .filter((line) => line.startsWith('position'))
        .map((line) => line.split('|').slice(3).join('|'))
        .join('\n');
    expect(figures(splitFirst)).toBe(figures(buyFirst));
  });
});

// ---------------------------------------------------------------------------
// transfers between the user's own accounts
// ---------------------------------------------------------------------------

describe('transferring a holding between two of the user\'s own accounts', () => {
  let second: string;

  beforeEach(async () => {
    second = await makeAccount(ctx, {
      name: 'Groww',
      kind: 'brokerage',
      openingBalance: '0',
      openingDate: '2025-01-01',
    });
    must(await recordBuy(ctx, { accountId: brokerage, instrumentId: reliance, on: '2025-01-15', qty: '100', price: '100' }));
  });

  it('realises nothing, moves no cash, and carries the holding clock', async () => {
    must(await recordTransferOut(ctx, { accountId: brokerage, instrumentId: reliance, on: '2026-01-15', qty: '100', price: '250' }));
    must(
      await recordTransferIn(ctx, {
        accountId: second,
        instrumentId: reliance,
        on: '2026-01-15',
        qty: '100',
        price: '100',
        acquiredOn: '2025-01-15',
      }),
    );

    const { rows } = await db().execute<{ realized: string }>(sql`
      select coalesce(sum(realized_pnl), 0)::text as realized
        from lot_disposals where user_id = ${userId}
    `);
    expect(rows[0]!.realized).toBe('0.0000');

    // Neither leg moved cash.
    expect(await balanceOf(brokerage)).toBe('90000.0000');
    expect(await balanceOf(second)).toBe('0.0000');

    const lots = await db().execute<{ acquired_on: string; account_id: string }>(sql`
      select acquired_on::text, account_id::text from tax_lots
       where user_id = ${userId} and remaining_quantity > 0
    `);
    expect(lots.rows).toHaveLength(1);
    expect(lots.rows[0]!.acquired_on).toBe('2025-01-15');
    expect(lots.rows[0]!.account_id).toBe(second);
  });

  it('measures holding_days from the original purchase on the eventual sale', async () => {
    must(await recordTransferOut(ctx, { accountId: brokerage, instrumentId: reliance, on: '2026-01-15', qty: '100', price: '250' }));
    must(
      await recordTransferIn(ctx, {
        accountId: second,
        instrumentId: reliance,
        on: '2026-01-15',
        qty: '100',
        price: '100',
        acquiredOn: '2025-01-15',
      }),
    );
    must(await recordSell(ctx, { accountId: second, instrumentId: reliance, on: '2026-02-15', qty: '100', price: '250' }));

    const { rows } = await db().execute<{ holding_days: number; realized: string }>(sql`
      select d.holding_days, d.realized_pnl::text as realized
        from lot_disposals d
        join tax_lots l on l.id = d.lot_id
       where l.account_id = ${second}
    `);
    expect(rows).toHaveLength(1);
    // 2025-01-15 → 2026-02-15 is 365 + 31 = 396 days, not the 31 since the
    // transfer. Getting this wrong turns a long-term holding short-term.
    expect(rows[0]!.holding_days).toBe(396);
    expect(rows[0]!.holding_days).not.toBe(31);
    expect(rows[0]!.realized).toBe('15000.0000');
  });

  it('refuses an acquisition date after the transfer date', async () => {
    const result = await recordTransferIn(ctx, {
      accountId: second,
      instrumentId: reliance,
      on: '2026-01-15',
      qty: '100',
      price: '100',
      acquiredOn: '2026-06-01',
    });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// the three-denomination cash chain (OD-5) — golden scenario G3's core case
// ---------------------------------------------------------------------------

describe('a USD instrument bought from an INR brokerage account', () => {
  let voo: string;

  beforeEach(async () => {
    await addFxRate('USD', 'INR', '2026-01-01', '80');
    await addFxRate('USD', 'INR', '2026-06-01', '85');
    const refreshed = await createReadCtx(userId, { now: NOW });
    if (!refreshed.ok) throw new Error('context');
    ctx = refreshed.value;
    voo = await makeInstrument(ctx, {
      symbol: 'VOO',
      name: 'Vanguard S&P 500 ETF',
      exchange: 'NYSEARCA',
      assetClass: 'etf',
      currencyCode: 'USD',
      country: 'US',
    });
  });

  it('is recorded, not rejected — the regression the whole chain exists for', async () => {
    const result = await recordBuy(ctx, {
      accountId: brokerage,
      instrumentId: voo,
      on: '2026-01-01',
      qty: '10',
      price: '400',
    });
    expect(result.ok).toBe(true);
  });

  it('keeps each denomination in its own currency', async () => {
    must(await recordBuy(ctx, { accountId: brokerage, instrumentId: voo, on: '2026-01-01', qty: '10', price: '400' }));

    const { rows } = await db().execute<{
      currency_code: string;
      net_amount_instrument: string;
      fx_rate_instrument_to_account: string;
      net_amount: string;
      base_net_amount: string;
    }>(sql`
      select currency_code, net_amount_instrument::text, fx_rate_instrument_to_account::text,
             net_amount::text, base_net_amount::text
        from investment_transactions where user_id = ${userId} and instrument_id = ${voo}
    `);
    const row = rows[0]!;
    expect(row.currency_code.trim()).toBe('USD');
    expect(row.net_amount_instrument).toBe('-4000.0000'); // dollars
    expect(row.fx_rate_instrument_to_account).toBe('80.0000000000');
    expect(row.net_amount).toBe('-320000.0000'); // rupees
    expect(row.base_net_amount).toBe('-320000.0000');
  });

  it('leaves the account balance in rupees throughout', async () => {
    must(await recordBuy(ctx, { accountId: brokerage, instrumentId: voo, on: '2026-01-01', qty: '10', price: '400' }));
    const account = must(await getAccount(ctx, brokerage));
    expect(account.currency).toBe('INR');
    expect(toDbString(account.balance)).toBe('-220000.0000'); // 100,000 − 320,000
  });

  it('records a USD dividend into the INR account', async () => {
    must(await recordBuy(ctx, { accountId: brokerage, instrumentId: voo, on: '2026-01-01', qty: '10', price: '400' }));
    const result = await recordDividend(ctx, {
      accountId: brokerage,
      instrumentId: voo,
      on: '2026-06-01',
      gross: '20',
      taxes: '3',
    });
    expect(result.ok).toBe(true);

    const { rows } = await db().execute<{ net_amount_instrument: string; net_amount: string }>(sql`
      select net_amount_instrument::text, net_amount::text
        from investment_transactions where user_id = ${userId} and kind = 'dividend'
    `);
    expect(rows[0]!.net_amount_instrument).toBe('17.0000'); // $20 − $3
    expect(rows[0]!.net_amount).toBe('1445.0000'); // × 85
  });

  it('splits realised P&L into a price and an FX component that sum back exactly', async () => {
    must(await recordBuy(ctx, { accountId: brokerage, instrumentId: voo, on: '2026-01-01', qty: '10', price: '400' }));
    must(await recordSell(ctx, { accountId: brokerage, instrumentId: voo, on: '2026-06-01', qty: '10', price: '500' }));

    const { rows } = await db().execute<{
      realized: string;
      base_realized: string;
      base_fx: string;
    }>(sql`
      select realized_pnl::text as realized, base_realized_pnl::text as base_realized,
             base_fx_component::text as base_fx
        from lot_disposals where user_id = ${userId}
    `);
    const row = rows[0]!;
    expect(row.realized).toBe('1000.0000'); // $5,000 − $4,000
    // 5,000×85 − 4,000×80 = 425,000 − 320,000 = ₹105,000
    expect(row.base_realized).toBe('105000.0000');
    // 4,000 × (85 − 80) = ₹20,000
    expect(row.base_fx).toBe('20000.0000');
    // The price component is the difference: 1,000 × 85 = ₹85,000.
    expect(Number(row.base_realized) - Number(row.base_fx)).toBe(85000);
  });

  it('refuses a trade with no rate on or before the trade date', async () => {
    const result = await recordBuy(ctx, {
      accountId: brokerage,
      instrumentId: voo,
      on: '2025-06-01', // before the earliest rate
      qty: '10',
      price: '400',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('insufficient_data');
  });
});

describe('same-currency collapse', () => {
  it('uses a rate of exactly 1, and the two instrument figures are identical', async () => {
    must(await recordBuy(ctx, { accountId: brokerage, instrumentId: reliance, on: '2026-01-01', qty: '100', price: '100' }));
    const { rows } = await db().execute<{
      rate: string;
      net_amount_instrument: string;
      net_amount: string;
    }>(sql`
      select fx_rate_instrument_to_account::text as rate, net_amount_instrument::text, net_amount::text
        from investment_transactions where user_id = ${userId}
    `);
    expect(rows[0]!.rate).toBe('1.0000000000');
    expect(rows[0]!.net_amount_instrument).toBe(rows[0]!.net_amount);
  });
});

// ---------------------------------------------------------------------------
// Phase 3 integration
// ---------------------------------------------------------------------------

describe('integration with the money subsystem', () => {
  it('a bank → brokerage transfer is neither income nor expense', async () => {
    transfer(ctx, { fromAccountId: bank, toAccountId: brokerage, amount: '50000', bookedOn: '2026-01-05' });
    await transfer(ctx, {
      fromAccountId: bank,
      toAccountId: brokerage,
      amount: '50000',
      bookedOn: '2026-01-05',
    });
    must(await recordBuy(ctx, { accountId: brokerage, instrumentId: reliance, on: '2026-01-06', qty: '100', price: '100' }));

    const flow = await periodSummary(ctx, {
      from: isoDate('2026-01-01'),
      to: isoDate('2026-01-31'),
    });
    expect(toDbString(flow.income)).toBe('0.0000');
    expect(toDbString(flow.expenses)).toBe('0.0000');
  });

  it('an investment purchase is not an expense, and a dividend is not income', async () => {
    must(await recordBuy(ctx, { accountId: brokerage, instrumentId: reliance, on: '2026-01-06', qty: '100', price: '100' }));
    must(await recordDividend(ctx, { accountId: brokerage, instrumentId: reliance, on: '2026-01-20', gross: '500' }));

    const flow = await periodSummary(ctx, {
      from: isoDate('2026-01-01'),
      to: isoDate('2026-01-31'),
    });
    expect(toDbString(flow.income)).toBe('0.0000');
    expect(toDbString(flow.expenses)).toBe('0.0000');
    // But the cash did move.
    expect(await balanceOf(brokerage)).toBe('90500.0000');
  });

  it('leaves ordinary money transactions on other accounts alone', async () => {
    const food = await categoryId(ctx, 'Food');
    await record(ctx, { kind: 'expense', accountId: bank, categoryId: food, amount: '2500', bookedOn: '2026-01-10' });
    must(await recordBuy(ctx, { accountId: brokerage, instrumentId: reliance, on: '2026-01-06', qty: '100', price: '100' }));

    const flow = await periodSummary(ctx, {
      from: isoDate('2026-01-01'),
      to: isoDate('2026-01-31'),
    });
    expect(toDbString(flow.expenses)).toBe('2500.0000');
    expect(await balanceOf(bank)).toBe('497500.0000');
  });

  it('shows both ledgers in the account ledger, with one running balance', async () => {
    const food = await categoryId(ctx, 'Food');
    await record(ctx, { kind: 'expense', accountId: brokerage, categoryId: food, amount: '100', bookedOn: '2026-01-02' });
    must(await recordBuy(ctx, { accountId: brokerage, instrumentId: reliance, on: '2026-01-06', qty: '100', price: '100' }));
    must(await recordDividend(ctx, { accountId: brokerage, instrumentId: reliance, on: '2026-01-20', gross: '500' }));

    const ledger = must(await accountLedger(ctx, brokerage));
    expect(ledger.lines.map((l) => l.ledger)).toEqual(['money', 'investment', 'investment']);

    // The running balance ends exactly where the derived balance sits.
    const last = ledger.lines[ledger.lines.length - 1]!;
    expect(toDbString(last.balance)).toBe(await balanceOf(brokerage));
    expect(toDbString(last.balance)).toBe('90400.0000'); // 100,000 − 100 − 10,000 + 500
  });

  it('an as-of balance excludes trades after the date', async () => {
    must(await recordBuy(ctx, { accountId: brokerage, instrumentId: reliance, on: '2026-01-06', qty: '100', price: '100' }));
    must(await recordBuy(ctx, { accountId: brokerage, instrumentId: reliance, on: '2026-07-06', qty: '100', price: '100' }));

    const atMidYear = must(await getAccount(ctx, brokerage, { asOf: isoDate('2026-03-01') }));
    expect(toDbString(atMidYear.balance)).toBe('90000.0000');
    const today = must(await getAccount(ctx, brokerage));
    expect(toDbString(today.balance)).toBe('80000.0000');
  });
});

// ---------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------

describe('the portfolio read path', () => {
  it('reports holdings at cost with reason no_price until a price is entered', async () => {
    must(await recordBuy(ctx, { accountId: brokerage, instrumentId: reliance, on: '2026-01-01', qty: '100', price: '100' }));

    const before = must(await portfolio(ctx));
    expect(before.holdings[0]!.marketValue).toBeNull();
    expect(before.holdings[0]!.returnPct.reason).toBe('no_price');
    expect(before.summary.unrealizedPnl).toBeNull();
    expect(before.summary.totalReturnPct.reason).toBe('no_price');
    expect(before.summary.twr.reason).toBe('insufficient_price_history');

    await priceIt(ctx, reliance, '160');

    const after = must(await portfolio(ctx));
    expect(toDbString(after.holdings[0]!.marketValue!)).toBe('16000.0000');
    expect(toDbString(after.summary.unrealizedPnl!)).toBe('6000.0000');
    expect(after.summary.coverage.value).toBeGreaterThan(0n);
  });

  it('lists the ledger newest first, with both currencies on the row', async () => {
    must(await recordBuy(ctx, { accountId: brokerage, instrumentId: reliance, on: '2026-01-01', qty: '100', price: '100' }));
    must(await recordDividend(ctx, { accountId: brokerage, instrumentId: reliance, on: '2026-04-01', gross: '500' }));

    const page = must(await listInvestmentTransactions(ctx));
    expect(page.total).toBe(2);
    expect(page.rows[0]!.kind).toBe('dividend');
    expect(page.rows[0]!.instrumentSymbol).toBe('RELIANCE');
    expect(toDbString(page.rows[0]!.netAmount)).toBe('500.0000');
  });

  it('computes an XIRR once there is a priced terminal value', async () => {
    must(await recordBuy(ctx, { accountId: brokerage, instrumentId: reliance, on: '2025-08-11', qty: '100', price: '100' }));
    await priceIt(ctx, reliance, '110');

    const result = must(await portfolio(ctx));
    // ₹10,000 out on 2025-08-11, ₹11,000 back on 2026-08-11 — one year, +10%.
    expect(result.summary.xirr.value).not.toBeNull();
  });
});
