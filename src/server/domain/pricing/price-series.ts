/**
 * The indexed historical-price lookup — a **V1 requirement, not an optimisation**
 * ([MARKET-VALUE-NET-WORTH-DESIGN.md §13](../../../../docs/MARKET-VALUE-NET-WORTH-DESIGN.md#13-performance)).
 *
 * A market-value net-worth series folds one price lookup per instrument **per
 * point**. Answering *"the greatest `as_of <= T`"* by scanning the whole series
 * each time is `O(points × observations)`, and the Phase 6.11 measurement is
 * unambiguous about what that costs at realistic volumes:
 *
 * | 365-point market-value series | |
 * |---|---|
 * | naive linear scan | **1,156 ms** |
 * | sorted once, binary-searched per point | **123 ms** |
 *
 * That 9× is the whole reason `net_worth_snapshots` was closed rather than built
 * ([ADR-24](../../../../docs/DECISIONS.md#adr-24--net-worth-is-derived-on-demand-snapshots-are-deferred-to-phase-6),
 * OD-15): the cost was an implementation choice, not a property of the problem,
 * and a second stored representation of a derived figure is not the answer to a
 * missing sort.
 *
 * Pure — the caller fetches the rows, this decides which one applies. The
 * **rule** is unchanged from `closeAsOf`, deliberately:
 *
 * - the greatest observation dated `<= on`, **bounded** by the carry-back limit;
 * - never interpolated, and never a later price for an earlier date — both would
 *   make a historical figure move as new data arrives;
 * - beyond the bound the point is a **gap**, never a carried-forward value.
 */

import { compareDates, daysBetween, isoDate, type IsoDate } from '../../../lib/date';
import { UnitPrice } from '../../../lib/decimal/price';
import { CONTINUOUS_BACKSTOP_DAYS, SESSION_BACKSTOP_DAYS } from '../../market-data/freshness';
import type { Cadence } from '../../market-data/types';

/** One stored observation, as the repository returns it. */
export interface CloseObservation {
  readonly asOf: string;
  readonly close: string;
}

export interface CarriedClose {
  readonly close: UnitPrice;
  readonly asOf: IsoDate;
  /** Days between the close's session and the date asked for. Zero on an exact hit. */
  readonly carriedDays: number;
}

/** How far back a close may be carried before the point becomes a gap. */
export function carryBackLimitDays(cadence: Cadence): number {
  return cadence === 'continuous' ? CONTINUOUS_BACKSTOP_DAYS : SESSION_BACKSTOP_DAYS;
}

export interface PriceSeriesIndex {
  /** The close in force on `on`, or `null` when the point is a gap. */
  closeAsOf(on: IsoDate): CarriedClose | null;
  /** Observations held. Reported so the benchmark can state what it searched. */
  readonly size: number;
  /**
   * Observations actually examined since the index was built — `O(log n)` per
   * lookup rather than `O(n)`. Measured rather than asserted, so the design's
   * 9× claim is a number this code produces and not a note in a document.
   */
  readonly scanned: number;
}

/**
 * Sort once, binary-search per point.
 *
 * The input need not be sorted and is never mutated: the repository's array
 * belongs to the caller, and a fold that reordered it in place would leave a
 * second consumer looking at data it did not ask for.
 */
export function indexCloses(
  series: readonly CloseObservation[],
  cadence: Cadence,
): PriceSeriesIndex {
  const limit = carryBackLimitDays(cadence);
  const points = series
    .map((point) => ({ asOf: isoDate(point.asOf), close: point.close }))
    .sort((a, b) => compareDates(a.asOf, b.asOf));

  let scanned = 0;

  return {
    size: points.length,
    get scanned() {
      return scanned;
    },
    closeAsOf(on: IsoDate): CarriedClose | null {
      let low = 0;
      let high = points.length - 1;
      let found = -1;

      while (low <= high) {
        const mid = (low + high) >> 1;
        scanned += 1;
        if (compareDates(points[mid]!.asOf, on) <= 0) {
          found = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }

      if (found < 0) return null;
      const best = points[found]!;

      // `daysBetween` is the domain's epoch-day arithmetic, already property-tested
      // across leap years and month ends. Hand-rolling it with `Date.UTC` would
      // silently overflow a month boundary — 31 January plus a one-indexed month is
      // 3 March — and the bound would be wrong on exactly the dates that matter.
      const carriedDays = daysBetween(best.asOf, on);
      if (carriedDays > limit) return null;

      return { close: UnitPrice.fromDbString(best.close), asOf: best.asOf, carriedDays };
    },
  };
}

/**
 * The close in force on `on`, for a caller that asks once.
 *
 * The same rule as the index, expressed through it, so there is one definition
 * of *"greatest `as_of <= on`, bounded"* rather than two that can drift
 * ([FINANCIAL-DOMAIN.md §10.5](../../../../docs/FINANCIAL-DOMAIN.md#105-single-implementation-per-concept)).
 * A series folded over many dates must build the index once instead of calling
 * this per point — that is the difference the measurement above records.
 */
export function closeAsOf(
  series: readonly CloseObservation[],
  on: IsoDate,
  cadence: Cadence,
): CarriedClose | null {
  return indexCloses(series, cadence).closeAsOf(on);
}
