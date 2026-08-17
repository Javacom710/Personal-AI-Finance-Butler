import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/date';
import { toDbString } from '@/lib/decimal/money';
import { rToDbString } from '@/lib/decimal/rate';
import {
  createLiability,
  createManualAsset,
  netWorthAsOf,
  netWorthChange,
  netWorthReconciliation,
  netWorthSeries,
  recordLiabilityBalance,
  revalueAsset,
} from '@/server/services';
import { bridgeCloses } from '@/server/domain/networth/bridge';
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
import {
  closeNetWorthHarness,
  closeIt,
  dispose,
  makeAsset,
  makeLiability,
  recordBalance,
  revalue,
  truncateNetWorth,
} from './networth-harness';
import {
  makeInstrument,
  recordBuy,
  recordDividend,
  recordSell,
  recordTransferIn,
  truncateInvestments,
} from './investment-harness';

/**
 * **Net Worth at Cost** end to end (NET-WORTH-DESIGN.md, ADR-23…ADR-26).
 *
 * Two families of test, and the second is the one that matters:
 *
 * 1. that the figure is right;
 * 2. that it is right **for the right reason** — single counting proven by the
 *    ledger rather than by a subtraction, and every historical filter proven to
 *    be a date rather than a flag.
 */

let fixture: MoneyFixture;
const D = (s: string) => isoDate(s);

beforeAll(async () => {
  await truncateAll();
  fixture = await setupMoneyFixture({ now: new Date('2026-08-10T12:00:00Z') });
});

beforeEach(async () => {
  await truncateInvestments();
  await truncateNetWorth();
  await truncateMoney();
});

afterAll(async () => {
  await closeNetWorthHarness();
  await closeMoneyHarness();
  await closeHarness();
});

async function netWorth(asOf?: string) {
  const ctx = await refreshCtx(fixture);
  return must(await netWorthAsOf(ctx, asOf === undefined ? {} : { asOf: D(asOf) }));
}

// ------------------------------------------------------- composition & signs

