/**
 * Valuation, allocation and the portfolio summary — including golden **L1**,
 * the fee double-count case
 * ([INVESTMENT-DOMAIN.md §6.3](../../docs/INVESTMENT-DOMAIN.md#63-worked-verification-that-nothing-is-counted-twice)).
 *
 * L1 asserts `totalReturn = ₹5,970` **twice, by two independent routes** — the
 * component sum and the cash cross-check. A component-sum error then shows up
 * as a disagreement rather than as a plausible number.
 */

import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/date';
import { Money, currency, toDbString } from '@/lib/decimal/money';
import { Quantity } from '@/lib/decimal/quantity';
import { Rate, rToDbString, rToNumber } from '@/lib/decimal/rate';
import { ratio } from '@/server/domain/calc/ratio';
import { UnitPrice, pToDbString } from '@/lib/decimal/price';
import { replay } from '@/server/domain/lots/engine';
import { classifyQuote, missing, type PriceResult } from '@/server/domain/pricing/price-result';
import {
  valueHolding,
  valuePortfolio,
  type HoldingInput,
  type InstrumentRef,
} from '@/server/domain/pricing/valuation';
import { allocation, allocationTotal, concentration } from '@/server/domain/pricing/allocation';
import { portfolioSummary, totalReturnByCashCrossCheck } from '@/server/domain/calc/portfolio';
import { unavailable } from '@/lib/metric';
import { FIFO_INR, INR, buy, dividend, resetSequence, sell } from './_lot-fixtures';

const money = (m: Money | null): string | null => (m === null ? null : toDbString(m));

const instrument = (over: Partial<InstrumentRef> = {}): InstrumentRef => ({
  id: 'inst-1',
  symbol: 'RELIANCE',
  name: 'Reliance Industries',
  exchange: 'NSE',
  assetClass: 'equity',
  currency: INR,
  country: 'IN',
  ...over,
});

const priced = (value: string): PriceResult => ({
  status: 'cached',
  price: UnitPrice.of(value),
  currency: INR,
  asOf: new Date('2026-08-11T00:00:00Z'),
  source: 'manual',
  ageHours: 2,
  freshness: 'current',
  sessionsBehind: 0,
});

function holding(over: Partial<HoldingInput> = {}): HoldingInput {
  return {
    accountId: 'acct-1',
    accountName: 'Zerodha',
    instrument: instrument(),
    quantity: Quantity.of('60'),
    invested: Money.of('6030', INR),
    baseInvested: Money.of('6030', INR),
    realizedPnl: Money.of('1950', INR),
    incomeTotal: Money.of('500', INR),
    feesTotal: Money.zero(INR),
    taxesTotal: Money.of('50', INR),
    price: priced('160'),
    fxToBase: Rate.one(),
    ...over,
  };
}

// ---------------------------------------------------------------------------
// L1 — nothing is counted twice
// ---------------------------------------------------------------------------

