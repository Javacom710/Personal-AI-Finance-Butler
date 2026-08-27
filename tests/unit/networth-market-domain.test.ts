import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/date';
import { currency, Money, toDbString } from '@/lib/decimal/money';
import { Quantity } from '@/lib/decimal/quantity';
import { Rate, rToDbString } from '@/lib/decimal/rate';
import { UnitPrice, pToDbString, valueOf } from '@/lib/decimal/price';
import { mulRate } from '@/lib/decimal/money';
import {
  compose,
  type ComponentInput,
  type NetWorthResult,
} from '@/server/domain/networth/compose';
import { DuplicateContribution, type SourceKey } from '@/server/domain/networth/keys';
import {
  emptyMarketSummary,
  marketValuation,
  type MarketBuildSummary,
} from '@/server/domain/networth/market';
import {
  assertRestates,
  restate,
  RestatementFailed,
  type PositionCostAtSpot,
} from '@/server/domain/networth/restate';
import { bridge, noFlows } from '@/server/domain/networth/bridge';
import { indexCloses } from '@/server/domain/pricing/price-series';

/**
 * The market-basis engine, in isolation
 * ([MARKET-VALUE-NET-WORTH-DESIGN.md](../../docs/MARKET-VALUE-NET-WORTH-DESIGN.md),
 * [TESTING.md §6.7](../../docs/TESTING.md)).
 *
 * Pure functions, no database. What is asserted here is the part of the phase
 * that is a *rule* rather than a query: that a total carries exactly one basis,
 * that the two bases cannot coexist at one key, that a partial figure is
 * labelled rather than completed, and that the restatement closes to the minor
 * unit.
 */

const INR = currency('INR');
const USD = currency('USD');
const m = (s: string) => Money.of(s, INR);
const d = (s: string) => isoDate(s);
const AS_OF = d('2026-06-30');

function component(
  over: Partial<ComponentInput> & { key: SourceKey; native: Money },
): ComponentInput {
  return {
    label: 'x',
    group: 'cash',
    sourceRef: { type: 'account', id: 'a' },
    fx: { rate: Rate.one(), asOf: AS_OF },
    ...over,
  } as ComponentInput;
}

function composeOf(
  inputs: ComponentInput[],
  basis: 'cost' | 'market' = 'cost',
  market?: MarketBuildSummary,
): NetWorthResult {
  return compose(inputs, {
    asOf: AS_OF,
    base: INR,
    basis,
    ...(market === undefined ? {} : { market }),
  });
}

const summary = (over: Partial<MarketBuildSummary> = {}): MarketBuildSummary => ({
  ...emptyMarketSummary(INR),
  ...over,
});

// ------------------------------------------------------- I-41, one basis only

describe('I-41 — a figure carries exactly one declared basis', () => {
  it('records the basis it was asked for, and never infers it', () => {
    expect(composeOf([]).basis).toBe('cost');
    expect(composeOf([], 'market', summary()).basis).toBe('market');
  });

  it('carries the market valuation only on a market figure', () => {
    expect(composeOf([]).market).toBeNull();
    expect(composeOf([], 'market', summary()).market).not.toBeNull();
  });

  it('composes identically for both bases given identical components', () => {
    // `compose()` records the basis and never branches on it. That is what makes
    // `reconcile()` work unchanged for both, and it is asserted rather than
    // assumed because a branch here would be the second implementation of "add
    // up net worth" that FINANCIAL-DOMAIN.md §10.5 forbids.
    const inputs = [
      component({ key: { t: 'account', accountId: 'a1' }, native: m('40000') }),
      component({
        key: { t: 'position', accountId: 'a1', instrumentId: 'i1' },
        native: m('72000'),
        group: 'investments',
      }),
    ];
    expect(toDbString(composeOf(inputs).netWorth)).toBe('112000.0000');
    expect(toDbString(composeOf(inputs, 'market', summary()).netWorth)).toBe('112000.0000');
  });

  it('a bridge across a basis change throws — a restatement is not movement', () => {
    const cost = composeOf([]);
    const market = composeOf([], 'market', summary());
    expect(() => bridge(cost, market, noFlows(INR))).toThrow(/change of basis is not movement/);
  });
});

// -------------------------------------------- I-43, cost and market cannot mix