describe('composition', () => {
  it('an empty system is zero and fully covered', async () => {
    const result = await netWorth();
    expect(toDbString(result.netWorth)).toBe('0.0000');
    expect(result.basis).toBe('cost');
    expect(result.excluded).toEqual([]);
    expect(rToDbString(result.assetCoverage)).toBe('1.0000000000');
  });

  it('cash only', async () => {
    await makeAccount(fixture.ctx, { name: 'Bank', openingBalance: '120000', openingDate: '2026-01-01' });
    expect(toDbString((await netWorth()).netWorth)).toBe('120000.0000');
  });

  // N1 / ADR-25 — the regression the first gate exists for.
  it('an OVERPAID credit card is an asset, not zero and not a liability', async () => {
    const card = await makeAccount(fixture.ctx, {
      name: 'Card',
      kind: 'credit_card',
      creditLimit: '200000',
      openingBalance: '0',
      openingDate: '2026-01-01',
    });
    const salary = await categoryId(fixture.ctx, 'Salary');
    // Overpay the card: money in, balance goes positive.
    await record(fixture.ctx, {
      kind: 'income',
      accountId: card,
      categoryId: salary,
      amount: '5000',
      bookedOn: '2026-02-01',
    });

    const result = await netWorth();
    expect(toDbString(result.assets)).toBe('5000.0000');
    expect(toDbString(result.liabilities)).toBe('0.0000');
    expect(toDbString(result.netWorth)).toBe('5000.0000');

    const card_ = result.contributions.find((c) => c.label === 'Card')!;
    expect(card_.side).toBe('asset');

    // Found in signed-in browser verification: it was filed under `cash`, which
    // reads on screen as "Cash and bank". A receivable from a card issuer is an
    // asset but it is not spendable cash, and grouping it beside a current
    // account overstates liquidity at a glance.
    expect(card_.group).toBe('other_assets');
    expect(result.groups.find((g) => g.group === 'cash')).toBeUndefined();
  });

  it('groups an overpaid LOAN account as an other asset too', async () => {
    const loan = await makeAccount(fixture.ctx, {
      name: 'Overpaid loan',
      kind: 'loan',
      openingBalance: '0',
      openingDate: '2026-01-01',
    });
    const salary = await categoryId(fixture.ctx, 'Salary');
    await record(fixture.ctx, {
      kind: 'income',
      accountId: loan,
      categoryId: salary,
      amount: '2500',
      bookedOn: '2026-02-01',
    });

    const result = await netWorth();
    const row = result.contributions.find((c) => c.label === 'Overpaid loan')!;
    expect(row.side).toBe('asset');
    expect(row.group).toBe('other_assets');
  });

  it('still groups a card and a loan carrying debt under their own headings', async () => {
    const card = await makeAccount(fixture.ctx, {
      name: 'Card',
      kind: 'credit_card',
      creditLimit: '200000',
      openingBalance: '0',
      openingDate: '2026-01-01',
    });
    const food = await categoryId(fixture.ctx, 'Food');
    await record(fixture.ctx, {
      kind: 'expense',
      accountId: card,
      categoryId: food,
      amount: '45000',
      bookedOn: '2026-02-01',
    });

    const result = await netWorth();
    expect(result.contributions.find((c) => c.label === 'Card')!.group).toBe('credit_card');
  });

  it('groups an overdrawn bank account as an overdraft, not as cash', async () => {
    const bank = await makeAccount(fixture.ctx, { name: 'Bank', openingBalance: '1000', openingDate: '2026-01-01' });
    const food = await categoryId(fixture.ctx, 'Food');
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: food, amount: '9000', bookedOn: '2026-02-01' });

    const result = await netWorth();
    expect(result.contributions.find((c) => c.label === 'Bank')!.group).toBe('overdrawn_accounts');
  });

  it('a card carrying a balance is a liability at its magnitude', async () => {
    const card = await makeAccount(fixture.ctx, {
      name: 'Card',
      kind: 'credit_card',
      creditLimit: '200000',
      openingBalance: '0',
      openingDate: '2026-01-01',
    });
    const food = await categoryId(fixture.ctx, 'Food');
    await record(fixture.ctx, {
      kind: 'expense',
      accountId: card,
      categoryId: food,
      amount: '45000',
      bookedOn: '2026-02-01',
    });

    const result = await netWorth();
    expect(toDbString(result.liabilities)).toBe('45000.0000');
    expect(toDbString(result.netWorth)).toBe('-45000.0000');
  });

  it('an overdrawn bank account is a liability, not a negative asset', async () => {
    const bank = await makeAccount(fixture.ctx, { name: 'Bank', openingBalance: '1000', openingDate: '2026-01-01' });
    const food = await categoryId(fixture.ctx, 'Food');
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: food, amount: '9000', bookedOn: '2026-02-01' });

    const result = await netWorth();
    expect(toDbString(result.assets)).toBe('0.0000');
    expect(toDbString(result.liabilities)).toBe('8000.0000');
  });

  it('reports a negative net worth as negative', async () => {
    await makeAccount(fixture.ctx, { name: 'Bank', openingBalance: '10000', openingDate: '2026-01-01' });
    const loan = await makeLiability(fixture.ctx, {
      name: 'Home loan',
      openingBalance: '2500000',
      openingBalanceOn: '2026-01-01',
    });
    expect(loan).toBeTruthy();
    expect(toDbString((await netWorth()).netWorth)).toBe('-2490000.0000');
  });
});

// ------------------------------------------------------------ single counting