describe('L1 — the fee double-count case', () => {
  resetSequence();
  const engine = replay(
    [
      buy({ on: '2026-01-01', qty: '100', price: '100', fees: '50' }),
      dividend({ on: '2026-04-01', gross: '500', taxes: '50' }),
      sell({ on: '2026-06-01', qty: '40', price: '150', fees: '30' }),
    ],
    FIFO_INR,
  );
  if (!engine.ok) throw new Error('L1 fixture failed to replay');
  const { lots, totals } = engine.value;

  it('produces the documented engine figures', () => {
    expect(money(lots[0]!.costTotal)).toBe('10050.0000');
    expect(money(totals.costBasis)).toBe('6030.0000');
    expect(money(totals.realizedPnl)).toBe('1950.0000');
    expect(money(totals.incomeTotal)).toBe('500.0000');
    expect(money(totals.taxesTotal)).toBe('50.0000');
    // The ₹50 buy fee lives only in cost_total; the ₹30 sale fee only in
    // realised P&L. Neither reaches fees_total.
    expect(money(totals.feesTotal)).toBe('0.0000');
  });

  const view = valueHolding(
    holding({
      quantity: totals.quantity,
      invested: totals.costBasis,
      baseInvested: totals.costBasis,
      realizedPnl: totals.realizedPnl,
      incomeTotal: totals.incomeTotal,
      feesTotal: totals.feesTotal,
      taxesTotal: totals.taxesTotal,
      price: priced('160'),
    }),
    { baseCurrency: INR },
  );

  it('values the remainder at ₹9,600 with ₹3,570 unrealised', () => {
    expect(money(view.marketValue)).toBe('9600.0000');
    expect(money(view.unrealizedPnl)).toBe('3570.0000');
    expect(pToDbString(view.avgCost!)).toBe('100.50000000');
  });

  const summary = portfolioSummary({
    baseCurrency: INR,
    asOf: isoDate('2026-08-11'),
    investedCapital: totals.costBasis, // ₹6,030 — capital currently at risk
    costDeployed: Money.of('10050', INR), // Σ cost_total — capital ever committed
    marketValue: view.baseMarketValue!,
    realizedPnl: totals.realizedPnl,
    dividends: totals.incomeTotal,
    interest: Money.zero(INR),
    fees: totals.feesTotal,
    taxes: totals.taxesTotal,
    coverage: Rate.one(),
    staleInstruments: [],
    unpricedInstruments: [],
    xirr: unavailable('no_data'),
    twr: unavailable('insufficient_price_history'),
  });

  it('reports totalReturn = ₹5,970 by the component sum', () => {
    // 3,570 + 1,950 + 500 − 0 − 50
    expect(money(summary.totalReturn)).toBe('5970.0000');
  });

  it('agrees exactly with the cash cross-check, computed a second way', () => {
    const crossCheck = totalReturnByCashCrossCheck({
      marketValue: Money.of('9600', INR),
      cashIn: [Money.of('450', INR), Money.of('5970', INR)], // dividend net, sale net
      cashOut: [Money.of('10050', INR)], // the purchase
      baseCurrency: INR,
    });
    expect(money(crossCheck)).toBe('5970.0000');
    expect(money(crossCheck)).toBe(money(summary.totalReturn));
  });

  it('would report ₹5,890 — wrong by ₹80 — if trade fees also reached fees_total', () => {
    const doubleCounted = portfolioSummary({
      baseCurrency: INR,
      asOf: isoDate('2026-08-11'),
      investedCapital: totals.costBasis,
      costDeployed: Money.of('10050', INR),
      marketValue: Money.of('9600', INR),
      realizedPnl: totals.realizedPnl,
      dividends: totals.incomeTotal,
      interest: Money.zero(INR),
      fees: Money.of('80', INR), // ₹50 buy fee + ₹30 sale fee, wrongly accrued
      taxes: totals.taxesTotal,
      coverage: Rate.one(),
      staleInstruments: [],
      unpricedInstruments: [],
      xirr: unavailable('no_data'),
      twr: unavailable('no_data'),
    });
    expect(money(doubleCounted.totalReturn)).toBe('5890.0000');
    expect(money(doubleCounted.totalReturn)).not.toBe(money(summary.totalReturn));
  });

  it('uses costDeployed for total return and investedCapital for unrealised', () => {
    // Asserted at full RATE_SCALE rather than as a float, so the figures are
    // pinned exactly: 5,970 / 10,050 = 59.40% and 3,570 / 6,030 = 59.20%.
    expect(rToDbString(summary.totalReturnPct.value!)).toBe('0.5940298507');
    expect(rToDbString(summary.unrealizedReturnPct.value!)).toBe('0.5920398010');
  });

  it('would report 99.00% if one denominator were used for both', () => {
    // 5,970 / 6,030 — a numerator spanning 100 units over a denominator
    // spanning 60. This is the default mistake.
    const wrong = ratio(Money.of('5970', INR), Money.of('6030', INR));
    expect(rToDbString(wrong.value!)).toBe('0.9900497512');
    expect(rToDbString(summary.totalReturnPct.value!)).not.toBe(rToDbString(wrong.value!));
  });
});

// ---------------------------------------------------------------------------
// 10, 11, 18 — prices and their absence
// ---------------------------------------------------------------------------