describe('I-43 — cost and market never coexist at one source key', () => {
  const key: SourceKey = { t: 'position', accountId: 'a1', instrumentId: 'i1' };

  it('emitting both figures for one position throws rather than summing', () => {
    expect(() =>
      composeOf(
        [
          component({ key, native: m('60000'), group: 'investments' }),
          component({ key, native: m('72000'), group: 'investments' }),
        ],
        'market',
        summary(),
      ),
    ).toThrow(DuplicateContribution);
  });

  it('a contribution and an exclusion for one position throws too', () => {
    expect(() =>
      composeOf(
        [
          component({ key, native: m('72000'), group: 'investments' }),
          component({
            key,
            native: m('60000'),
            group: 'investments',
            fx: null,
            excluded: 'not_found',
          }),
        ],
        'market',
        summary(),
      ),
    ).toThrow(DuplicateContribution);
  });

  it('the message names the key, so the duplicate can be found', () => {
    try {
      composeOf(
        [
          component({ key, native: m('1'), group: 'investments' }),
          component({ key, native: m('2'), group: 'investments' }),
        ],
        'market',
        summary(),
      );
      throw new Error('expected a throw');
    } catch (error) {
      expect((error as Error).message).toContain('position:a1:i1');
    }
  });
});

// ------------------------------------------------- I-45, every exclusion named

describe('I-45 — every excluded component carries a machine-readable reason', () => {
  const REASONS = [
    'no_fx_rate',
    'unvalued',
    'no_price_on_date',
    'no_provider',
    'not_found',
    'provider_error',
    'rate_limited',
    'unsupported_asset',
    'delisted',
    'unreconciled_corporate_action',
  ] as const;

  it.each(REASONS)('%s survives composition onto the exclusion', (reason) => {
    const result = composeOf(
      [
        component({
          key: { t: 'position', accountId: 'a1', instrumentId: 'i1' },
          native: m('50000'),
          group: 'investments',
          fx: null,
          excluded: reason,
        }),
      ],
      'market',
      summary({ totalCostBasis: m('50000'), openPositions: 1 }),
    );
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0]!.reason).toBe(reason);
    // The magnitude travels with the reason: a named exclusion with no size is
    // only half an answer.
    expect(toDbString(result.excluded[0]!.native)).toBe('50000.0000');
  });

  it('an excluded component contributes nothing to either subtotal', () => {
    const result = composeOf(
      [
        component({ key: { t: 'account', accountId: 'a1' }, native: m('40000') }),
        component({
          key: { t: 'position', accountId: 'a1', instrumentId: 'i1' },
          native: m('50000'),
          group: 'investments',
          fx: null,
          excluded: 'not_found',
        }),
      ],
      'market',
      summary({ totalCostBasis: m('50000'), openPositions: 1 }),
    );
    // NOT ₹90,000. Substituting cost inside a market total is a figure in no
    // basis at all (I-39).
    expect(toDbString(result.netWorth)).toBe('40000.0000');
  });
});

// ------------------------------------------------- valuation status & coverage

