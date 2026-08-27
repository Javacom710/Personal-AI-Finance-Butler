import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/date';
import { toDbString } from '@/lib/decimal/money';
import { rToDbString } from '@/lib/decimal/rate';
import { netWorthComparison } from '@/server/services';
import { closeHarness, truncateAll } from './harness';
import {
  addFxRate,
  closeMoneyHarness,
  makeAccount,
  must,
  refreshCtx,
  setupMoneyFixture,
  truncateMoney,
  type MoneyFixture,
} from './money-harness';
import { closeNetWorthHarness, truncateNetWorth } from './networth-harness';
import { makeInstrument, recordBuy, storeClose, truncateInvestments } from './investment-harness';

/**
 * **Golden scenario G6 — Market value with a foreign holding** (TESTING.md §6.7).
 *
 * A USD ETF bought at ₹75 to the dollar and valued at ₹83, alongside an INR
 * equity. Every figure was computed by hand once and frozen in
 * `tests/golden/g6-market-foreign-holding.expected.json`.
 *
 * The scenario exists for one fact that is easy to state and easy to forget:
 *
 * > **The basis switch moves net worth for FX reasons alone, independently of
 * > any price** ([FINANCIAL-DOMAIN.md §9.3](../../docs/FINANCIAL-DOMAIN.md#93-calculation),
 * > ADR-23's release note).
 *
 * `tax_lots.fx_rate_to_base` is fixed at acquisition and never revalued, so the
 * cost figure carries ₹75 for ever; the market figure converts at the dated
 * rate. The 3 August point isolates that exactly: VOO closes at the price it was
 * bought at, and the **entire** ₹3,20,000 difference is currency.
 *
 * Because the data is multi-currency, this is also where the restatement's
 * exactness is worth checking rather than assumed: the two middle terms
 * telescope through `costAtSpot`, so the identity closes to the minor unit even
 * though no FX term is identically zero (**I-48**).
 */

const EXPECTED = JSON.parse(
  readFileSync(join(__dirname, '..', 'golden', 'g6-market-foreign-holding.expected.json'), 'utf8'),
) as {
  costAtAugust14: Record<string, string>;
  marketAtAugust3: Record<string, string>;
  marketAtAugust14: Record<string, string>;
  restatementAtAugust14: Record<string, string>;
};

const D = (s: string) => isoDate(s);

let fixture: MoneyFixture;

beforeAll(async () => {
  await truncateAll();
  fixture = await setupMoneyFixture({ now: new Date('2026-08-14T18:00:00Z') });
  await truncateInvestments();
  await truncateNetWorth();
  await truncateMoney();

  // Two observations, eight rupees apart. The lot will capitalise the first and
  // keep it for ever; every market valuation converts at whichever is in force.
  await addFxRate('USD', 'INR', '2026-02-01', '75.0000000000');
  await addFxRate('USD', 'INR', '2026-08-01', '83.0000000000');

  const ctx = await refreshCtx(fixture);

  await makeAccount(ctx, {
    name: 'HDFC Savings',
    kind: 'bank',
    openingBalance: '200000',
    openingDate: '2026-01-01',
  });
  const zerodha = await makeAccount(ctx, {
    name: 'Zerodha',
    kind: 'brokerage',
    openingBalance: '1000000',
    openingDate: '2026-01-01',
  });
  const ibkr = await makeAccount(ctx, {
    name: 'IBKR',
    kind: 'brokerage',
    currencyCode: 'USD',
    openingBalance: '50000',
    openingDate: '2026-01-01',
  });

  const voo = await makeInstrument(ctx, {
    symbol: 'VOO',
    exchange: 'NYSE',
    assetClass: 'etf',
    currencyCode: 'USD',
    country: 'US',
  });
  const infy = await makeInstrument(ctx, { symbol: 'INFY', exchange: 'NSE' });

  must(await recordBuy(ctx, { accountId: ibkr, instrumentId: voo, on: '2026-02-02', qty: '100', price: '400' }));
  must(await recordBuy(ctx, { accountId: zerodha, instrumentId: infy, on: '2026-02-03', qty: '400', price: '1500' }));

  const priced = await refreshCtx(fixture);
  await storeClose(priced, { instrumentId: voo, on: '2026-08-03', close: '400', currencyCode: 'USD' });
  await storeClose(priced, { instrumentId: voo, on: '2026-08-14', close: '450', currencyCode: 'USD' });
  await storeClose(priced, { instrumentId: infy, on: '2026-08-03', close: '1500' });
  await storeClose(priced, { instrumentId: infy, on: '2026-08-14', close: '1700' });
});

afterAll(async () => {
  await closeNetWorthHarness();
  await closeMoneyHarness();
  await closeHarness();
});

async function computed(asOf: string) {
  const ctx = await refreshCtx(fixture);
  return must(await netWorthComparison(ctx, { asOf: D(asOf) }));
}

describe('G6 — the cost figure carries the acquisition rate for ever', () => {
  it('matches the frozen cost figures', async () => {
    const { cost } = await computed('2026-08-14');
    expect(toDbString(cost.assets)).toBe(EXPECTED.costAtAugust14['assets']);
    expect(toDbString(cost.liabilities)).toBe(EXPECTED.costAtAugust14['liabilities']);
    expect(toDbString(cost.netWorth)).toBe(EXPECTED.costAtAugust14['netWorth']);
  });

  it('values the USD position at ₹75, not at today’s ₹83', async () => {
    const { cost } = await computed('2026-08-14');
    const position = cost.contributions.find(
      (c) => c.key.t === 'position' && c.sourceCurrency === 'USD',
    )!;
    // $40,000 × 75. Re-rating it would make last year's cost basis move every
    // morning, which is exactly what INVESTMENT-DOMAIN.md §6.4 forbids.
    expect(toDbString(position.base)).toBe('3000000.0000');
  });

  it('converts the USD cash balance at the dated rate, on both bases', async () => {
    const { cost, market } = await computed('2026-08-14');
    const inCost = cost.contributions.find((c) => c.label === 'IBKR')!;
    const inMarket = market.contributions.find((c) => c.label === 'IBKR')!;
    // A balance is a recorded fact, not a price: identical under both bases.
    expect(toDbString(inCost.base)).toBe('830000.0000');
    expect(toDbString(inMarket.base)).toBe(toDbString(inCost.base));
  });
});

