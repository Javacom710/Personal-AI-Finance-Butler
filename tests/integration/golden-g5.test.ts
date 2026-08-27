import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/date';
import { toDbString } from '@/lib/decimal/money';
import { rToDbString } from '@/lib/decimal/rate';
import { netWorthComparison } from '@/server/services';
import { closeHarness, truncateAll } from './harness';
import {
  closeMoneyHarness,
  makeAccount,
  must,
  refreshCtx,
  setupMoneyFixture,
  truncateMoney,
  type MoneyFixture,
} from './money-harness';
import { closeNetWorthHarness, makeAsset, makeLiability, truncateNetWorth } from './networth-harness';
import {
  makeInstrument,
  recordBuy,
  storeClose,
  truncateInvestments,
} from './investment-harness';

/**
 * **Golden scenario G5 — Sparse data and partial coverage** (TESTING.md §5, §6.7).
 *
 * Four holdings, two of them priceable; one of those two priced from a session
 * two weeks old; a manual asset held but not yet valued; a USD manual asset with
 * no exchange rate at all. Every figure was computed by hand once and frozen in
 * `tests/golden/g5-sparse-data.expected.json`.
 *
 * The assertions that earn the scenario its place:
 *
 * - **the market total is not the cost-substituted one.** ₹1,00,55,000 would be
 *   part market value and part acquisition cost — a figure in no basis at all,
 *   and precisely what ADR-23 forbids;
 * - **coverage is value-weighted for price exclusions and component-count for
 *   the rest** (D-29), and the two give visibly different answers here;
 * - **the restatement closes exactly** with the removed-unpriced line negative
 *   and labelled — not a loss (**I-48**, ADR-31);
 * - **nothing is silently zeroed.** Every exclusion is named, with its magnitude.
 */

const EXPECTED = JSON.parse(
  readFileSync(join(__dirname, '..', 'golden', 'g5-sparse-data.expected.json'), 'utf8'),
) as {
  asOf: string;
  cost: Record<string, string | number | string[]>;
  market: Record<string, string | number | string[]>;
  restatement: Record<string, string>;
};

const D = (s: string) => isoDate(s);
const AS_OF = D(EXPECTED.asOf);

let fixture: MoneyFixture;