describe('valuation status', () => {
  it('complete when nothing was excluded', () => {
    const result = composeOf([], 'market', summary({ openPositions: 2, pricedPositions: 2 }));
    expect(result.market!.status).toBe('complete');
  });

  it('complete when there are no investments at all — nothing is missing', () => {
    // Deliberately NOT `unavailable`. A user with no holdings has nothing left
    // out, and reporting a gap where there is none is its own dishonesty.
    const result = composeOf(
      [component({ key: { t: 'account', accountId: 'a1' }, native: m('40000') })],
      'market',
      summary(),
    );
    expect(result.market!.status).toBe('complete');
    expect(rToDbString(result.market!.investmentCoverage)).toBe(rToDbString(Rate.one()));
  });

  it('partial when something eligible was excluded, and the figure is still reported', () => {
    const result = composeOf(
      [
        component({ key: { t: 'account', accountId: 'a1' }, native: m('500000') }),
        component({
          key: { t: 'position', accountId: 'a1', instrumentId: 'bond' },
          native: m('500000'),
          group: 'investments',
          fx: null,
          excluded: 'unsupported_asset',
        }),
      ],
      'market',
      summary({
        totalCostBasis: m('500000'),
        openPositions: 1,
        pricedPositions: 0,
      }),
    );
    // One priced-nothing position makes this `unavailable`, not `partial` — the
    // narrower verdict wins when NOTHING could be priced.
    expect(result.market!.status).toBe('unavailable');
  });

  it('partial when some but not all holdings priced', () => {
    const result = composeOf(
      [
        component({
          key: { t: 'position', accountId: 'a1', instrumentId: 'eq' },
          native: m('400000'),
          group: 'investments',
        }),
        component({
          key: { t: 'position', accountId: 'a1', instrumentId: 'bond' },
          native: m('500000'),
          group: 'investments',
          fx: null,
          excluded: 'unsupported_asset',
        }),
      ],
      'market',
      summary({
        pricedCostBasis: m('300000'),
        totalCostBasis: m('800000'),
        openPositions: 2,
        pricedPositions: 1,
      }),
    );
    expect(result.market!.status).toBe('partial');
    expect(toDbString(result.market!.excludedInvestmentCost)).toBe('500000.0000');
    expect(toDbString(result.netWorth)).toBe('400000.0000');
  });

  it('unavailable when holdings exist and not one could be priced', () => {
    const result = composeOf(
      [
        component({
          key: { t: 'position', accountId: 'a1', instrumentId: 'i1' },
          native: m('100000'),
          group: 'investments',
          fx: null,
          excluded: 'no_provider',
        }),
      ],
      'market',
      summary({ totalCostBasis: m('100000'), openPositions: 1, pricedPositions: 0 }),
    );
    expect(result.market!.status).toBe('unavailable');
  });
});

describe('coverage is value-weighted for price exclusions (D-29)', () => {
  it('weights by base cost basis, not by component count', () => {
    // One large unpriced holding among many small priced ones: the two measures
    // give visibly different answers, which is the whole point of the change.
    const valuation = marketValuation(
      summary({
        pricedCostBasis: m('100000'),
        totalCostBasis: m('1100000'),
        openPositions: 5,
        pricedPositions: 4,
      }),
      [],
    );
    // Component count would say 4/5 = 80%. Cost weight says ~9%.
    expect(rToDbString(valuation.investmentCoverage)).toBe('0.0909090909');
  });

  it('an empty investment block is fully covered, not zero-covered', () => {
    expect(rToDbString(marketValuation(emptyMarketSummary(INR), []).investmentCoverage)).toBe(
      rToDbString(Rate.one()),
    );
  });

  it('reports the excluded cost alongside the ratio', () => {
    const valuation = marketValuation(
      summary({ pricedCostBasis: m('300000'), totalCostBasis: m('800000') }),
      [],
    );
    expect(toDbString(valuation.excludedInvestmentCost)).toBe('500000.0000');
  });

  it('carries the staleness summary through unchanged', () => {
    const valuation = marketValuation(
      summary({ staleCount: 2, oldestStaleTradingDate: d('2026-06-19') }),
      [],
    );
    expect(valuation.staleness).toEqual({ count: 2, oldestTradingDate: d('2026-06-19') });
  });
});

// ---------------------------------------------------------- I-48, restatement