describe('single counting — the ledger, not a subtraction', () => {
  async function brokerageWithHolding() {
    const brk = await makeAccount(fixture.ctx, {
      name: 'Zerodha',
      kind: 'brokerage',
      openingBalance: '100000',
      openingDate: '2026-01-01',
    });
    const infy = await makeInstrument(fixture.ctx, { symbol: 'INFY' });
    return { brk, infy };
  }

  it('brokerage cash alone', async () => {
    await brokerageWithHolding();
    expect(toDbString((await netWorth()).netWorth)).toBe('100000.0000');
  });

  // The brief's worked example: ₹100,000 → ₹40,000 cash + ₹60,000 basis.
  it('cash + positions is the cash it started with, not their sum', async () => {
    const { brk, infy } = await brokerageWithHolding();
    must(await recordBuy(fixture.ctx, { accountId: brk, instrumentId: infy, on: '2026-02-01', qty: '600', price: '100' }));

    const result = await netWorth();
    expect(toDbString(result.netWorth)).toBe('100000.0000');

    const cash = result.contributions.find((c) => c.label === 'Zerodha')!;
    const position = result.contributions.find((c) => c.group === 'investments')!;
    expect(toDbString(cash.base)).toBe('40000.0000');
    expect(toDbString(position.base)).toBe('60000.0000');
  });

  it('a buy leaves net worth unchanged — I-25', async () => {
    const { brk, infy } = await brokerageWithHolding();
    const before = await netWorth('2026-01-31');
    must(await recordBuy(fixture.ctx, { accountId: brk, instrumentId: infy, on: '2026-02-01', qty: '600', price: '100' }));
    const after = await netWorth('2026-02-01');
    expect(toDbString(after.netWorth)).toBe(toDbString(before.netWorth));
  });

  it('a sell moves net worth by exactly the realised P&L — I-25', async () => {
    const { brk, infy } = await brokerageWithHolding();
    must(await recordBuy(fixture.ctx, { accountId: brk, instrumentId: infy, on: '2026-02-01', qty: '600', price: '100' }));
    const before = await netWorth('2026-02-28');
    // 200 units bought at 100, sold at 150 → realised P&L 200 × 50 = 10,000.
    must(await recordSell(fixture.ctx, { accountId: brk, instrumentId: infy, on: '2026-03-01', qty: '200', price: '150' }));
    const after = await netWorth('2026-03-01');
    expect(after.netWorth.minor - before.netWorth.minor).toBe(10000n * 10000n);
  });

  it('a dividend moves net worth by exactly the net received', async () => {
    const { brk, infy } = await brokerageWithHolding();
    must(await recordBuy(fixture.ctx, { accountId: brk, instrumentId: infy, on: '2026-02-01', qty: '600', price: '100' }));
    const before = await netWorth('2026-02-28');
    // ₹500 gross, ₹50 TDS → ₹450 net.
    must(await recordDividend(fixture.ctx, { accountId: brk, instrumentId: infy, on: '2026-03-01', gross: '500', taxes: '50' }));
    const after = await netWorth('2026-03-01');
    expect(after.netWorth.minor - before.netWorth.minor).toBe(450n * 10000n);
  });

  it('a transfer into the brokerage leaves net worth unchanged', async () => {
    const bank = await makeAccount(fixture.ctx, { name: 'Bank', openingBalance: '100000', openingDate: '2026-01-01' });
    const brk = await makeAccount(fixture.ctx, { name: 'Zerodha', kind: 'brokerage', openingDate: '2026-01-01' });
    const before = await netWorth('2026-01-31');
    await transfer(fixture.ctx, { fromAccountId: bank, toAccountId: brk, amount: '40000', bookedOn: '2026-02-01' });
    expect(toDbString((await netWorth('2026-02-01')).netWorth)).toBe(toDbString(before.netWorth));
  });

  it('a fully sold position contributes nothing but is not an error', async () => {
    const { brk, infy } = await brokerageWithHolding();
    must(await recordBuy(fixture.ctx, { accountId: brk, instrumentId: infy, on: '2026-02-01', qty: '600', price: '100' }));
    must(await recordSell(fixture.ctx, { accountId: brk, instrumentId: infy, on: '2026-03-01', qty: '600', price: '100' }));

    const result = await netWorth();
    const position = result.contributions.find((c) => c.group === 'investments')!;
    expect(toDbString(position.base)).toBe('0.0000');
    expect(position.side).toBe('none');
    expect(toDbString(result.netWorth)).toBe('100000.0000');
  });

  it('the same instrument in two brokerage accounts contributes twice, from two sources', async () => {
    const a = await makeAccount(fixture.ctx, { name: 'Broker A', kind: 'brokerage', openingBalance: '100000', openingDate: '2026-01-01' });
    const b = await makeAccount(fixture.ctx, { name: 'Broker B', kind: 'brokerage', openingBalance: '100000', openingDate: '2026-01-01' });
    const infy = await makeInstrument(fixture.ctx, { symbol: 'INFY' });
    must(await recordBuy(fixture.ctx, { accountId: a, instrumentId: infy, on: '2026-02-01', qty: '100', price: '100' }));
    must(await recordBuy(fixture.ctx, { accountId: b, instrumentId: infy, on: '2026-02-01', qty: '200', price: '100' }));

    const result = await netWorth();
    const positions = result.contributions.filter((c) => c.group === 'investments');
    expect(positions).toHaveLength(2);
    expect(toDbString(result.netWorth)).toBe('200000.0000');
  });
});

// --------------------------------------------------------- as-of correctness

