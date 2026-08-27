import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/date';
import { toDbString } from '@/lib/decimal/money';
import { rToDbString } from '@/lib/decimal/rate';
import {
  netWorthAsOf,
  netWorthChange,
  netWorthComparison,
  netWorthReconciliation,
  netWorthSeries,
} from '@/server/services';
import { bridgeCloses } from '@/server/domain/networth/bridge';
import { closeHarness, truncateAll } from './harness';
import {
  addFxRate,
  closeMoneyHarness,
  makeAccount,
  must,
  rawSql,
  refreshCtx,
  setupMoneyFixture,
  truncateMoney,
  type MoneyFixture,
} from './money-harness';
import {
  closeNetWorthHarness,
  makeAsset,
  makeLiability,
  recordBalance,
  truncateNetWorth,
} from './networth-harness';
import {
  detectSplit,
  makeInstrument,
  recordBuy,
  recordCorporateAction,
  recordSell,
  storeClose,
  truncateInvestments,
} from './investment-harness';

/**
 * **Net Worth at Market Value** end to end
 * ([MARKET-VALUE-NET-WORTH-DESIGN.md](../../docs/MARKET-VALUE-NET-WORTH-DESIGN.md),
 * [TESTING.md §6.7](../../docs/TESTING.md), ADR-23 / ADR-31 / ADR-32).
 *
 * Two families of test, and the second is the one that matters:
 *
 * 1. that the market figure is right;
 * 2. that **the cost figure did not move**, and that market value is right for
 *    the right reason — a position priced or excluded, never cost-substituted;
 *    quantity from the ledger, never from today's cache.
 */

let fixture: MoneyFixture;
const D = (s: string) => isoDate(s);

/** `today` for the whole suite. Friday 2026-08-14 is a trading day. */
const TODAY = new Date('2026-08-14T18:00:00Z');