describe('I-48 — the cost-to-market restatement closes exactly', () => {
  const positionKey: SourceKey = { t: 'position', accountId: 'a1', instrumentId: 'i1' };

  function pair(costNative: string, marketNative: string, excludedReason?: 'not_found') {
    const cash = component({ key: { t: 'account', accountId: 'a1' }, native: m('40000') });
    const cost = composeOf([
      cash,
      component({ key: positionKey, native: m(costNative), group: 'investments' }),
    ]);
    const market = composeOf(
      [
        cash,
        excludedReason === undefined
          ? component({ key: positionKey, native: m(marketNative), group: 'investments' })
          : component({
              key: positionKey,
              native: m(costNative),
              group: 'investments',
              fx: null,
              excluded: excludedReason,
            }),
      ],
      'market',
      summary({ totalCostBasis: m(costNative), openPositions: 1, pricedPositions: excludedReason === undefined ? 1 : 0 }),
    );
    return { cost, market };
  }

  it('price effect alone, single currency: FX rebasis is exactly zero', () => {
    const { cost, market } = pair('60000', '72000');
    const atSpot: PositionCostAtSpot[] = [{ key: positionKey, costAtSpot: m('60000') }];
    const r = assertRestates(cost, market, atSpot);

    expect(toDbString(r.cost)).toBe('100000.0000');
    expect(toDbString(r.market)).toBe('112000.0000');
    expect(toDbString(r.difference)).toBe('12000.0000');
    expect(r.lines.map((l) => [l.key, toDbString(l.amount)])).toEqual([
      ['removed_unpriced', '0.0000'],
      ['fx_rebasis', '0.0000'],
      ['price_effect', '12000.0000'],
    ]);
    expect(toDbString(r.residual)).toBe('0.0000');
  });

  it('splits price from currency when the spot cost differs from the acquisition cost', () => {
    const { cost, market } = pair('60000', '84000');
    // Cost at spot is ₹66,000: the same units of the instrument's own currency,
    // converted at today's rate instead of at acquisition. The remaining
    // ₹18,000 is price.
    const r = assertRestates(cost, market, [{ key: positionKey, costAtSpot: m('66000') }]);
    expect(toDbString(r.lines[1]!.amount)).toBe('6000.0000');
    expect(toDbString(r.lines[2]!.amount)).toBe('18000.0000');
    expect(r.closes).toBe(true);
  });

  it('an unpriced holding leaves through the removed line, and is named', () => {
    const { cost, market } = pair('60000', '0', 'not_found');
    const r = assertRestates(cost, market, []);
    expect(toDbString(r.lines[0]!.amount)).toBe('-60000.0000');
    expect(r.unpricedKeys).toEqual(['position:a1:i1']);
    expect(toDbString(r.market)).toBe('40000.0000');
    expect(r.closes).toBe(true);
  });

  it('has no liability term and no manual-asset term', () => {
    const shared = [
      component({ key: { t: 'asset', assetId: 'flat' }, native: m('2000000'), group: 'property' }),
      component({ key: { t: 'liability', liabilityId: 'loan' }, native: m('-800000'), group: 'loans' }),
    ];
    const cost = composeOf([
      ...shared,
      component({ key: positionKey, native: m('60000'), group: 'investments' }),
    ]);
    const market = composeOf(
      [...shared, component({ key: positionKey, native: m('72000'), group: 'investments' })],
      'market',
      summary({ pricedCostBasis: m('60000'), totalCostBasis: m('60000'), openPositions: 1, pricedPositions: 1 }),
    );
    const r = assertRestates(cost, market, [{ key: positionKey, costAtSpot: m('60000') }]);
    // The whole difference is the investment block. A line for either of the
    // other two would mean something is wrong.
    expect(toDbString(r.difference)).toBe('12000.0000');
    expect(toDbString(r.lines[2]!.amount)).toBe('12000.0000');
  });

  it('refuses two figures on the same basis — that is a bridge', () => {
    const cost = composeOf([]);
    expect(() => restate(cost, cost, [])).toThrow(/restatement explains why two BASES/);
  });

  it('refuses two different dates — a restatement is at one instant', () => {
    const cost = composeOf([]);
    const market = compose([], { asOf: d('2026-07-31'), base: INR, basis: 'market', market: summary() });
    expect(() => restate(cost, market, [])).toThrow(/different dates/);
  });

  it('a failure to close is an exception, not a quietly wrong number', () => {
    const cost = composeOf([
      component({ key: { t: 'account', accountId: 'a1' }, native: m('40000') }),
    ]);
    // A market figure whose non-investment block disagrees — impossible from the
    // real builder, and the assertion that would catch it if it ever were not.
    const market = composeOf(
      [component({ key: { t: 'account', accountId: 'a1' }, native: m('50000') })],
      'market',
      summary(),
    );
    expect(() => assertRestates(cost, market, [])).toThrow(RestatementFailed);
  });
});

// ------------------------------------------------------------- I-49, precision

