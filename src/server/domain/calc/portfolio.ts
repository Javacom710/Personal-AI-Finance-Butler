/**
 * `PortfolioSummary` assembly
 * ([INVESTMENT-DOMAIN.md §6](../../../../docs/INVESTMENT-DOMAIN.md#6-portfolio-metrics)).
 *
 * **Every monetary field here is in the BASE currency.** A portfolio spans
 * instruments in different currencies, so a summary "in the instrument currency"
 * is not a number. Per-holding figures stay in the instrument's currency, in
 * `HoldingView`.
 *
 * ## The two denominators, and why using one for both is wrong
 *
 * Once any position has been partially sold, "invested capital" and "capital
 * deployed" diverge:
 *
 * ```
 * Buy 100 @ ₹100, sell 40 @ ₹150, remainder worth ₹160
 *   investedCapital  60 × ₹100  =  ₹6,000     realized  ₹2,000
 *   costDeployed    100 × ₹100  = ₹10,000     unrealized ₹3,600
 *
 *   unrealizedReturnPct = 3,600 / 6,000  = 60%   both span the SAME 60 units
 *   totalReturnPct      = 5,600 / 10,000 = 56%   the realised gain was earned
 *                                                by the 40 that have left
 *   5,600 / 6,000       = 93%   WRONG, and the default mistake
 * ```
 *
 * ## Nothing is counted twice
 *
 * Trade fees never reach `fees`. A purchase fee is already inside the cost
 * basis; a sale fee has already reduced realised P&L. Accruing either again
 * subtracts it twice — the ₹80 error worked through in §6.3 and asserted by
 * golden scenario **L1**.
 */

import { add, sub, sum, type CurrencyCode, type Money } from '../../../lib/decimal/money';
import { Rate } from '../../../lib/decimal/rate';
import { metric, unavailable, type Metric } from '../../../lib/metric';
import { ratio } from './ratio';
import type { InstrumentRef } from '../pricing/valuation';
import type { IsoDate } from '../../../lib/date';

export interface PortfolioInput {
  readonly baseCurrency: CurrencyCode;
  readonly asOf: IsoDate;

  /** `Σ positions.base_cost_basis` over OPEN positions — capital currently at risk. */
  readonly investedCapital: Money;
  /** `Σ (tax_lots.cost_total × lot.fx_rate_to_base)` over ALL lots ever opened. */
  readonly costDeployed: Money;
  /** Priced holdings only, base currency. */
  readonly marketValue: Money;
  /** `Σ lot_disposals.base_realized_pnl`. */
  readonly realizedPnl: Money;

  /** GROSS declared, per I-12. */
  readonly dividends: Money;
  readonly interest: Money;
  /** `Σ positions.fees_total` **plus** portfolio-level `fee` rows (§6.2). */
  readonly fees: Money;
  readonly taxes: Money;

  /** `pricedCostBasis / totalCostBasis`, from the valuation pass. */
  readonly coverage: Rate;
  readonly staleInstruments: readonly InstrumentRef[];
  readonly unpricedInstruments: readonly InstrumentRef[];

  readonly xirr: Metric<Rate>;
  readonly twr: Metric<Rate>;
}

export interface PortfolioSummary {
  readonly asOf: IsoDate;
  readonly investedCapital: Money;
  readonly costDeployed: Money;
  readonly marketValue: Money;
  /** `marketValue − investedCapital`. `null` when nothing could be priced. */
  readonly unrealizedPnl: Money | null;
  readonly realizedPnl: Money;
  readonly dividends: Money;
  readonly interest: Money;
  readonly fees: Money;
  readonly taxes: Money;
  /** `unrealized + realized + dividends + interest − fees − taxes`. */
  readonly totalReturn: Money | null;

  /** `unrealizedPnl / investedCapital` — numerator and denominator span the same units. */
  readonly unrealizedReturnPct: Metric<Rate>;
  /** `totalReturn / costDeployed`. **Not annualised**; label it *on capital deployed*. */
  readonly totalReturnPct: Metric<Rate>;
  readonly xirr: Metric<Rate>;
  readonly twr: Metric<Rate>;

  readonly coverage: Rate;
  readonly staleInstruments: readonly InstrumentRef[];
  readonly unpricedInstruments: readonly InstrumentRef[];
}