beforeAll(async () => {
  await truncateAll();
  fixture = await setupMoneyFixture({ now: TODAY });
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

async function cost(asOf?: string) {
  const ctx = await refreshCtx(fixture);
  return must(await netWorthAsOf(ctx, asOf === undefined ? {} : { asOf: D(asOf) }));
}

async function market(asOf?: string) {
  const ctx = await refreshCtx(fixture);
  return must(
    await netWorthAsOf(ctx, { basis: 'market', ...(asOf === undefined ? {} : { asOf: D(asOf) }) }),
  );
}

async function comparison(asOf?: string) {
  const ctx = await refreshCtx(fixture);
  return must(await netWorthComparison(ctx, asOf === undefined ? {} : { asOf: D(asOf) }));
}

/**
 * The worked case from the design: a brokerage opens with ₹1,00,000 and buys
 * ₹60,000 of securities now worth ₹72,000.
 */
async function brokerageFixture(options: { readonly price?: string } = {}) {
  const ctx = await refreshCtx(fixture);
  const accountId = await makeAccount(ctx, {
    name: 'Zerodha',
    kind: 'brokerage',
    openingBalance: '100000',
    openingDate: '2026-01-01',
  });
  const instrumentId = await makeInstrument(ctx, { symbol: 'INFY', exchange: 'NSE' });
  must(
    await recordBuy(ctx, {
      accountId,
      instrumentId,
      on: '2026-02-02',
      qty: '400',
      price: '150',
    }),
  );
  if (options.price !== undefined) {
    await storeClose(ctx, { instrumentId, on: '2026-08-14', close: options.price });
  }
  return { accountId, instrumentId };
}

// ------------------------------------------------------- 1. cost is unchanged

describe('the default basis is cost, and the cost figure does not move', () => {
  it('netWorthAsOf(ctx, {}) declares basis cost (ADR-32)', async () => {
    await brokerageFixture({ price: '180' });
    const result = await cost();
    expect(result.basis).toBe('cost');
    expect(result.market).toBeNull();
  });

  it('the cost figure is byte-identical with and without market data present', async () => {
    const { instrumentId } = await brokerageFixture();
    const before = await cost();

    const ctx = await refreshCtx(fixture);
    await storeClose(ctx, { instrumentId, on: '2026-08-14', close: '180' });
    const after = await cost();

    // A price arriving must not move Net Worth at Cost by one minor unit. This
    // is the whole promise of ADR-32: the headline changes only when the user
    // does something.
    expect(toDbString(after.netWorth)).toBe(toDbString(before.netWorth));
    expect(toDbString(after.assets)).toBe(toDbString(before.assets));
    expect(after.contributions.length).toBe(before.contributions.length);
  });

  it('cash ₹40,000 + cost ₹60,000 = ₹1,00,000, not ₹1,60,000', async () => {
    await brokerageFixture();
    expect(toDbString((await cost()).netWorth)).toBe('100000.0000');
  });

  it('the comparison returns the same cost result the default view shows', async () => {
    await brokerageFixture({ price: '180' });
    const solo = await cost();
    const both = await comparison();
    expect(toDbString(both.cost.netWorth)).toBe(toDbString(solo.netWorth));
    expect(both.cost.basis).toBe('cost');
  });
});

// ------------------------------------------- 2-4. market value, counted once

describe('market value, counted once', () => {
  it('cash ₹40,000 + market ₹72,000 = ₹1,12,000', async () => {
    await brokerageFixture({ price: '180' });
    const result = await market();
    expect(result.basis).toBe('market');
    // NOT ₹1,72,000 — the market figure occupies the position's key INSTEAD OF
    // the cost figure, never in addition to it.
    expect(toDbString(result.netWorth)).toBe('112000.0000');
    expect(result.market!.status).toBe('complete');
  });

  it('the position contributes exactly once, under its own key', async () => {
    const { accountId, instrumentId } = await brokerageFixture({ price: '180' });
    const result = await market();
    const keys = result.contributions.map((c) => c.keyId);
    expect(keys).toContain(`account:${accountId}`);
    expect(keys).toContain(`position:${accountId}:${instrumentId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('the contribution carries its own provenance — units, price, session, source', async () => {
    const { accountId, instrumentId } = await brokerageFixture({ price: '180' });
    const result = await market();
    const position = result.contributions.find(
      (c) => c.keyId === `position:${accountId}:${instrumentId}`,
    )!;
    expect(position.price).toBeDefined();
    expect(position.price!.quantity.units).toBe(40_000_000_000n);
    expect(position.price!.unitPrice.units).toBe(18_000_000_000n);
    expect(position.price!.tradingDate).toBe('2026-08-14');
    expect(position.price!.source).toBe('test-feed');
  });

  it('a buy still leaves market net worth unchanged on the day it is made', async () => {
    // Cash becomes basis, and at the trade-date close the two are equal — the
    // single-counting proof, restated on the market basis.
    const ctx = await refreshCtx(fixture);
    const accountId = await makeAccount(ctx, {
      name: 'Zerodha',
      kind: 'brokerage',
      openingBalance: '100000',
      openingDate: '2026-01-01',
    });
    const instrumentId = await makeInstrument(ctx, { symbol: 'TCS', exchange: 'NSE' });
    must(await recordBuy(ctx, { accountId, instrumentId, on: '2026-02-02', qty: '400', price: '150' }));
    const ctx2 = await refreshCtx(fixture);
    await storeClose(ctx2, { instrumentId, on: '2026-02-02', close: '150' });

    expect(toDbString((await market('2026-02-02')).netWorth)).toBe('100000.0000');
  });

  it('a position sold to zero contributes nothing and is not an exclusion', async () => {
    const { accountId, instrumentId } = await brokerageFixture({ price: '180' });
    const ctx = await refreshCtx(fixture);
    must(await recordSell(ctx, { accountId, instrumentId, on: '2026-06-01', qty: '400', price: '170' }));

    const result = await market();
    expect(result.market!.status).toBe('complete');
    expect(result.excluded).toHaveLength(0);
    // ₹40,000 opening cash + ₹68,000 proceeds.
    expect(toDbString(result.netWorth)).toBe('108000.0000');
  });
});

// -------------------------------------------------- 6-8. price states

describe('price states', () => {
  it('a fresh price contributes with no staleness note', async () => {
    await brokerageFixture({ price: '180' });
    const result = await market();
    expect(result.market!.staleness).toEqual({ count: 0, oldestTradingDate: null });
  });

  it('a stale price contributes and is flagged — never swapped for cost (I-44)', async () => {
    const { instrumentId } = await brokerageFixture();
    const ctx = await refreshCtx(fixture);
    // Four sessions before today, and past the ten-day backstop.
    for (const on of ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30']) {
      await storeClose(ctx, { instrumentId, on, close: '180' });
    }

    const result = await market();
    expect(toDbString(result.netWorth)).toBe('112000.0000');
    expect(result.market!.status).toBe('complete');
    expect(result.market!.staleness.count).toBe(1);
    expect(result.market!.staleness.oldestTradingDate).toBe('2026-07-30');
    expect(result.excluded).toHaveLength(0);
  });

  it('a missing price excludes and names the holding, and never substitutes cost', async () => {
    await brokerageFixture();
    const result = await market();

    // NOT ₹1,00,000, which would be the cost-substituted figure (I-39).
    expect(toDbString(result.netWorth)).toBe('40000.0000');
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0]!.reason).toBe('no_provider');
    expect(toDbString(result.excluded[0]!.native)).toBe('60000.0000');
  });

  it('an unreconciled split suppresses the value entirely (ADR-29)', async () => {
    const { instrumentId } = await brokerageFixture({ price: '180' });
    // The provider says 2:1 on 1 June; the ledger has no such row. Price and
    // quantity are on opposite sides of the action, so their product is a large,
    // internally consistent, wrong number. It is suppressed, never adjusted.
    await detectSplit(fixture.userId, { instrumentId, exDate: '2026-06-01', num: 2, den: 1 });

    const result = await market();
    expect(result.excluded[0]!.reason).toBe('unreconciled_corporate_action');
    expect(toDbString(result.netWorth)).toBe('40000.0000');
    // The 80% phantom never appears.
    expect(toDbString(result.netWorth)).not.toBe('112000.0000');
  });

  it('suppression applies from the ex-date, not before it', async () => {
    const { instrumentId } = await brokerageFixture({ price: '180' });
    const ctx = await refreshCtx(fixture);
    await storeClose(ctx, { instrumentId, on: '2026-05-29', close: '160' });
    await detectSplit(fixture.userId, { instrumentId, exDate: '2026-06-01', num: 2, den: 1 });

    // Before the ex-date price and quantity agree, so the figure is correct and
    // suppressing it would blank a holding that is right.
    const before = await market('2026-05-29');
    expect(before.excluded).toHaveLength(0);
    expect(toDbString(before.netWorth)).toBe('104000.0000');
  });
});

// --------------------------------------------- 9-11. partial and unavailable

describe('valuation completeness', () => {
  async function mixedPortfolio() {
    const ctx = await refreshCtx(fixture);
    const accountId = await makeAccount(ctx, {
      name: 'Zerodha',
      kind: 'brokerage',
      openingBalance: '1000000',
      openingDate: '2026-01-01',
    });
    const equity = await makeInstrument(ctx, { symbol: 'INFY', exchange: 'NSE' });
    const bond = await makeInstrument(ctx, {
      symbol: 'GSEC2032',
      exchange: 'NSE',
      assetClass: 'bond',
    });
    must(await recordBuy(ctx, { accountId, instrumentId: equity, on: '2026-02-02', qty: '100', price: '1000' }));
    must(await recordBuy(ctx, { accountId, instrumentId: bond, on: '2026-02-03', qty: '500', price: '1000' }));

    const ctx2 = await refreshCtx(fixture);
    await storeClose(ctx2, { instrumentId: equity, on: '2026-08-14', close: '1200' });
    return { accountId, equity, bond };
  }

  it('partial: the figure is reported, the exclusion named and its cost shown', async () => {
    await mixedPortfolio();
    const result = await market();

    expect(result.market!.status).toBe('partial');
    // ₹4,00,000 cash + ₹1,20,000 equity at market. NOT ₹6,20,000, which would be
    // part market value and part acquisition cost — a figure in no basis at all.
    expect(toDbString(result.netWorth)).toBe('520000.0000');
    expect(result.excluded).toHaveLength(1);
    expect(toDbString(result.market!.excludedInvestmentCost)).toBe('500000.0000');
  });

  it('coverage is value-weighted by base cost basis, not by component count', async () => {
    await mixedPortfolio();
    const result = await market();
    // Component count would say 1 of 2 = 50%. Cost weight says 100,000/600,000.
    expect(rToDbString(result.market!.investmentCoverage)).toBe('0.1666666667');
  });

  it('unavailable: holdings exist, none can be priced, the headline is withheld', async () => {
    await brokerageFixture();
    const result = await market();
    expect(result.market!.status).toBe('unavailable');
    expect(rToDbString(result.market!.investmentCoverage)).toBe('0.0000000000');
  });

  it('complete: no investments at all is complete, not unavailable', async () => {
    const ctx = await refreshCtx(fixture);
    await makeAccount(ctx, {
      name: 'HDFC',
      kind: 'bank',
      openingBalance: '250000',
      openingDate: '2026-01-01',
    });
    const result = await market();
    expect(result.market!.status).toBe('complete');
    expect(toDbString(result.netWorth)).toBe('250000.0000');
  });
});

// ------------------------------------------ 12-17. historical reconstruction

describe('historical market value', () => {
  it('reads quantity from the ledger, and a split moves it (I-46, I-47)', async () => {
    const ctx = await refreshCtx(fixture);
    const accountId = await makeAccount(ctx, {
      name: 'Zerodha',
      kind: 'brokerage',
      openingBalance: '100000',
      openingDate: '2026-01-01',
    });
    const instrumentId = await makeInstrument(ctx, { symbol: 'INFY', exchange: 'NSE' });
    must(await recordBuy(ctx, { accountId, instrumentId, on: '2026-02-02', qty: '400', price: '150' }));
    must(await recordCorporateAction(ctx, { accountId, instrumentId, on: '2026-05-01', num: 2, den: 1 }));

    const ctx2 = await refreshCtx(fixture);
    // ₹180 before the split, ₹90 after — the same economic value.
    await storeClose(ctx2, { instrumentId, on: '2026-04-30', close: '180' });
    await storeClose(ctx2, { instrumentId, on: '2026-05-04', close: '90' });

    // 400 × 180 = ₹72,000 before; 800 × 90 = ₹72,000 after. A plain Σ quantity
    // would report 400 × 90 = ₹36,000 and halve the portfolio overnight.
    expect(toDbString((await market('2026-04-30')).netWorth)).toBe('112000.0000');
    expect(toDbString((await market('2026-05-04')).netWorth)).toBe('112000.0000');
  });

  it("a fully disposed holding still has value at the dates it was held", async () => {
    const { accountId, instrumentId } = await brokerageFixture({ price: '180' });
    const ctx = await refreshCtx(fixture);
    await storeClose(ctx, { instrumentId, on: '2026-04-30', close: '170' });
    const ctx2 = await refreshCtx(fixture);
    must(await recordSell(ctx2, { accountId, instrumentId, on: '2026-06-01', qty: '400', price: '170' }));

    // Reading TODAY's position to decide what to price produces a plausible,
    // wrong series: this holding is gone now and was worth ₹68,000 in April.
    const back = await market('2026-04-30');
    expect(toDbString(back.netWorth)).toBe('108000.0000');
    expect(back.contributions.some((c) => c.price !== undefined)).toBe(true);
  });

  it('a weekend carries back to the previous session, and is not stale', async () => {
    const { instrumentId } = await brokerageFixture();
    const ctx = await refreshCtx(fixture);
    await storeClose(ctx, { instrumentId, on: '2026-05-01', close: '180' }); // Friday

    const sunday = await market('2026-05-03');
    expect(toDbString(sunday.netWorth)).toBe('112000.0000');
    expect(sunday.market!.staleness.count).toBe(0);
    expect(sunday.market!.maxCarriedDays).toBe(2);
  });

  it('a market holiday behaves the same way — a closure advances no session', async () => {
    const { instrumentId } = await brokerageFixture();
    const ctx = await refreshCtx(fixture);
    await storeClose(ctx, { instrumentId, on: '2026-03-02', close: '180' });
    await storeClose(ctx, { instrumentId, on: '2026-03-06', close: '185' });

    // 3-5 March are absent from the series, so they were not sessions.
    const holiday = await market('2026-03-04');
    expect(toDbString(holiday.netWorth)).toBe('112000.0000');
    expect(holiday.market!.staleness.count).toBe(0);
  });

  it('no price on or before the date is a gap, never zero and never cost', async () => {
    const { instrumentId } = await brokerageFixture();
    const ctx = await refreshCtx(fixture);
    await storeClose(ctx, { instrumentId, on: '2026-08-14', close: '180' });

    const early = await market('2026-03-01');
    expect(early.excluded).toHaveLength(1);
    expect(early.excluded[0]!.reason).toBe('no_price_on_date');
    expect(toDbString(early.netWorth)).toBe('40000.0000');
  });

  it('the carry-back is bounded — beyond it the point is a gap', async () => {
    const { instrumentId } = await brokerageFixture();
    const ctx = await refreshCtx(fixture);
    await storeClose(ctx, { instrumentId, on: '2026-05-01', close: '180' });

    expect((await market('2026-05-11')).excluded).toHaveLength(0);
    const beyond = await market('2026-05-12');
    expect(beyond.excluded[0]!.reason).toBe('no_price_on_date');
  });

  it('the last point of a market series equals netWorthAsOf(today) (I-29)', async () => {
    await brokerageFixture({ price: '180' });
    const ctx = await refreshCtx(fixture);
    const series = await netWorthSeries(
      ctx,
      [D('2026-06-30'), D('2026-07-31'), D('2026-08-14')],
      { basis: 'market' },
    );
    const solo = await market();
    expect(toDbString(series[2]!.result.netWorth)).toBe(toDbString(solo.netWorth));
    expect(series[2]!.result.basis).toBe('market');
  });
});

// -------------------------------------------------------------- 14. historical FX

describe('foreign holdings and dated FX', () => {
  async function usdFixture() {
    await addFxRate('USD', 'INR', '2026-02-01', '75.0000000000');
    await addFxRate('USD', 'INR', '2026-08-01', '83.0000000000');

    const ctx = await refreshCtx(fixture);
    const accountId = await makeAccount(ctx, {
      name: 'IBKR',
      kind: 'brokerage',
      openingBalance: '10000',
      openingDate: '2026-01-01',
      currencyCode: 'USD',
    });
    const instrumentId = await makeInstrument(ctx, {
      symbol: 'VOO',
      exchange: 'NYSE',
      currencyCode: 'USD',
      country: 'US',
    });
    must(await recordBuy(ctx, { accountId, instrumentId, on: '2026-02-02', qty: '10', price: '400' }));
    return { accountId, instrumentId };
  }

  it('converts at the dated rate, and the acquisition rate stays on the cost figure', async () => {
    const { instrumentId } = await usdFixture();
    const ctx = await refreshCtx(fixture);
    await storeClose(ctx, {
      instrumentId,
      on: '2026-08-14',
      close: '450',
      currencyCode: 'USD',
    });

    const both = await comparison();
    // Cost: $4,000 at the 1 Feb rate of 75 = ₹3,00,000, plus $6,000 cash at 83.
    // Market: 10 × $450 = $4,500 at 83 = ₹3,73,500.
    const position = both.market.contributions.find((c) => c.key.t === 'position')!;
    expect(toDbString(position.native)).toBe('4500.0000');
    expect(position.nativeCurrency).toBe('USD');
    expect(rToDbString(position.rate)).toBe('83.0000000000');
    expect(toDbString(position.base)).toBe('373500.0000');
  });

  it('the restatement splits the difference into currency and price', async () => {
    const { instrumentId } = await usdFixture();
    const ctx = await refreshCtx(fixture);
    await storeClose(ctx, { instrumentId, on: '2026-08-14', close: '450', currencyCode: 'USD' });

    const { restatement } = await comparison();
    const line = (key: string) => restatement.lines.find((l) => l.key === key)!;

    // FX rebasis: $4,000 of cost at 83 instead of at 75 → +₹32,000.
    expect(toDbString(line('fx_rebasis').amount)).toBe('32000.0000');
    // Price effect: ($4,500 − $4,000) at 83 → +₹41,500.
    expect(toDbString(line('price_effect').amount)).toBe('41500.0000');
    expect(toDbString(line('removed_unpriced').amount)).toBe('0.0000');
    expect(restatement.closes).toBe(true);
  });

  it('a missing rate excludes the holding with no_fx_rate, as Phase 5 does', async () => {
    // A foreign position always has a rate on its own trade date — the service
    // refuses the mutation without one. The reachable failure is the reference
    // data going away afterwards, which is what this reproduces: `fx_rates` has
    // no `user_id` and is not owned by the ledger that depends on it.
    const { instrumentId } = await usdFixture();
    const ctx = await refreshCtx(fixture);
    await storeClose(ctx, { instrumentId, on: '2026-08-14', close: '450', currencyCode: 'USD' });
    await rawSql(`delete from fx_rates where base_code = 'USD' and quote_code = 'INR'`);

    const result = await market();
    expect(result.excluded.map((e) => e.reason)).toContain('no_fx_rate');
    // The magnitude is still reported, so the gap has a size and not only a name.
    expect(result.excluded.some((e) => e.native.minor > 0n)).toBe(true);
  });
});

// ------------------------------------------------- 18-19. assets, liabilities

describe('what the market basis does NOT change', () => {
  it('a manual asset keeps its own valuation — it has no price', async () => {
    const ctx = await refreshCtx(fixture);
    await makeAsset(ctx, { name: 'Flat', value: '8000000', valuedOn: '2026-03-01' });

    const both = await comparison();
    const inCost = both.cost.contributions.find((c) => c.key.t === 'asset')!;
    const inMarket = both.market.contributions.find((c) => c.key.t === 'asset')!;
    expect(toDbString(inMarket.base)).toBe(toDbString(inCost.base));
    expect(inMarket.price).toBeUndefined();
  });

  it('an eligible but unvalued asset is excluded on both bases, identically', async () => {
    const ctx = await refreshCtx(fixture);
    await makeAsset(ctx, { name: 'Flat', value: '8000000', valuedOn: '2026-03-01' });

    const both = await comparison('2026-02-01');
    expect(both.cost.excluded.map((e) => e.reason)).toEqual(both.market.excluded.map((e) => e.reason));
  });

  it('a scheduled liability is identical on both bases, and has no market term', async () => {
    const ctx = await refreshCtx(fixture);
    const liabilityId = await makeLiability(ctx, {
      name: 'Home loan',
      openingBalance: '5000000',
      openingBalanceOn: '2026-01-01',
    });
    await recordBalance(ctx, liabilityId, '2026-06-01', '4800000');

    const both = await comparison();
    expect(toDbString(both.market.liabilities)).toBe(toDbString(both.cost.liabilities));
    // A liability term in the restatement would be a bug: a loan's outstanding
    // principal is a contractual amount, not a traded price.
    expect(toDbString(both.restatement.difference)).toBe('0.0000');
  });
});

// ------------------------------------------- 20-22. reconciliation, restatement

describe('reconciliation and restatement', () => {
  it('the market figure reconciles by a second independent path (I-22)', async () => {
    await brokerageFixture({ price: '180' });
    const { market: result, reconciliation } = await comparison();
    expect(reconciliation.balances).toBe(true);
    expect(toDbString(reconciliation.residual)).toBe('0.0000');
    expect(toDbString(reconciliation.netWorth)).toBe(toDbString(result.netWorth));
  });

  it('the restatement closes exactly for single-currency data (I-48)', async () => {
    await brokerageFixture({ price: '180' });
    const { restatement } = await comparison();

    expect(toDbString(restatement.cost)).toBe('100000.0000');
    expect(toDbString(restatement.market)).toBe('112000.0000');
    expect(toDbString(restatement.difference)).toBe('12000.0000');
    expect(restatement.lines.map((l) => [l.key, toDbString(l.amount)])).toEqual([
      ['removed_unpriced', '0.0000'],
      ['fx_rebasis', '0.0000'],
      ['price_effect', '12000.0000'],
    ]);
    expect(toDbString(restatement.residual)).toBe('0.0000');
  });

  it('an unpriced holding leaves through the removed line, and is named', async () => {
    await brokerageFixture();
    const { restatement } = await comparison();
    expect(toDbString(restatement.lines[0]!.amount)).toBe('-60000.0000');
    expect(restatement.unpricedKeys).toHaveLength(1);
    expect(restatement.closes).toBe(true);
  });

  it('the market bridge carries a real unrealised-gain line and still closes', async () => {
    const { instrumentId } = await brokerageFixture();
    const ctx = await refreshCtx(fixture);
    await storeClose(ctx, { instrumentId, on: '2026-06-30', close: '160' });
    await storeClose(ctx, { instrumentId, on: '2026-08-14', close: '180' });

    const ctx2 = await refreshCtx(fixture);
    const change = must(await netWorthChange(ctx2, D('2026-06-30'), D('2026-08-14'), { basis: 'market' }));

    const unrealized = change.lines.find((l) => l.key === 'unrealized_gain')!;
    expect(unrealized.notMeasured).toBe(false);
    // 400 × (180 − 160) = ₹8,000.
    expect(toDbString(unrealized.amount)).toBe('8000.0000');
    expect(bridgeCloses(change)).toBe(true);
    expect(toDbString(change.unexplained)).toBe('0.0000');
  });

  it('the cost bridge is untouched — unrealised gain stays not-measured', async () => {
    await brokerageFixture({ price: '180' });
    const ctx = await refreshCtx(fixture);
    const change = must(await netWorthChange(ctx, D('2026-06-30'), D('2026-08-14')));
    const unrealized = change.lines.find((l) => l.key === 'unrealized_gain')!;
    expect(unrealized.notMeasured).toBe(true);
    expect(toDbString(unrealized.amount)).toBe('0.0000');
    expect(bridgeCloses(change)).toBe(true);
  });
});

// ------------------------------------------------------------ 23. isolation

describe('I-32 — user isolation', () => {
  it("another user's holdings, prices and accounts are invisible", async () => {
    await brokerageFixture({ price: '180' });

    const other = await setupMoneyFixture({ now: TODAY });
    const otherAccount = await makeAccount(other.ctx, {
      name: 'Theirs',
      kind: 'brokerage',
      openingBalance: '9999999',
      openingDate: '2026-01-01',
    });
    const otherInstrument = await makeInstrument(other.ctx, { symbol: 'RELI', exchange: 'NSE' });
    must(
      await recordBuy(other.ctx, {
        accountId: otherAccount,
        instrumentId: otherInstrument,
        on: '2026-02-02',
        qty: '100',
        price: '1000',
      }),
    );
    const otherCtx = await refreshCtx(other);
    await storeClose(otherCtx, { instrumentId: otherInstrument, on: '2026-08-14', close: '1500' });

    const mine = await market();
    expect(toDbString(mine.netWorth)).toBe('112000.0000');
    expect(mine.contributions.every((c) => !c.label.includes('Theirs'))).toBe(true);
  });
});

// -------------------------------------------------- 24-25. precision, repeatability

describe('precision and determinism', () => {
  it('a provider price of 1629.80004883 survives to the market value (I-49)', async () => {
    const ctx = await refreshCtx(fixture);
    const accountId = await makeAccount(ctx, {
      name: 'Zerodha',
      kind: 'brokerage',
      openingBalance: '1000000',
      openingDate: '2026-01-01',
    });
    const instrumentId = await makeInstrument(ctx, { symbol: 'BAJFIN', exchange: 'NSE' });
    must(await recordBuy(ctx, { accountId, instrumentId, on: '2026-02-02', qty: '400', price: '1500' }));

    const ctx2 = await refreshCtx(fixture);
    await storeClose(ctx2, { instrumentId, on: '2026-08-14', close: '1629.80004883' });

    const result = await market();
    const position = result.contributions.find((c) => c.key.t === 'position')!;
    expect(position.price!.unitPrice.units).toBe(162_980_004_883n);
    // 400 × 1629.80004883 = 651920.019532 → one rounding, half_up → 651920.0195.
    expect(toDbString(position.native)).toBe('651920.0195');
    expect(toDbString(position.base)).toBe('651920.0195');
  });

  it('two identical reads produce byte-identical figures', async () => {
    await brokerageFixture({ price: '180' });
    const first = await market();
    const second = await market();
    expect(toDbString(second.netWorth)).toBe(toDbString(first.netWorth));
    expect(second.contributions.map((c) => `${c.keyId}=${toDbString(c.base)}`)).toEqual(
      first.contributions.map((c) => `${c.keyId}=${toDbString(c.base)}`),
    );
  });

  it('a series recomputed twice is identical point for point', async () => {
    const { instrumentId } = await brokerageFixture();
    const ctx = await refreshCtx(fixture);
    for (const [on, close] of [
      ['2026-06-30', '160'],
      ['2026-07-31', '170'],
      ['2026-08-14', '180'],
    ] as const) {
      await storeClose(ctx, { instrumentId, on, close });
    }

    const dates = [D('2026-06-30'), D('2026-07-31'), D('2026-08-14')];
    const ctx2 = await refreshCtx(fixture);
    const a = await netWorthSeries(ctx2, dates, { basis: 'market' });
    const b = await netWorthSeries(ctx2, dates, { basis: 'market' });
    expect(b.map((p) => toDbString(p.result.netWorth))).toEqual(
      a.map((p) => toDbString(p.result.netWorth)),
    );
    expect(a.map((p) => toDbString(p.result.netWorth))).toEqual([
      '104000.0000',
      '108000.0000',
      '112000.0000',
    ]);
  });

  it('netWorthReconciliation honours the requested basis', async () => {
    await brokerageFixture({ price: '180' });
    const ctx = await refreshCtx(fixture);
    const { result } = must(await netWorthReconciliation(ctx, { basis: 'market' }));
    expect(result.basis).toBe('market');
    expect(toDbString(result.netWorth)).toBe('112000.0000');
  });
});