describe('G6 — the basis switch moves net worth for FX reasons alone', () => {
  it('at a date where the price has not moved, the whole difference is currency', async () => {
    const { market, restatement } = await computed('2026-08-03');
    const line = (key: string) => toDbString(restatement.lines.find((l) => l.key === key)!.amount);

    expect(toDbString(market.netWorth)).toBe(EXPECTED.marketAtAugust3['netWorth']);
    expect(toDbString(restatement.difference)).toBe(EXPECTED.marketAtAugust3['difference']);
    expect(line('price_effect')).toBe(EXPECTED.marketAtAugust3['priceEffect']);
    expect(line('fx_rebasis')).toBe(EXPECTED.marketAtAugust3['fxRebasis']);
    expect(line('removed_unpriced')).toBe(EXPECTED.marketAtAugust3['removedUnpriced']);
    expect(toDbString(restatement.residual)).toBe(EXPECTED.marketAtAugust3['residual']);
  });
});

describe('G6 — market value at the latest session', () => {
  it('matches the frozen market figures and is complete', async () => {
    const { market } = await computed('2026-08-14');
    expect(toDbString(market.assets)).toBe(EXPECTED.marketAtAugust14['assets']);
    expect(toDbString(market.netWorth)).toBe(EXPECTED.marketAtAugust14['netWorth']);
    expect(market.market!.status).toBe(EXPECTED.marketAtAugust14['status']);
    expect(rToDbString(market.market!.investmentCoverage)).toBe(
      EXPECTED.marketAtAugust14['investmentCoverage'],
    );
    expect(toDbString(market.market!.excludedInvestmentCost)).toBe(
      EXPECTED.marketAtAugust14['excludedInvestmentCost'],
    );
    expect(market.excluded).toHaveLength(0);
  });

  it('carries the native amount, the rate and the rate’s date on the contribution', async () => {
    const { market } = await computed('2026-08-14');
    const position = market.contributions.find(
      (c) => c.key.t === 'position' && c.sourceCurrency === 'USD',
    )!;
    expect(toDbString(position.native)).toBe('45000.0000');
    expect(position.nativeCurrency).toBe('USD');
    expect(rToDbString(position.rate)).toBe('83.0000000000');
    expect(position.rateAsOf).toBe('2026-08-01');
    expect(toDbString(position.base)).toBe('3735000.0000');
  });

  it('rounds exactly twice per position — once at valueOf, once at mulRate (I-49)', async () => {
    const { market } = await computed('2026-08-14');
    const position = market.contributions.find(
      (c) => c.key.t === 'position' && c.sourceCurrency === 'USD',
    )!;
    // 100 × $450.00000000 → $45,000.0000, then × 83 → ₹37,35,000.0000. The
    // aggregation then adds already-rounded bigints and never rounds again,
    // which is what keeps assets − liabilities = Σ map exact (I-22).
    expect(position.price!.quantity.units).toBe(10_000_000_000n);
    expect(position.price!.unitPrice.units).toBe(45_000_000_000n);
  });
});

describe('G6 — the restatement closes exactly, in multi-currency data (I-48)', () => {
  it('splits the difference into currency and price, neither a residual', async () => {
    const { restatement } = await computed('2026-08-14');
    const line = (key: string) => toDbString(restatement.lines.find((l) => l.key === key)!.amount);

    expect(toDbString(restatement.cost)).toBe(EXPECTED.restatementAtAugust14['cost']);
    expect(toDbString(restatement.market)).toBe(EXPECTED.restatementAtAugust14['market']);
    expect(toDbString(restatement.difference)).toBe(EXPECTED.restatementAtAugust14['difference']);
    expect(line('removed_unpriced')).toBe(EXPECTED.restatementAtAugust14['removedUnpriced']);
    expect(line('fx_rebasis')).toBe(EXPECTED.restatementAtAugust14['fxRebasis']);
    expect(line('price_effect')).toBe(EXPECTED.restatementAtAugust14['priceEffect']);
    expect(toDbString(restatement.residual)).toBe(EXPECTED.restatementAtAugust14['residual']);
    expect(restatement.closes).toBe(true);
  });

  it('the currency term is the same at both dates — the price term is not', async () => {
    const third = await computed('2026-08-03');
    const fourteenth = await computed('2026-08-14');
    const fx = (r: typeof third.restatement) =>
      toDbString(r.lines.find((l) => l.key === 'fx_rebasis')!.amount);

    // The rebasis depends on the cost and the rate, and neither moved between
    // the two dates. Only the price did.
    expect(fx(fourteenth.restatement)).toBe(fx(third.restatement));
    expect(toDbString(third.restatement.difference)).not.toBe(
      toDbString(fourteenth.restatement.difference),
    );
  });

  it('reconciles by a second independent path (I-22)', async () => {
    const { reconciliation } = await computed('2026-08-14');
    expect(reconciliation.balances).toBe(true);
    expect(toDbString(reconciliation.residual)).toBe('0.0000');
  });
});