describe('case 10 — an instrument with no price at all', () => {
  const result = valuePortfolio(
    [
      holding({ price: priced('160') }),
      holding({
        accountId: 'acct-2',
        instrument: instrument({ id: 'inst-2', symbol: 'INFY' }),
        invested: Money.of('4000', INR),
        baseInvested: Money.of('4000', INR),
        price: missing('no_provider'),
      }),
    ],
    { baseCurrency: INR },
  );

  it('excludes it from totals rather than valuing it at zero', () => {
    expect(money(result.pricedValue)).toBe('9600.0000');
    expect(result.unpricedCount).toBe(1);
    expect(result.unpriced.map((i) => i.symbol)).toEqual(['INFY']);
  });

  it('reports coverage below 1', () => {
    // 6,030 priced of 10,030 total cost.
    expect(rToNumber(result.coverage)).toBeCloseTo(6030 / 10030, 6);
    expect(rToNumber(result.coverage)).toBeLessThan(1);
  });

  it('gives the unpriced holding a null market value with reason no_price', () => {
    const unpriced = result.holdings.find((h) => h.instrument.symbol === 'INFY')!;
    expect(unpriced.marketValue).toBeNull();
    expect(unpriced.unrealizedPnl).toBeNull();
    expect(unpriced.returnPct.value).toBeNull();
    expect(unpriced.returnPct.reason).toBe('no_price');
    expect(unpriced.excludedReason).toBe('no_price');
  });

  it('leaves realised P&L intact — it never depended on market data', () => {
    const unpriced = result.holdings.find((h) => h.instrument.symbol === 'INFY')!;
    expect(money(unpriced.realizedPnl)).toBe('1950.0000');
  });

  it('reports null unrealised P&L for a portfolio where nothing could be priced', () => {
    const nothing = portfolioSummary({
      baseCurrency: INR,
      asOf: isoDate('2026-08-11'),
      investedCapital: Money.of('10030', INR),
      costDeployed: Money.of('10030', INR),
      marketValue: Money.zero(INR),
      realizedPnl: Money.zero(INR),
      dividends: Money.zero(INR),
      interest: Money.zero(INR),
      fees: Money.zero(INR),
      taxes: Money.zero(INR),
      coverage: Rate.of('0'),
      staleInstruments: [],
      unpricedInstruments: [instrument()],
      xirr: unavailable('no_data'),
      twr: unavailable('insufficient_price_history'),
    });
    // Not ₹0 — that would say the portfolio is worth nothing.
    expect(nothing.unrealizedPnl).toBeNull();
    expect(nothing.totalReturn).toBeNull();
    expect(nothing.unrealizedReturnPct.reason).toBe('no_price');
    expect(nothing.totalReturnPct.reason).toBe('no_price');
  });
});

describe('case 11 — a stale price is used, and visibly marked', () => {
  const asOf = new Date('2026-08-09T00:00:00Z');
  const now = new Date('2026-08-11T00:00:00Z'); // 48 hours later

  it('classifies past the staleness boundary', () => {
    const stale = classifyQuote({
      price: UnitPrice.of('160'),
      currency: INR,
      instrumentCurrency: INR,
      asOf,
      source: 'manual',
      now,
      staleAfterHours: 24,
    });
    expect(stale.status).toBe('stale');
    if (stale.status === 'stale') expect(stale.ageHours).toBe(48);
  });

  it('stays cached inside the boundary, and flips exactly at it', () => {
    const classify = (staleAfterHours: number) =>
      classifyQuote({
        price: UnitPrice.of('160'),
        currency: INR,
        instrumentCurrency: INR,
        asOf,
        source: 'manual',
        now,
        staleAfterHours,
      }).status;
    expect(classify(48)).toBe('cached'); // exactly at the boundary is not yet stale
    expect(classify(47)).toBe('stale');
  });

  it('still values the holding, and names it as stale', () => {
    const staleQuote = classifyQuote({
      price: UnitPrice.of('160'),
      currency: INR,
      instrumentCurrency: INR,
      asOf,
      source: 'manual',
      now,
      staleAfterHours: 24,
    });
    const result = valuePortfolio([holding({ price: staleQuote })], { baseCurrency: INR });
    expect(money(result.pricedValue)).toBe('9600.0000');
    expect(result.stale.map((i) => i.symbol)).toEqual(['RELIANCE']);
    expect(rToNumber(result.coverage)).toBe(1);
  });

  it('treats a price in the wrong currency as a provider error, never a conversion', () => {
    const wrongCurrency = classifyQuote({
      price: UnitPrice.of('160'),
      currency: currency('USD'),
      instrumentCurrency: INR,
      asOf,
      source: 'provider',
      now,
      staleAfterHours: 24,
    });
    expect(wrongCurrency.status).toBe('missing');
    if (wrongCurrency.status === 'missing') expect(wrongCurrency.reason).toBe('provider_error');
  });
});