describe('historical / as-of — every filter is a date (ADR-26)', () => {
  // N2 — the highest-value fix in the Phase 5 review.
  it('an account created AFTER the as-of date contributes nothing, including its opening balance', async () => {
    await makeAccount(fixture.ctx, { name: 'New bank', openingBalance: '50000', openingDate: '2026-03-01' });

    const before = await netWorth('2020-12-31');
    expect(toDbString(before.netWorth)).toBe('0.0000');
    // Absent, not present at zero — so it cannot be confused with an account
    // that genuinely held nothing.
    expect(before.contributions).toHaveLength(0);

    const after = await netWorth('2026-03-01');
    expect(toDbString(after.netWorth)).toBe('50000.0000');
  });

  // Found in signed-in browser verification: the accounts page reported a
  // future-dated account's opening balance as money held today, while net worth
  // correctly excluded it. `FINANCIAL-DOMAIN.md` §3 says the default bound is
  // *today*, not "unbounded", and the two reads must agree.
  it('a future-dated account holds nothing today, on BOTH the account read and net worth', async () => {
    const { listAccounts } = await import('@/server/services');
    await makeAccount(fixture.ctx, {
      name: 'Opens later',
      openingBalance: '50000',
      openingDate: '2026-12-01',
    });

    const ctx = await refreshCtx(fixture);
    const [account] = await listAccounts(ctx);
    expect(account!.name).toBe('Opens later');
    expect(toDbString(account!.balance)).toBe('0.0000');
    expect(account!.existedAsOf).toBe(false);
    // The declared figure is still reported, so the UI can show what was entered.
    expect(toDbString(account!.openingBalance)).toBe('50000.0000');

    expect(toDbString((await netWorth()).netWorth)).toBe('0.0000');

    // And it appears in full once the opening date arrives.
    const later = await netWorth('2026-12-01');
    expect(toDbString(later.netWorth)).toBe('50000.0000');
    const atOpening = await listAccounts(ctx, { asOf: D('2026-12-01') });
    expect(toDbString(atOpening[0]!.balance)).toBe('50000.0000');
  });

  it('an account created BEFORE the as-of date contributes its opening plus movements to that date', async () => {
    const bank = await makeAccount(fixture.ctx, { name: 'Bank', openingBalance: '10000', openingDate: '2019-01-01' });
    const salary = await categoryId(fixture.ctx, 'Salary');
    await record(fixture.ctx, { kind: 'income', accountId: bank, categoryId: salary, amount: '5000', bookedOn: '2020-06-01' });
    await record(fixture.ctx, { kind: 'income', accountId: bank, categoryId: salary, amount: '7000', bookedOn: '2021-06-01' });

    expect(toDbString((await netWorth('2020-12-31')).netWorth)).toBe('15000.0000');
  });

  it('an account closed AFTER the as-of date is fully counted at that date', async () => {
    const bank = await makeAccount(fixture.ctx, { name: 'Old bank', openingBalance: '30000', openingDate: '2024-01-01' });
    const { setAccountActive } = await import('@/server/services');
    must(await write(fixture.ctx, (w) => setAccountActive(w, bank, false)));

    // Closed today, but it existed and held value in 2025 — `is_active` is read
    // by no calculation (I-26).
    expect(toDbString((await netWorth('2025-06-30')).netWorth)).toBe('30000.0000');
    expect(toDbString((await netWorth()).netWorth)).toBe('30000.0000');
  });

  it('a manual asset disposed AFTER the as-of date is still present at its valuation in force', async () => {
    const flat = await makeAsset(fixture.ctx, {
      name: 'Flat',
      value: '8000000',
      valuedOn: '2024-01-01',
      acquiredOn: '2024-01-01',
    });
    await revalue(fixture.ctx, flat, '2026-01-01', '9000000');
    await dispose(fixture.ctx, flat, '2026-07-01');

    expect(toDbString((await netWorth('2025-06-30')).netWorth)).toBe('8000000.0000');
    expect(toDbString((await netWorth('2026-06-30')).netWorth)).toBe('9000000.0000');
    // Gone from the disposal date onward.
    expect(toDbString((await netWorth('2026-07-01')).netWorth)).toBe('0.0000');
  });

  it('a manual asset acquired after the as-of date is ineligible, not excluded', async () => {
    await makeAsset(fixture.ctx, { name: 'Car', kind: 'vehicle', value: '900000', acquiredOn: '2026-05-01', valuedOn: '2026-05-01' });
    const before = await netWorth('2026-04-30');
    expect(before.contributions).toHaveLength(0);
    expect(before.excluded).toHaveLength(0);
  });

  it('a manual asset held but not yet valued is EXCLUDED and named, never zero', async () => {
    const flat = await makeAsset(fixture.ctx, { name: 'Flat', value: '8000000', valuedOn: '2026-01-01', acquiredOn: '2024-01-01' });
    expect(flat).toBeTruthy();

    // Held from 2024, first valued in 2026: at 2025 it is eligible and unvalued.
    const result = await netWorth('2025-06-30');
    expect(toDbString(result.netWorth)).toBe('0.0000');
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0]!.label).toBe('Flat');
    expect(result.excluded[0]!.reason).toBe('unvalued');
    expect(rToDbString(result.assetCoverage)).toBe('0.0000000000');
  });

  it('an investment bought after the as-of date contributes nothing at it', async () => {
    const brk = await makeAccount(fixture.ctx, { name: 'Zerodha', kind: 'brokerage', openingBalance: '100000', openingDate: '2026-01-01' });
    const infy = await makeInstrument(fixture.ctx, { symbol: 'INFY' });
    must(await recordBuy(fixture.ctx, { accountId: brk, instrumentId: infy, on: '2026-05-01', qty: '600', price: '100' }));

    const before = await netWorth('2026-04-30');
    expect(before.contributions.filter((c) => c.group === 'investments')).toHaveLength(0);
    expect(toDbString(before.netWorth)).toBe('100000.0000');
  });

  it('an investment sold after the as-of date is still held at it', async () => {
    const brk = await makeAccount(fixture.ctx, { name: 'Zerodha', kind: 'brokerage', openingBalance: '100000', openingDate: '2026-01-01' });
    const infy = await makeInstrument(fixture.ctx, { symbol: 'INFY' });
    must(await recordBuy(fixture.ctx, { accountId: brk, instrumentId: infy, on: '2026-02-01', qty: '600', price: '100' }));
    must(await recordSell(fixture.ctx, { accountId: brk, instrumentId: infy, on: '2026-06-01', qty: '600', price: '150' }));

    const mid = await netWorth('2026-05-31');
    const position = mid.contributions.find((c) => c.group === 'investments')!;
    expect(toDbString(position.base)).toBe('60000.0000');
  });

  // I-23 — the transfer trap.
  it('a transfer_in lot contributes from opened_on, never from its carried acquired_on', async () => {
    const brk = await makeAccount(fixture.ctx, { name: 'New broker', kind: 'brokerage', openingDate: '2026-01-01' });
    const infy = await makeInstrument(fixture.ctx, { symbol: 'INFY' });
    // Shares acquired in 2024, moved into this account in 2026.
    must(
      await recordTransferIn(fixture.ctx, {
        accountId: brk,
        instrumentId: infy,
        on: '2026-03-01',
        qty: '100',
        price: '100',
        acquiredOn: '2024-01-15',
      }),
    );

    // Using `acquired_on` would place the lot here from 2024 and double-count
    // the whole intervening period against the source account.
    expect(toDbString((await netWorth('2025-12-31')).netWorth)).toBe('0.0000');
    expect(toDbString((await netWorth('2026-03-01')).netWorth)).toBe('10000.0000');
  });

  it('a liability balance takes the row in force, never a later one', async () => {
    const loan = await makeLiability(fixture.ctx, { name: 'Car loan', openingBalance: '500000', openingBalanceOn: '2026-01-01' });
    await recordBalance(fixture.ctx, loan, '2026-04-01', '400000');
    await recordBalance(fixture.ctx, loan, '2026-07-01', '300000');

    expect(toDbString((await netWorth('2026-03-31')).netWorth)).toBe('-500000.0000');
    expect(toDbString((await netWorth('2026-06-30')).netWorth)).toBe('-400000.0000');
    expect(toDbString((await netWorth('2026-07-01')).netWorth)).toBe('-300000.0000');
    // Before the series begins the debt did not exist.
    expect(toDbString((await netWorth('2025-12-31')).netWorth)).toBe('0.0000');
  });

  it('a closed scheduled liability stops counting from its terminal zero row — I-28', async () => {
    const loan = await makeLiability(fixture.ctx, { name: 'Car loan', openingBalance: '500000', openingBalanceOn: '2026-01-01' });
    await closeIt(fixture.ctx, loan, '2026-06-01');

    expect(toDbString((await netWorth('2026-05-31')).netWorth)).toBe('-500000.0000');
    expect(toDbString((await netWorth('2026-06-01')).netWorth)).toBe('0.0000');
  });

  it('same-day movements are order-independent', async () => {
    const bank = await makeAccount(fixture.ctx, { name: 'Bank', openingBalance: '10000', openingDate: '2026-01-01' });
    const salary = await categoryId(fixture.ctx, 'Salary');
    const food = await categoryId(fixture.ctx, 'Food');
    await record(fixture.ctx, { kind: 'income', accountId: bank, categoryId: salary, amount: '5000', bookedOn: '2026-02-01' });
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: food, amount: '2000', bookedOn: '2026-02-01' });
    expect(toDbString((await netWorth('2026-02-01')).netWorth)).toBe('13000.0000');
  });
});

