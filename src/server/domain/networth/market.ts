/**
 * Valuation completeness under `basis: 'market'`
 * ([FINANCIAL-DOMAIN.md §9.3](../../../../docs/FINANCIAL-DOMAIN.md#93-calculation),
 * [MARKET-VALUE-NET-WORTH-DESIGN.md §5](../../../../docs/MARKET-VALUE-NET-WORTH-DESIGN.md#5-partial-valuation)).
 *
 * Pure. The component builder decides what could be priced; this states what
 * that means for the figure as a whole.
 *
 * Three rules, each guarding a wrong number that would otherwise look right:
 *
 * - **A partial figure is reported and labelled, never suppressed and never
 *   completed with cost.** Adding an unpriced holding's acquisition cost into a
 *   market total produces a number in no basis at all — unreconcilable against
 *   either source, and changing meaning as coverage moves ([ADR-23](../../../../docs/DECISIONS.md#adr-23--net-worth-carries-a-declared-valuation-basis-phase-5-ships-net-worth-at-cost),
 *   invariants **I-38**, **I-39**).
 * - **Investment coverage is value-weighted; everything else is component-count.**
 *   The distinction is forced rather than stylistic (**D-29**): an unpriced
 *   holding's base cost basis *is* known, so it can be weighted; a component with
 *   no FX rate has no expressible base value at all, and an unvalued flat has no
 *   figure of any kind.
 * - **A stale price contributes, and the metric says so** ([ADR-28](../../../../docs/DECISIONS.md#adr-28--staleness-is-measured-in-trading-sessions-not-wall-clock-hours),
 *   **I-44**). Refusing it would blank the headline every long weekend, which is
 *   less usable and no more accurate than saying "priced as of Friday".
 */

import type { IsoDate } from '../../../lib/date';
import { Money, sub, type Money as MoneyValue } from '../../../lib/decimal/money';
import { Rate } from '../../../lib/decimal/rate';
import { ratio } from '../calc/ratio';
import type { ExcludedComponent } from './keys';

/**
 * `complete` — every eligible component contributed; nothing was excluded.
 *
 * `partial` — something eligible was excluded and named. **The figure is still
 * reported**, with the excluded magnitude beside it.
 *
 * `unavailable` — positions exist and **not one** could be priced. The headline
 * is withheld and the `cost` figure offered by name, because a "market-value net
 * worth" made only of cash and property is a different statement from the one
 * the label makes. Deliberately narrow: a user with no investments at all is
 * `complete`, not `unavailable` — there is nothing missing.
 */
export type ValuationStatus = 'complete' | 'partial' | 'unavailable';

/** What only the market component builder knows, handed to `compose()`. */
export interface MarketBuildSummary {
  /** Base-currency cost basis of the positions that **could** be priced. */
  readonly pricedCostBasis: MoneyValue;
  /** Base-currency cost basis of every **open** position, priced or not. */
  readonly totalCostBasis: MoneyValue;
  /** Open positions considered. A position at zero units is not open and is not counted. */
  readonly openPositions: number;
  readonly pricedPositions: number;
  /** Contributing positions whose price is classified `stale`. */
  readonly staleCount: number;
  /** The oldest trading date among those — *"priced as of …"*. */
  readonly oldestStaleTradingDate: IsoDate | null;
  /**
   * The furthest a contributing close was carried back to reach this date. A
   * historical point valued from a session nine days earlier is a different
   * thing from one valued on the day itself, and a chart has to be able to tell
   * ([MARKET-VALUE-NET-WORTH-DESIGN.md §8.2](../../../../docs/MARKET-VALUE-NET-WORTH-DESIGN.md#82-historical-edge-rules)).
   */
  readonly maxCarriedDays: number;
}

export interface MarketValuation {
  readonly status: ValuationStatus;
  /**
   * `Σ baseCostBasis(priced) / Σ baseCostBasis(open)` — **value-weighted**
   * (D-29). Cost is the only common denominator available for a holding that has
   * no price; `excludedInvestmentCost` carries the magnitude so the ratio is not
   * the only thing reported.
   */
  readonly investmentCoverage: Rate;
  /** What the unpriced holdings cost. Not a loss — the amount set aside for want of a price. */
  readonly excludedInvestmentCost: MoneyValue;
  readonly staleness: {
    readonly count: number;
    readonly oldestTradingDate: IsoDate | null;
  };
  readonly maxCarriedDays: number;
}

/**
 * The completeness verdict for one market-basis figure.
 *
 * `excluded` is the map's own list — every exclusion, on either side and from
 * any cause — because `partial` is a statement about the whole figure and not
 * only about its investment block. A missing FX rate on a foreign bank account
 * makes the total just as incomplete as a missing price does.
 */
export function marketValuation(
  summary: MarketBuildSummary,
  excluded: readonly ExcludedComponent[],
): MarketValuation {
  const base = summary.totalCostBasis.currency;
  const coverage = ratio(summary.pricedCostBasis, summary.totalCostBasis);

  return {
    status: statusOf(summary, excluded),
    // A portfolio with no open positions is fully covered: there is nothing left
    // out. Zero would read as "we could not price anything", which is different.
    investmentCoverage: coverage.value ?? Rate.one(),
    excludedInvestmentCost: sub(
      Money.fromMinor(summary.totalCostBasis.minor, base),
      Money.fromMinor(summary.pricedCostBasis.minor, base),
    ),
    staleness: {
      count: summary.staleCount,
      oldestTradingDate: summary.oldestStaleTradingDate,
    },
    maxCarriedDays: summary.maxCarriedDays,
  };
}

function statusOf(
  summary: MarketBuildSummary,
  excluded: readonly ExcludedComponent[],
): ValuationStatus {
  if (summary.openPositions > 0 && summary.pricedPositions === 0) return 'unavailable';
  return excluded.length > 0 ? 'partial' : 'complete';
}

/** The verdict for an empty market build — no positions at all, nothing excluded. */
export function emptyMarketSummary(base: MoneyValue['currency']): MarketBuildSummary {
  return {
    pricedCostBasis: Money.zero(base),
    totalCostBasis: Money.zero(base),
    openPositions: 0,
    pricedPositions: 0,
    staleCount: 0,
    oldestStaleTradingDate: null,
    maxCarriedDays: 0,
  };
}
