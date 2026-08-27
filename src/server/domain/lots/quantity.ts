/**
 * `quantityHeldOn` — units held on a date, ratio-aware
 * ([INVESTMENT-DOMAIN.md §8.1](../../../../docs/INVESTMENT-DOMAIN.md#81-portfolio-growth-over-time),
 * [FINANCIAL-DOMAIN.md §9.3](../../../../docs/FINANCIAL-DOMAIN.md#93-calculation),
 * invariant **I-46**).
 *
 * The one genuinely new algorithm in Phase 6.11, and the one place a plausible
 * implementation is silently wrong:
 *
 * ```
 * WRONG:  Σ quantity where trade_date <= T
 * ```
 *
 * A `split` and a `bonus` carry `quantity IS NULL` and a **ratio**
 * (`inv_txn_corporate_action_shape`), so a running sum ignores them entirely and
 * reports the **pre-split** quantity for ever after. Money is invariant under a
 * corporate action — which is why the at-cost figure needs no ratio arithmetic
 * at all — but market value is a *quantity* figure, and quantity is exactly what
 * a split changes.
 *
 * ## Why this reads a timeline rather than re-deriving one
 *
 * The ratio arithmetic lives in `replay()`, applied **per open lot** at
 * `QTY_SCALE` with `half_up`. An aggregate re-derivation — `Σ txn.quantity ×
 * Π ratios`, or the same fold over a running total — agrees with it on every
 * evenly-divisible action and disagrees by a unit of 10⁻⁸ on a reverse split
 * that does not divide evenly, because per-lot rounding and rounding-the-sum are
 * not the same operation. A market value that disagreed with `positions.quantity`
 * by dust would put the Net Worth page and the Investments page in visible
 * conflict over the same holding.
 *
 * So there is **one** implementation: `replay()` emits a checkpoint per trade
 * date (`ReplayResult.quantityTimeline`) and this module indexes into it. That
 * makes `quantityHeldOn(T)` exactly `replay(txns dated <= T).totals.quantity`
 * by construction — the property `tests/property/quantity-held-on.test.ts`
 * asserts across splits, bonuses and reverse splits — while costing one replay
 * per position rather than one per point of a series.
 *
 * **`positions.quantity` must never answer this question.** It is today's cache
 * with no date bound (ADR-06), and the temptation is stronger here than anywhere
 * else in the design because it looks exactly like what is wanted (**I-47**).
 */

import { compareDates, type IsoDate } from '../../../lib/date';
import { Quantity, type Quantity as Qty } from '../../../lib/decimal/quantity';
import type { QuantityCheckpoint } from './engine';

/** Ascending by date, one entry per distinct `trade_date`. `ReplayResult.quantityTimeline`. */
export type QuantityTimeline = readonly QuantityCheckpoint[];

/**
 * Units held at the end of `on`.
 *
 * The greatest checkpoint with `on <= T`; **zero** before the first trade, which
 * is a fact rather than a gap — nothing was held.
 *
 * Binary search, because a market-value series folds this once per point per
 * position and a linear scan turns a daily chart into a second of CPU
 * ([MARKET-VALUE-NET-WORTH-DESIGN.md §13](../../../../docs/MARKET-VALUE-NET-WORTH-DESIGN.md#13-performance)).
 */
export function quantityHeldOn(timeline: QuantityTimeline, on: IsoDate): Qty {
  const at = lastIndexOnOrBefore(timeline, on);
  return at < 0 ? Quantity.zero() : timeline[at]!.quantity;
}

/**
 * The index of the greatest checkpoint dated `<= on`, or `-1`.
 *
 * Requires the timeline to be ascending, which `replay()` guarantees: it folds
 * in `sortByReplayOrder` and appends one checkpoint as each date closes.
 */
function lastIndexOnOrBefore(timeline: QuantityTimeline, on: IsoDate): number {
  let low = 0;
  let high = timeline.length - 1;
  let found = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (compareDates(timeline[mid]!.on, on) <= 0) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return found;
}

/**
 * The naive form, **exported only so a test can prove it wrong**.
 *
 * `Σ quantity where trade_date <= T`, ignoring every ratio. It is the
 * implementation `quantityHeldOn` exists to avoid, and having it in the suite
 * means the difference is asserted rather than described (I-46).
 */
export function naiveQuantitySum(
  txns: readonly { readonly tradeDate: IsoDate; readonly quantity: Qty | null }[],
  on: IsoDate,
): Qty {
  let units = 0n;
  for (const txn of txns) {
    if (txn.quantity === null) continue;
    if (compareDates(txn.tradeDate, on) > 0) continue;
    units += txn.quantity.units;
  }
  return Quantity.fromUnits(units);
}