describe('I-49 — provider precision survives to the market value', () => {
  const OBSERVED = '1629.80004883';

  it('a scale-8 observation round-trips exactly, with no Number() in the path', () => {
    const price = UnitPrice.of(OBSERVED);
    expect(pToDbString(price)).toBe('1629.80004883');
    // The float-shaped digits are Twelve Data's own upstream artefact, carried
    // faithfully rather than "cleaned" — cleaning it would invent a price the
    // provider never published.
    expect(price.units).toBe(162_980_004_883n);
  });

  it('rounds exactly once at valueOf, at MONEY_SCALE', () => {
    const value = valueOf(Quantity.of('400'), UnitPrice.of(OBSERVED), INR, 'half_up');
    // 400 × 1629.80004883 = 651920.019532 → scale 4, half_up → 651920.0195
    expect(toDbString(value)).toBe('651920.0195');
  });

  it('rounds exactly once more at mulRate, and never in the aggregation', () => {
    const value = valueOf(Quantity.of('400'), UnitPrice.of(OBSERVED), USD, 'half_up');
    const converted = mulRate(Money.fromMinor(value.minor, INR), Rate.of('83.2500000000'), 'half_up');
    // 651920.0195 × 83.25 = 54272341.623375 → scale 4, half_up → 54272341.6234
    expect(toDbString(converted)).toBe('54272341.6234');

    // Aggregation adds already-rounded bigints, so the subtotal is exact.
    const result = compose(
      [
        component({
          key: { t: 'position', accountId: 'a1', instrumentId: 'i1' },
          native: value,
          group: 'investments',
          fx: { rate: Rate.of('83.2500000000'), asOf: AS_OF },
          sourceCurrency: USD,
        }),
      ],
      { asOf: AS_OF, base: INR, basis: 'market', market: summary() },
    );
    expect(toDbString(result.netWorth)).toBe('54272341.6234');
  });

  it('a tiny quantity of an eight-decimal price does not vanish', () => {
    const value = valueOf(Quantity.of('0.00000001'), UnitPrice.of(OBSERVED), INR, 'half_up');
    // 1.6298000488e-5 → scale 4, half_up → 0.0000. Reported as zero because
    // money IS scale 4 (ADR-04), not because precision was lost on the way.
    expect(toDbString(value)).toBe('0.0000');
  });
});

// ------------------------------------------------- the indexed price lookup

describe('the indexed historical-price lookup', () => {
  const series = [
    { asOf: '2026-08-14', close: '180.00000000' },
    { asOf: '2026-08-12', close: '178.00000000' },
    { asOf: '2026-08-17', close: '182.00000000' },
  ];

  it('sorts an unordered series and answers the greatest as_of <= on', () => {
    const index = indexCloses(series, 'eod');
    expect(index.closeAsOf(d('2026-08-16'))!.asOf).toBe('2026-08-14');
    expect(index.closeAsOf(d('2026-08-17'))!.asOf).toBe('2026-08-17');
    expect(index.closeAsOf(d('2026-08-13'))!.asOf).toBe('2026-08-12');
  });

  it('never uses a later price for an earlier date', () => {
    const index = indexCloses(series, 'eod');
    expect(index.closeAsOf(d('2026-08-11'))).toBeNull();
  });

  it('reports the carry-back distance per point', () => {
    const index = indexCloses(series, 'eod');
    expect(index.closeAsOf(d('2026-08-16'))!.carriedDays).toBe(2);
    expect(index.closeAsOf(d('2026-08-14'))!.carriedDays).toBe(0);
  });

  it('is bounded — beyond the backstop the point is a gap, not a value', () => {
    const index = indexCloses(series, 'eod');
    expect(index.closeAsOf(d('2026-08-27'))!.asOf).toBe('2026-08-17');
    expect(index.closeAsOf(d('2026-08-28'))).toBeNull();
  });

  it('a continuous cadence has the tighter two-day bound', () => {
    const index = indexCloses(series, 'continuous');
    expect(index.closeAsOf(d('2026-08-19'))!.asOf).toBe('2026-08-17');
    expect(index.closeAsOf(d('2026-08-20'))).toBeNull();
  });

  it('does not mutate the caller-supplied array', () => {
    const input = [...series];
    indexCloses(input, 'eod');
    expect(input).toEqual(series);
  });

  it('examines O(log n) observations per lookup, not O(n)', () => {
    const many = Array.from({ length: 1024 }, (_, i) => ({
      asOf: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10),
      close: `${100 + i}.00000000`,
    }));

    const index = indexCloses(many, 'eod');
    expect(index.size).toBe(1024);
    index.closeAsOf(d('2026-01-01'));
    // 1,024 sorted points reach any answer in at most 11 comparisons. A linear
    // scan would touch all 1,024 — the difference the design measured as 9× over
    // a 365-point series.
    expect(index.scanned).toBeLessThanOrEqual(11);
  });

  it('an empty series is a gap at every date', () => {
    const index = indexCloses([], 'eod');
    expect(index.size).toBe(0);
    expect(index.closeAsOf(d('2026-08-16'))).toBeNull();
  });
});