// -------------------------------------------------------- liabilities & I-8

describe('liabilities', () => {
  it('a transacted liability contributes nothing — the account does (I-8)', async () => {
    const card = await makeAccount(fixture.ctx, {
      name: 'Card',
      kind: 'credit_card',
      creditLimit: '200000',
      openingBalance: '0',
      openingDate: '2026-01-01',
    });
    const food = await categoryId(fixture.ctx, 'Food');
    await record(fixture.ctx, { kind: 'expense', accountId: card, categoryId: food, amount: '45000', bookedOn: '2026-02-01' });
    await makeLiability(fixture.ctx, { name: 'HDFC card', kind: 'credit_card', linkedAccountId: card });

    const result = await netWorth();
    // ₹45,000 once, from the account — not ₹90,000.
    expect(toDbString(result.liabilities)).toBe('45000.0000');
    expect(result.contributions.filter((c) => c.key.t === 'liability')).toHaveLength(0);
  });

  it('rejects a liability linked to a bank account — I-27', async () => {
    const bank = await makeAccount(fixture.ctx, { name: 'Bank', openingBalance: '1000', openingDate: '2026-01-01' });
    const result = await write(fixture.ctx, (w) =>
      createLiability(w, {
        name: 'Bad link',
        kind: 'personal_loan',
        currencyCode: 'INR',
        linkedAccountId: bank,
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('validation_failed');
  });

  it('rejects two liabilities claiming one account — I-8', async () => {
    const card = await makeAccount(fixture.ctx, {
      name: 'Card',
      kind: 'credit_card',
      creditLimit: '100000',
      openingDate: '2026-01-01',
    });
    await makeLiability(fixture.ctx, { name: 'First', kind: 'credit_card', linkedAccountId: card });
    const second = await write(fixture.ctx, (w) =>
      createLiability(w, { name: 'Second', kind: 'credit_card', currencyCode: 'INR', linkedAccountId: card }),
    );
    expect(second.ok).toBe(false);
  });

  it('refuses a balance recorded against a transacted liability', async () => {
    const card = await makeAccount(fixture.ctx, {
      name: 'Card',
      kind: 'credit_card',
      creditLimit: '100000',
      openingDate: '2026-01-01',
    });
    const liability = await makeLiability(fixture.ctx, { name: 'HDFC', kind: 'credit_card', linkedAccountId: card });
    const result = await write(fixture.ctx, (w) =>
      recordLiabilityBalance(w, { liabilityId: liability, asOf: '2026-06-01', outstanding: '1000' }),
    );
    expect(result.ok).toBe(false);
  });
});

// ------------------------------------------------------------------ currency

describe('currency and FX', () => {
  it('converts a foreign account at the rate in force on the as-of date', async () => {
    await addFxRate('USD', 'INR', '2026-01-01', '80');
    await addFxRate('USD', 'INR', '2026-06-01', '84');
    await makeAccount(fixture.ctx, {
      name: 'US bank',
      currencyCode: 'USD',
      openingBalance: '1000',
      openingDate: '2026-01-01',
    });

    expect(toDbString((await netWorth('2026-03-01')).netWorth)).toBe('80000.0000');
    expect(toDbString((await netWorth('2026-06-30')).netWorth)).toBe('84000.0000');
  });

  it('excludes a component with no rate, names it, and never zeroes it', async () => {
    await makeAccount(fixture.ctx, { name: 'INR bank', openingBalance: '100000', openingDate: '2026-01-01' });
    await makeAccount(fixture.ctx, {
      name: 'US bank',
      currencyCode: 'USD',
      openingBalance: '1000',
      openingDate: '2026-01-01',
    });

    const result = await netWorth();
    expect(toDbString(result.netWorth)).toBe('100000.0000');
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0]!.reason).toBe('no_fx_rate');
    expect(toDbString(result.excluded[0]!.native)).toBe('1000.0000');
    expect(rToDbString(result.assetCoverage)).toBe('0.5000000000');
  });

  it('never uses a later rate for an earlier date', async () => {
    await addFxRate('USD', 'INR', '2026-06-01', '84');
    await makeAccount(fixture.ctx, {
      name: 'US bank',
      currencyCode: 'USD',
      openingBalance: '1000',
      openingDate: '2026-01-01',
    });
    // No rate on or before March → excluded, not valued at June's rate.
    const result = await netWorth('2026-03-01');
    expect(result.excluded).toHaveLength(1);
  });
});

// ------------------------------------------------------- series & reconcile

describe('series and reconciliation', () => {
  it('the last point of a series equals netWorthAsOf(today) — I-29', async () => {
    const bank = await makeAccount(fixture.ctx, { name: 'Bank', openingBalance: '10000', openingDate: '2026-01-01' });
    const salary = await categoryId(fixture.ctx, 'Salary');
    await record(fixture.ctx, { kind: 'income', accountId: bank, categoryId: salary, amount: '5000', bookedOn: '2026-03-01' });

    const ctx = await refreshCtx(fixture);
    const points = await netWorthSeries(ctx, [D('2026-01-31'), D('2026-03-31'), ctx.today]);
    const direct = must(await netWorthAsOf(ctx));

    expect(points).toHaveLength(3);
    expect(toDbString(points[0]!.result.netWorth)).toBe('10000.0000');
    expect(toDbString(points[1]!.result.netWorth)).toBe('15000.0000');
    expect(toDbString(points.at(-1)!.result.netWorth)).toBe(toDbString(direct.netWorth));
  });

  it('reconciles by an independent path, exactly — I-22', async () => {
    const bank = await makeAccount(fixture.ctx, { name: 'Bank', openingBalance: '120000', openingDate: '2026-01-01' });
    expect(bank).toBeTruthy();
    await makeAsset(fixture.ctx, { name: 'Flat', value: '8000000', valuedOn: '2026-01-01', acquiredOn: '2024-01-01' });
    await makeLiability(fixture.ctx, { name: 'Home loan', openingBalance: '2500000', openingBalanceOn: '2026-01-01' });

    const ctx = await refreshCtx(fixture);
    const { result, reconciliation } = must(await netWorthReconciliation(ctx));

    expect(reconciliation.balances).toBe(true);
    expect(toDbString(reconciliation.residual)).toBe('0.0000');
    expect(toDbString(reconciliation.netWorth)).toBe(toDbString(result.netWorth));
    expect(toDbString(result.netWorth)).toBe('5620000.0000');

    // Every rupee traceable to a source.
    const property = reconciliation.lines.find((l) => l.group === 'property')!;
    expect(property.sources[0]!.label).toBe('Flat');
  });
});

// -------------------------------------------------------------------- bridge

describe('change bridge', () => {
  it('closes exactly on a single-currency ledger — I-30', async () => {
    const bank = await makeAccount(fixture.ctx, { name: 'Bank', openingBalance: '100000', openingDate: '2026-01-01' });
    const salary = await categoryId(fixture.ctx, 'Salary');
    const food = await categoryId(fixture.ctx, 'Food');
    await record(fixture.ctx, { kind: 'income', accountId: bank, categoryId: salary, amount: '50000', bookedOn: '2026-03-01' });
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: food, amount: '12000', bookedOn: '2026-03-15' });

    const ctx = await refreshCtx(fixture);
    const b = must(await netWorthChange(ctx, D('2026-02-28'), D('2026-03-31')));

    expect(toDbString(b.delta)).toBe('38000.0000');
    expect(toDbString(b.unexplained)).toBe('0.0000');
    expect(b.singleCurrency).toBe(true);
    expect(bridgeCloses(b)).toBe(true);
  });

  it('closes across a buy, a sell and a dividend', async () => {
    const brk = await makeAccount(fixture.ctx, { name: 'Zerodha', kind: 'brokerage', openingBalance: '100000', openingDate: '2026-01-01' });
    const infy = await makeInstrument(fixture.ctx, { symbol: 'INFY' });
    must(await recordBuy(fixture.ctx, { accountId: brk, instrumentId: infy, on: '2026-03-01', qty: '600', price: '100' }));
    must(await recordSell(fixture.ctx, { accountId: brk, instrumentId: infy, on: '2026-03-10', qty: '200', price: '150' }));
    must(await recordDividend(fixture.ctx, { accountId: brk, instrumentId: infy, on: '2026-03-20', gross: '500', taxes: '50' }));

    const ctx = await refreshCtx(fixture);
    const b = must(await netWorthChange(ctx, D('2026-02-28'), D('2026-03-31')));

    // 10,000 realised + 450 net dividend.
    expect(toDbString(b.delta)).toBe('10450.0000');
    expect(toDbString(b.unexplained)).toBe('0.0000');
  });

  it('closes across a manual asset revaluation and a scheduled repayment', async () => {
    const flat = await makeAsset(fixture.ctx, { name: 'Flat', value: '8000000', valuedOn: '2026-01-01', acquiredOn: '2024-01-01' });
    const loan = await makeLiability(fixture.ctx, { name: 'Home loan', openingBalance: '2500000', openingBalanceOn: '2026-01-01' });
    await revalue(fixture.ctx, flat, '2026-03-01', '8500000');
    await recordBalance(fixture.ctx, loan, '2026-03-15', '2400000');

    const ctx = await refreshCtx(fixture);
    const b = must(await netWorthChange(ctx, D('2026-02-28'), D('2026-03-31')));

    expect(toDbString(b.delta)).toBe('600000.0000');
    expect(toDbString(b.unexplained)).toBe('0.0000');
    expect(toDbString(b.lines.find((l) => l.key === 'asset_revaluation')!.amount)).toBe('500000.0000');
    expect(toDbString(b.lines.find((l) => l.key === 'liability_change')!.amount)).toBe('100000.0000');
  });

  it('reports the unrealised gain as NOT MEASURED at cost basis', async () => {
    await makeAccount(fixture.ctx, { name: 'Bank', openingBalance: '1000', openingDate: '2026-01-01' });
    const ctx = await refreshCtx(fixture);
    const b = must(await netWorthChange(ctx, D('2026-02-28'), D('2026-03-31')));
    const line = b.lines.find((l) => l.key === 'unrealized_gain')!;
    expect(line.notMeasured).toBe(true);
    expect(toDbString(line.amount)).toBe('0.0000');
  });

  it('does not double-count a card purchase as both spending and debt', async () => {
    const card = await makeAccount(fixture.ctx, {
      name: 'Card',
      kind: 'credit_card',
      creditLimit: '200000',
      openingBalance: '0',
      openingDate: '2026-01-01',
    });
    await makeLiability(fixture.ctx, { name: 'HDFC card', kind: 'credit_card', linkedAccountId: card });
    const food = await categoryId(fixture.ctx, 'Food');
    await record(fixture.ctx, { kind: 'expense', accountId: card, categoryId: food, amount: '10000', bookedOn: '2026-03-05' });

    const ctx = await refreshCtx(fixture);
    const b = must(await netWorthChange(ctx, D('2026-02-28'), D('2026-03-31')));

    expect(toDbString(b.delta)).toBe('-10000.0000');
    expect(toDbString(b.unexplained)).toBe('0.0000');
    expect(toDbString(b.lines.find((l) => l.key === 'liability_change')!.amount)).toBe('0.0000');
  });
});