beforeAll(async () => {
  await truncateAll();
  fixture = await setupMoneyFixture({ now: new Date('2026-08-14T18:00:00Z') });
  await truncateInvestments();
  await truncateNetWorth();
  await truncateMoney();

  const ctx = await refreshCtx(fixture);

  await makeAccount(ctx, {
    name: 'HDFC Savings',
    kind: 'bank',
    openingBalance: '500000',
    openingDate: '2026-01-01',
  });
  const zerodha = await makeAccount(ctx, {
    name: 'Zerodha',
    kind: 'brokerage',
    openingBalance: '2000000',
    openingDate: '2026-01-01',
  });

  const equityA = await makeInstrument(ctx, { symbol: 'EQ_A', exchange: 'NSE' });
  const equityB = await makeInstrument(ctx, { symbol: 'EQ_B', exchange: 'NSE' });
  const bond = await makeInstrument(ctx, {
    symbol: 'GSEC2032',
    exchange: 'NSE',
    assetClass: 'bond',
  });
  const fund = await makeInstrument(ctx, {
    symbol: 'PARAGFLEXI',
    exchange: '',
    assetClass: 'mutual_fund',
  });

  must(await recordBuy(ctx, { accountId: zerodha, instrumentId: equityA, on: '2026-02-02', qty: '400', price: '1000' }));
  must(await recordBuy(ctx, { accountId: zerodha, instrumentId: equityB, on: '2026-02-03', qty: '300', price: '1000' }));
  must(await recordBuy(ctx, { accountId: zerodha, instrumentId: bond, on: '2026-02-04', qty: '500', price: '1000' }));
  must(await recordBuy(ctx, { accountId: zerodha, instrumentId: fund, on: '2026-02-05', qty: '1000', price: '100' }));

  const priced = await refreshCtx(fixture);
  // EQ_A is priced on the latest session. EQ_B stops four sessions earlier and
  // more than ten calendar days back, so the backstop makes it `stale` — used,
  // and marked.
  await storeClose(priced, { instrumentId: equityA, on: '2026-08-14', close: '1100' });
  for (const on of ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30']) {
    await storeClose(priced, { instrumentId: equityB, on, close: '1050' });
  }
  // The bond and the mutual fund are never priced: `unsupported_asset` needs an
  // adapter to have refused them, and here no adapter has produced anything at
  // all — which is `no_provider`, the reason that tells the user to act.

  await makeAsset(priced, {
    name: 'Flat',
    kind: 'property',
    value: '8000000',
    valuedOn: '2026-03-01',
    acquiredOn: '2026-03-01',
  });
  // Held from January, first valued in September: ELIGIBLE but unvalued at
  // `asOf`, so excluded and named — never zero (D-32).
  await makeAsset(priced, {
    name: 'Sculpture',
    kind: 'collectible',
    value: '500000',
    acquiredOn: '2026-01-15',
    valuedOn: '2026-09-01',
  });
  // A USD asset with no USD→INR rate anywhere: excluded for `no_fx_rate` on
  // BOTH bases, because a missing rate is not a market-data problem.
  await makeAsset(priced, {
    name: 'Florida condo',
    kind: 'property',
    currencyCode: 'USD',
    value: '100000',
    valuedOn: '2026-03-01',
    acquiredOn: '2026-03-01',
  });

  await makeLiability(priced, {
    name: 'Home loan',
    openingBalance: '2500000',
    openingBalanceOn: '2026-01-01',
  });
});

afterAll(async () => {
  await closeNetWorthHarness();
  await closeMoneyHarness();
  await closeHarness();
});

async function computed() {
  const ctx = await refreshCtx(fixture);
  return must(await netWorthComparison(ctx, { asOf: AS_OF }));
}

describe('G5 — Net Worth at Cost is unaffected by sparse market data', () => {
  it('matches the frozen cost figures', async () => {
    const { cost } = await computed();
    expect(toDbString(cost.assets)).toBe(EXPECTED.cost['assets']);
    expect(toDbString(cost.liabilities)).toBe(EXPECTED.cost['liabilities']);
    expect(toDbString(cost.netWorth)).toBe(EXPECTED.cost['netWorth']);
  });

  it('reports component-count coverage, and no market valuation at all', async () => {
    const { cost } = await computed();
    expect(rToDbString(cost.assetCoverage)).toBe(EXPECTED.cost['assetCoverage']);
    expect(rToDbString(cost.liabilityCoverage)).toBe(EXPECTED.cost['liabilityCoverage']);
    expect(cost.market).toBeNull();
  });

  it('excludes exactly the two basis-independent components, named', async () => {
    const { cost } = await computed();
    expect(cost.excluded).toHaveLength(EXPECTED.cost['excludedCount'] as number);
    expect(cost.excluded.map((e) => e.reason).sort()).toEqual(EXPECTED.cost['excludedReasons']);
  });
});