describe('case 18 — a position sold down to zero', () => {
  const closed = holding({
    quantity: Quantity.zero(),
    invested: Money.zero(INR),
    baseInvested: Money.zero(INR),
    realizedPnl: Money.of('2000', INR),
  });

  it('is excluded from the holdings display by default', () => {
    const result = valuePortfolio([holding(), closed], { baseCurrency: INR });
    expect(result.holdings).toHaveLength(1);
  });

  it('is retained when asked for, with no derivable average cost', () => {
    const result = valuePortfolio([closed], { baseCurrency: INR, includeClosed: true });
    expect(result.holdings).toHaveLength(1);
    expect(result.holdings[0]!.avgCost).toBeNull();
    expect(money(result.holdings[0]!.realizedPnl)).toBe('2000.0000');
  });

  it('appears in no allocation slice', () => {
    const result = valuePortfolio([holding(), closed], {
      baseCurrency: INR,
      includeClosed: true,
    });
    const byInstrument = allocation(result.holdings, 'instrument', INR);
    expect(byInstrument.slices).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// allocation and concentration
// ---------------------------------------------------------------------------

describe('allocation', () => {
  const portfolio = valuePortfolio(
    [
      holding({
        instrument: instrument({ id: 'i1', symbol: 'RELIANCE', assetClass: 'equity' }),
        quantity: Quantity.of('100'),
        invested: Money.of('5000', INR),
        baseInvested: Money.of('5000', INR),
        price: priced('58'),
      }),
      holding({
        accountId: 'acct-2',
        accountName: 'Groww',
        instrument: instrument({ id: 'i2', symbol: 'PPFAS', assetClass: 'mutual_fund' }),
        quantity: Quantity.of('100'),
        invested: Money.of('2000', INR),
        baseInvested: Money.of('2000', INR),
        price: priced('31'),
      }),
      holding({
        instrument: instrument({ id: 'i3', symbol: 'GOLDBEES', assetClass: 'gold' }),
        quantity: Quantity.of('100'),
        invested: Money.of('1000', INR),
        baseInvested: Money.of('1000', INR),
        price: priced('11'),
      }),
    ],
    { baseCurrency: INR },
  );

  it('groups by asset class, largest first', () => {
    const byClass = allocation(portfolio.holdings, 'asset_class', INR);
    expect(byClass.slices.map((s) => s.key)).toEqual(['equity', 'mutual_fund', 'gold']);
    expect(money(byClass.slices[0]!.marketValue)).toBe('5800.0000');
    expect(money(byClass.total)).toBe('10000.0000');
  });

  it('produces weights that sum to 1', () => {
    const byClass = allocation(portfolio.holdings, 'asset_class', INR);
    const total = byClass.slices.reduce((acc, s) => acc + (s.weightPct.value?.value ?? 0n), 0n);
    expect(total).toBe(Rate.one().value);
    expect(rToNumber(byClass.slices[0]!.weightPct.value!)).toBeCloseTo(0.58, 6);
  });

  it('slices sum back to the total', () => {
    const byClass = allocation(portfolio.holdings, 'asset_class', INR);
    expect(money(allocationTotal(byClass))).toBe(money(byClass.total));
  });

  it('groups by account, instrument, currency and country', () => {
    expect(allocation(portfolio.holdings, 'account', INR).slices.map((s) => s.label).sort()).toEqual([
      'Groww',
      'Zerodha',
    ]);
    expect(allocation(portfolio.holdings, 'instrument', INR).slices).toHaveLength(3);
    expect(allocation(portfolio.holdings, 'currency', INR).slices.map((s) => s.key)).toEqual(['INR']);
    expect(allocation(portfolio.holdings, 'country', INR).slices.map((s) => s.key)).toEqual(['IN']);
  });

  it('labels an unknown country rather than dropping the holding', () => {
    const withUnknown = valuePortfolio(
      [holding({ instrument: instrument({ country: null }), price: priced('100') })],
      { baseCurrency: INR },
    );
    const byCountry = allocation(withUnknown.holdings, 'country', INR);
    expect(byCountry.slices[0]!.label).toBe('Unknown');
  });

  it('reports unpriced cost separately rather than folding it into a slice', () => {
    const mixed = valuePortfolio(
      [
        holding({ price: priced('160') }),
        holding({
          instrument: instrument({ id: 'i9', symbol: 'ILLIQUID' }),
          invested: Money.of('4000', INR),
          baseInvested: Money.of('4000', INR),
          price: missing('not_found'),
        }),
      ],
      { baseCurrency: INR },
    );
    const byClass = allocation(mixed.holdings, 'asset_class', INR);
    expect(money(byClass.unpricedValue)).toBe('4000.0000');
    expect(byClass.unpricedCount).toBe(1);
    expect(money(byClass.total)).toBe('9600.0000');
  });
});

describe('concentration', () => {
  it('measures a diversified portfolio', () => {
    const portfolio = valuePortfolio(
      ['40', '30', '20', '10'].map((weight, index) =>
        holding({
          instrument: instrument({ id: `i${index}`, symbol: `S${index}` }),
          quantity: Quantity.of('1'),
          invested: Money.of(weight, INR),
          baseInvested: Money.of(weight, INR),
          price: priced(weight),
        }),
      ),
      { baseCurrency: INR },
    );
    const c = concentration(allocation(portfolio.holdings, 'instrument', INR));
    expect(rToNumber(c.top1.value!)).toBeCloseTo(0.4, 6);
    expect(rToNumber(c.top3.value!)).toBeCloseTo(0.9, 6);
    expect(rToNumber(c.top5.value!)).toBeCloseTo(1, 6);
    expect(c.above10Pct).toBe(3); // 40%, 30%, 20% — 10% is not ABOVE 10%
    // HHI = 0.16 + 0.09 + 0.04 + 0.01 = 0.30
    expect(rToNumber(c.hhi.value!)).toBeCloseTo(0.3, 6);
    expect(c.holdingCount).toBe(4);
  });

  it('reports a single holding as fully concentrated', () => {
    const portfolio = valuePortfolio([holding()], { baseCurrency: INR });
    const c = concentration(allocation(portfolio.holdings, 'instrument', INR));
    expect(rToNumber(c.top1.value!)).toBe(1);
    expect(rToNumber(c.hhi.value!)).toBe(1);
  });

  it('returns null with a reason on an empty portfolio, never zero', () => {
    const c = concentration(allocation([], 'instrument', INR));
    expect(c.top1.value).toBeNull();
    expect(c.top1.reason).toBe('no_data');
    expect(c.hhi.value).toBeNull();
    expect(c.holdingCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// foreign currency at the portfolio level
// ---------------------------------------------------------------------------

describe('a foreign-currency holding', () => {
  const USD = currency('USD');

  it('keeps per-holding figures in the instrument currency and totals in base', () => {
    const view = valueHolding(
      holding({
        instrument: instrument({ id: 'voo', symbol: 'VOO', currency: USD }),
        quantity: Quantity.of('10'),
        invested: Money.of('4000', USD), // $4,000 at acquisition rates
        baseInvested: Money.of('320000', INR), // ₹3.2 lakh, per lot
        realizedPnl: Money.zero(USD),
        incomeTotal: Money.zero(USD),
        feesTotal: Money.zero(USD),
        taxesTotal: Money.zero(USD),
        price: {
          status: 'cached',
          price: UnitPrice.of('500'),
          currency: USD,
          asOf: new Date('2026-08-11T00:00:00Z'),
          source: 'manual',
          ageHours: 2,
          freshness: 'current',
          sessionsBehind: 0,
        },
        fxToBase: Rate.of('85'),
      }),
      { baseCurrency: INR },
    );

    expect(view.marketValue!.currency).toBe(USD);
    expect(money(view.marketValue)).toBe('5000.0000');
    // Return % is measured in the instrument's own currency, so the FX movement
    // does not masquerade as a price movement: $1,000 on $4,000 = 25%.
    expect(rToNumber(view.returnPct.value!)).toBeCloseTo(0.25, 6);

    expect(view.baseMarketValue!.currency).toBe(INR);
    expect(money(view.baseMarketValue)).toBe('425000.0000'); // 5,000 × 85
    // Contains both a price and a currency effect, by design (§6.4).
    expect(money(view.baseUnrealizedPnl)).toBe('105000.0000'); // 425,000 − 320,000
  });

  it('excludes a holding with no FX rate, with reason no_fx_rate', () => {
    const result = valuePortfolio(
      [holding({ price: priced('160'), fxToBase: null })],
      { baseCurrency: INR },
    );
    const view = result.holdings[0]!;
    expect(view.marketValue).not.toBeNull(); // valued in its own currency
    expect(view.baseMarketValue).toBeNull(); // but not convertible
    expect(view.excludedReason).toBe('no_fx_rate');
    expect(view.weightPct.reason).toBe('no_fx_rate');
    expect(money(result.pricedValue)).toBe('0.0000');
  });
});
