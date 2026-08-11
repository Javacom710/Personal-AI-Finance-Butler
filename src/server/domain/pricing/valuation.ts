/**
 * Valuation — positions plus prices become holdings
 * ([INVESTMENT-DOMAIN.md §5](../../../../docs/INVESTMENT-DOMAIN.md#5-valuation)).
 *
 * Pure. The service fetches the positions, the prices and the FX rates; this
 * module does arithmetic on them and nothing else.
 *
 * ```
 * marketValue   = valueOf(quantity, price)        (half_up at MONEY_SCALE)
 * unrealizedPnl = marketValue − invested
 * returnPct     = invested > 0 ? unrealizedPnl / invested : null
 * ```
 *
 * **Per-holding figures are in the instrument's currency; base-currency
 * equivalents sit beside them.** A portfolio spans instruments in different
 * currencies, so a summary in "the instrument currency" is not a number — but a
 * single holding's return percentage is only meaningful in its own currency,
 * where the FX movement is not mixed into the price movement.
 *
 * Nothing here throws on a missing price. `marketValue` is `null`, the holding
 * is excluded from totals and from `weightPct` denominators, and the reason
 * travels to the screen and to the AI tool result. Rendering `null` as `0` would
 * read as "worthless", which is a different financial statement from "unknown"
 * (FINANCIAL-DOMAIN.md §10.3).
 */

import { Money, mulRate, sub, sum, type CurrencyCode } from '../../../lib/decimal/money';
import { Rate } from '../../../lib/decimal/rate';
import { qIsZero, type Quantity } from '../../../lib/decimal/quantity';
import { perUnit, valueOf, type UnitPrice } from '../../../lib/decimal/price';
import { metric, unavailable, type Metric } from '../../../lib/metric';
import { ratio } from '../calc/ratio';
import { isUsable, type PriceResult } from './price-result';

export type AssetClass =
  | 'equity'
  | 'mutual_fund'
  | 'etf'
  | 'bond'
  | 'fixed_deposit'
  | 'gold'
  | 'crypto'
  | 'cash_equivalent'
  | 'other';

export interface InstrumentRef {
  readonly id: string;
  readonly symbol: string;
  readonly name: string;
  readonly exchange: string | null;
  readonly assetClass: AssetClass;
  readonly currency: CurrencyCode;
  readonly country: string | null;
}

/** One `positions` row, plus the price and rate the service resolved for it. */
export interface HoldingInput {
  readonly accountId: string;
  readonly accountName: string;
  readonly instrument: InstrumentRef;

  readonly quantity: Quantity;
  /** `positions.cost_basis` — instrument currency. */
  readonly invested: Money;
  /** `positions.base_cost_basis` — summed per lot at each lot's own rate. */
  readonly baseInvested: Money;

  readonly realizedPnl: Money;
  readonly incomeTotal: Money;
  readonly feesTotal: Money;
  readonly taxesTotal: Money;

  readonly price: PriceResult;
  /** Instrument → base on the valuation date. `null` when no rate exists. */
  readonly fxToBase: Rate | null;
}

export interface HoldingView {
  readonly accountId: string;
  readonly accountName: string;
  readonly instrument: InstrumentRef;

  readonly quantity: Quantity;
  /** `cost_basis / quantity`, derived at PRICE_SCALE. `null` on a closed position. */
  readonly avgCost: UnitPrice | null;
  readonly invested: Money;
  readonly baseInvested: Money;

  readonly realizedPnl: Money;
  readonly incomeTotal: Money;
  readonly feesTotal: Money;
  readonly taxesTotal: Money;

  readonly price: PriceResult;
  readonly marketValue: Money | null;
  readonly baseMarketValue: Money | null;
  readonly unrealizedPnl: Money | null;
  readonly baseUnrealizedPnl: Money | null;
  readonly returnPct: Metric<Rate>;
  /** Of the **priced** portion of the portfolio. Filled by `valuePortfolio`. */
  readonly weightPct: Metric<Rate>;
  /** Why this holding contributes nothing to the totals, when it does not. */
  readonly excludedReason: 'no_price' | 'no_fx_rate' | null;
}

export interface ValuationOptions {
  readonly baseCurrency: CurrencyCode;
  /**
   * Positions sold down to zero are retained so realised P&L is not lost
   * (edge case 18), and excluded from the holdings display and from allocation.
   */
  readonly includeClosed?: boolean;
}