describe('G5 — Net Worth at Market Value is partial, and says so', () => {
  it('matches the frozen market figures', async () => {
    const { market } = await computed();
    expect(toDbString(market.assets)).toBe(EXPECTED.market['assets']);
    expect(toDbString(market.netWorth)).toBe(EXPECTED.market['netWorth']);
  });

  it('is NOT the cost-substituted total', async () => {
    const { market } = await computed();
    // ₹1,00,55,000 = the market figure plus the unpriced holdings' cost. It is
    // the number a "fill the gap with cost" fallback would produce, and it is
    // in no basis at all (I-39).
    expect(toDbString(market.netWorth)).not.toBe('10055000.0000');
  });

  it('reports status partial with the excluded cost beside the ratio', async () => {
    const { market } = await computed();
    expect(market.market!.status).toBe(EXPECTED.market['status']);
    expect(rToDbString(market.market!.investmentCoverage)).toBe(
      EXPECTED.market['investmentCoverage'],
    );
    expect(toDbString(market.market!.excludedInvestmentCost)).toBe(
      EXPECTED.market['excludedInvestmentCost'],
    );
  });

  it('keeps component-count coverage for the non-investment exclusions (D-29)', async () => {
    const { market } = await computed();
    expect(rToDbString(market.assetCoverage)).toBe(EXPECTED.market['assetCoverage']);
    // The two measures disagree, which is the whole reason for the distinction:
    // 55.6% of components against 53.8% of investment cost.
    expect(rToDbString(market.assetCoverage)).not.toBe(
      rToDbString(market.market!.investmentCoverage),
    );
  });

  it('names every exclusion with a machine-readable reason (I-45)', async () => {
    const { market } = await computed();
    expect(market.excluded).toHaveLength(EXPECTED.market['excludedCount'] as number);
    expect(market.excluded.map((e) => e.reason).sort()).toEqual(EXPECTED.market['excludedReasons']);
    // Nothing silently zeroed: every exclusion carries the magnitude left out.
    for (const excluded of market.excluded) {
      if (excluded.reason === 'unvalued') continue; // there is no figure to carry
      expect(excluded.native.minor).toBeGreaterThan(0n);
    }
  });

  it('uses the stale price and reports it, rather than withholding the figure (I-44)', async () => {
    const { market } = await computed();
    expect(market.market!.staleness.count).toBe(EXPECTED.market['stalenessCount']);
    expect(market.market!.staleness.oldestTradingDate).toBe(
      EXPECTED.market['oldestStaleTradingDate'],
    );
    const stale = market.contributions.find((c) => c.price?.freshness === 'stale');
    expect(stale).toBeDefined();
    expect(toDbString(stale!.base)).toBe('315000.0000');
  });
});

describe('G5 — the restatement closes exactly (I-48)', () => {
  it('decomposes into removed, currency and price with no residual', async () => {
    const { restatement } = await computed();
    const line = (key: string) => toDbString(restatement.lines.find((l) => l.key === key)!.amount);

    expect(toDbString(restatement.cost)).toBe(EXPECTED.restatement['cost']);
    expect(toDbString(restatement.market)).toBe(EXPECTED.restatement['market']);
    expect(toDbString(restatement.difference)).toBe(EXPECTED.restatement['difference']);
    expect(line('removed_unpriced')).toBe(EXPECTED.restatement['removedUnpriced']);
    expect(line('fx_rebasis')).toBe(EXPECTED.restatement['fxRebasis']);
    expect(line('price_effect')).toBe(EXPECTED.restatement['priceEffect']);
    expect(toDbString(restatement.residual)).toBe(EXPECTED.restatement['residual']);
    expect(restatement.closes).toBe(true);
  });

  it('names the holdings the comparison had to set aside', async () => {
    const { restatement } = await computed();
    // Two positions, so the −₹6,00,000 line has referents rather than being an
    // anonymous negative a reader could take for a loss (ADR-31).
    expect(restatement.unpricedKeys).toHaveLength(2);
  });

  it('has no manual-asset and no liability term', async () => {
    const { cost, market } = await computed();
    // Both bases see the same flat, the same unvalued sculpture, the same
    // unconvertible condo and the same loan. A restatement line for any of them
    // would mean something is wrong.
    expect(toDbString(market.liabilities)).toBe(toDbString(cost.liabilities));
  });

  it('reconciles by a second independent path (I-22)', async () => {
    const { reconciliation } = await computed();
    expect(reconciliation.balances).toBe(true);
    expect(toDbString(reconciliation.residual)).toBe('0.0000');
  });
});