// ------------------------------------------------------------ user isolation

describe('user isolation — I-32', () => {
  it('a second user’s accounts, assets and liabilities are invisible', async () => {
    await makeAccount(fixture.ctx, { name: 'Bank', openingBalance: '100000', openingDate: '2026-01-01' });
    await makeAsset(fixture.ctx, { name: 'Flat', value: '8000000', valuedOn: '2026-01-01' });

    const other = await setupMoneyFixture({ now: new Date('2026-08-10T12:00:00Z') });
    must(
      await write(other.ctx, (w) =>
        createManualAsset(w, { name: 'Their flat', kind: 'property', currencyCode: 'INR', value: '99999999' }),
      ),
    );
    must(
      await write(other.ctx, (w) =>
        createLiability(w, {
          name: 'Their loan',
          kind: 'home_loan',
          currencyCode: 'INR',
          openingBalance: '5000000',
          openingBalanceOn: '2026-01-01',
        }),
      ),
    );

    const mine = await netWorth();
    expect(toDbString(mine.netWorth)).toBe('8100000.0000');
    expect(mine.contributions.map((c) => c.label)).not.toContain('Their flat');
    expect(mine.contributions.map((c) => c.label)).not.toContain('Their loan');
  });
});

// ------------------------------------------------------------------ services