/** One holding, valued. `weightPct` is unavailable until the portfolio pass. */
export function valueHolding(input: HoldingInput, options: ValuationOptions): HoldingView {
  const { baseCurrency } = options;

  const avgCost = qIsZero(input.quantity) ? null : perUnit(input.invested, input.quantity, 'half_up');

  if (!isUsable(input.price)) {
    return {
      ...common(input, avgCost),
      marketValue: null,
      baseMarketValue: null,
      unrealizedPnl: null,
      baseUnrealizedPnl: null,
      returnPct: unavailable('no_price'),
      weightPct: unavailable('no_price'),
      excludedReason: 'no_price',
    };
  }

  const marketValue = valueOf(input.quantity, input.price.price, input.instrument.currency, 'half_up');
  const unrealizedPnl = sub(marketValue, input.invested);
  // Measured in the instrument's own currency, so a currency movement does not
  // masquerade as a price movement.
  const returnPct = ratio(unrealizedPnl, input.invested);

  if (input.fxToBase === null) {
    return {
      ...common(input, avgCost),
      marketValue,
      baseMarketValue: null,
      unrealizedPnl,
      baseUnrealizedPnl: null,
      returnPct,
      weightPct: unavailable('no_fx_rate'),
      excludedReason: 'no_fx_rate',
    };
  }

  const baseMarketValue = mulRate(
    Money.fromMinor(marketValue.minor, baseCurrency),
    input.fxToBase,
    'half_up',
  );
  // `baseInvested` uses each lot's ACQUISITION rate while `baseMarketValue` uses
  // today's, so this legitimately contains both a price and a currency effect.
  // Separating them needs a per-lot revaluation no screen consumes — a stated
  // limitation (INVESTMENT-DOMAIN.md §6.4), not an oversight.
  const baseUnrealizedPnl = sub(baseMarketValue, input.baseInvested);

  return {
    ...common(input, avgCost),
    marketValue,
    baseMarketValue,
    unrealizedPnl,
    baseUnrealizedPnl,
    returnPct,
    weightPct: unavailable('no_data'),
    excludedReason: null,
  };
}

function common(
  input: HoldingInput,
  avgCost: UnitPrice | null,
): Omit<
  HoldingView,
  | 'marketValue'
  | 'baseMarketValue'
  | 'unrealizedPnl'
  | 'baseUnrealizedPnl'
  | 'returnPct'
  | 'weightPct'
  | 'excludedReason'
> {
  return {
    accountId: input.accountId,
    accountName: input.accountName,
    instrument: input.instrument,
    quantity: input.quantity,
    avgCost,
    invested: input.invested,
    baseInvested: input.baseInvested,
    realizedPnl: input.realizedPnl,
    incomeTotal: input.incomeTotal,
    feesTotal: input.feesTotal,
    taxesTotal: input.taxesTotal,
    price: input.price,
  };
}

export interface PortfolioValuation {
  readonly holdings: readonly HoldingView[];
  /** Base currency, priced holdings only. */
  readonly pricedValue: Money;
  /** Base-currency cost of the holdings that could be priced. */
  readonly pricedCostBasis: Money;
  /** Base-currency cost of every open holding, priced or not. */
  readonly totalCostBasis: Money;
  readonly unpricedCount: number;
  /** `pricedCostBasis / totalCostBasis`. 1 when everything is priced. */
  readonly coverage: Rate;
  readonly unpriced: readonly InstrumentRef[];
  readonly stale: readonly InstrumentRef[];
}

/**
 * Value a whole portfolio, then assign each holding its weight.
 *
 * Weights are over **priced** market value, and the response carries the
 * unpriced count and the coverage ratio so the UI can say "94% of portfolio
 * classified; 2 holdings unpriced" rather than quietly reporting a smaller
 * number as if it were the whole (FINANCIAL-DOMAIN.md §10.4).
 */
export function valuePortfolio(
  inputs: readonly HoldingInput[],
  options: ValuationOptions,
): PortfolioValuation {
  const { baseCurrency } = options;
  const open = options.includeClosed === true ? inputs : inputs.filter((i) => !qIsZero(i.quantity));

  const valued = open.map((input) => valueHolding(input, options));

  const priced = valued.filter((h) => h.baseMarketValue !== null);
  const pricedValue = sum(
    priced.map((h) => h.baseMarketValue!),
    baseCurrency,
  );
  const pricedCostBasis = sum(
    priced.map((h) => h.baseInvested),
    baseCurrency,
  );
  const totalCostBasis = sum(
    valued.map((h) => h.baseInvested),
    baseCurrency,
  );

  const coverageMetric = ratio(pricedCostBasis, totalCostBasis);
  // An empty portfolio is fully covered: there is nothing left out. A zero
  // coverage would read as "we could not price anything", which is different.
  const coverage = coverageMetric.value ?? Rate.one();

  const withWeights = valued.map((h) => ({
    ...h,
    weightPct:
      h.baseMarketValue === null
        ? h.weightPct
        : weightOf(h.baseMarketValue, pricedValue),
  }));

  return {
    holdings: withWeights,
    pricedValue,
    pricedCostBasis,
    totalCostBasis,
    unpricedCount: valued.length - priced.length,
    coverage,
    unpriced: valued.filter((h) => h.excludedReason !== null).map((h) => h.instrument),
    stale: valued.filter((h) => h.price.status === 'stale').map((h) => h.instrument),
  };
}

function weightOf(value: Money, total: Money): Metric<Rate> {
  const computed = ratio(value, total);
  return computed.value === null ? computed : metric(computed.value);
}