export function portfolioSummary(input: PortfolioInput): PortfolioSummary {
  const {
    investedCapital,
    costDeployed,
    marketValue,
    realizedPnl,
    dividends,
    interest,
    fees,
    taxes,
  } = input;

  // With no priced holding at all, `marketValue` is zero because nothing could
  // be added — not because the portfolio is worthless. Unrealised P&L and every
  // figure that depends on it are therefore `null` with a reason, never 0
  // (edge case 10, FINANCIAL-DOMAIN.md §10.3).
  const nothingPriced = input.coverage.value === 0n && investedCapital.minor !== 0n;

  const unrealizedPnl = nothingPriced ? null : sub(marketValue, investedCapital);

  const income = add(dividends, interest);
  const costs = add(fees, taxes);
  const totalReturn =
    unrealizedPnl === null
      ? null
      : sub(add(add(unrealizedPnl, realizedPnl), income), costs);

  return {
    asOf: input.asOf,
    investedCapital,
    costDeployed,
    marketValue,
    unrealizedPnl,
    realizedPnl,
    dividends,
    interest,
    fees,
    taxes,
    totalReturn,

    unrealizedReturnPct:
      unrealizedPnl === null ? unavailable('no_price') : ratio(unrealizedPnl, investedCapital),
    totalReturnPct: totalReturn === null ? unavailable('no_price') : ratio(totalReturn, costDeployed),
    xirr: input.xirr,
    twr: input.twr,

    coverage: input.coverage,
    staleInstruments: input.staleInstruments,
    unpricedInstruments: input.unpricedInstruments,
  };
}

/**
 * The cash cross-check from §6.3:
 * `totalReturn = marketValue + cash in − cash out`.
 *
 * Computed a **second, independent way** from the ledger's own cash effects, so
 * a component-sum error shows up as a disagreement rather than as a plausible
 * number. The two must agree exactly; golden scenario **L1** asserts it.
 */
export function totalReturnByCashCrossCheck(args: {
  readonly marketValue: Money;
  /** Every positive `base_net_amount` — sale proceeds, dividends, interest. */
  readonly cashIn: readonly Money[];
  /** Every negative one, as a magnitude — purchases, standalone fees and taxes. */
  readonly cashOut: readonly Money[];
  readonly baseCurrency: CurrencyCode;
}): Money {
  const inflow = sum(args.cashIn, args.baseCurrency);
  const outflow = sum(args.cashOut, args.baseCurrency);
  return sub(add(args.marketValue, inflow), outflow);
}

/**
 * Portfolio growth — a value series over time
 * ([INVESTMENT-DOMAIN.md §8.1](../../../../docs/INVESTMENT-DOMAIN.md#81-portfolio-growth-over-time)).
 *
 * **Derived, never stored.** Both inputs — the ledger and `instrument_prices` —
 * are already persisted, so a snapshot table would be a cache of a derivable
 * value, which ADR-06 says not to build until measurement demands it.
 *
 * **Days with no price are gaps, not zeros.** The series is only as complete as
 * `instrument_prices`, which is empty until OD-3 is resolved. A gap renders as a
 * break in the line with the affected instruments named — never interpolated,
 * never zero, and never silently omitted from the total.
 */
export interface GrowthPoint {
  readonly on: IsoDate;
  /** Base currency. `null` when at least one held instrument had no price that day. */
  readonly value: Money | null;
  /** Cost of the holdings on that day, base currency. Always available. */
  readonly costBasis: Money;
  /** Named so a gap can say *which* holding caused it. */
  readonly unpriced: readonly string[];
}

export interface GrowthSeries {
  readonly points: readonly GrowthPoint[];
  /** How many points carry a value. Zero is the expected state before OD-3. */
  readonly pricedPoints: number;
  readonly coverage: Metric<Rate>;
}

export function growthSeries(points: readonly GrowthPoint[]): GrowthSeries {
  const priced = points.filter((p) => p.value !== null).length;
  return {
    points,
    pricedPoints: priced,
    coverage:
      points.length === 0
        ? unavailable('no_data')
        : metric(Rate.of((priced / points.length).toFixed(10))),
  };
}