describe('manual asset service rules', () => {
  it('revaluing inserts rather than updating, and the series drives history', async () => {
    const flat = await makeAsset(fixture.ctx, { name: 'Flat', value: '8000000', valuedOn: '2026-01-01' });
    await revalue(fixture.ctx, flat, '2026-06-01', '9000000');

    expect(toDbString((await netWorth('2026-05-31')).netWorth)).toBe('8000000.0000');
    expect(toDbString((await netWorth('2026-06-01')).netWorth)).toBe('9000000.0000');
  });

  it('refuses a second valuation on the same date', async () => {
    const flat = await makeAsset(fixture.ctx, { name: 'Flat', value: '8000000', valuedOn: '2026-01-01' });
    const again = await write(fixture.ctx, (w) =>
      revalueAsset(w, { assetId: flat, asOf: '2026-01-01', value: '9000000' }),
    );
    expect(again.ok).toBe(false);
  });

  it('refuses a valuation dated before acquisition', async () => {
    const flat = await makeAsset(fixture.ctx, { name: 'Flat', value: '8000000', acquiredOn: '2026-01-01', valuedOn: '2026-01-01' });
    const early = await write(fixture.ctx, (w) =>
      revalueAsset(w, { assetId: flat, asOf: '2025-01-01', value: '1' }),
    );
    expect(early.ok).toBe(false);
  });
});
