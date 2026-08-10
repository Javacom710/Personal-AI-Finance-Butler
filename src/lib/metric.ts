/**
 * Missing data propagates as `null` with a reason, never as zero
 * (FINANCIAL-DOMAIN.md §10.3).
 *
 * Zero and "unknown" are different financial statements. A savings rate of 0%
 * means nothing was saved; `null` means the question cannot be answered — with
 * no income there is nothing to take a percentage of. Rendering `null` as `0`
 * is a correctness defect, not a display choice, so the reason travels with the
 * value all the way to the screen and to the AI tool result.
 *
 * Every `null` path has a test that asserts **the reason**, not merely the
 * `null` — a test asserting only `null` would pass against a function that
 * always failed.
 */

import type { Rate } from './decimal/rate';

export type MetricUnavailable =
  /** No records in the period at all. */
  | 'no_data'
  /** e.g. a savings rate with zero income, or budget utilisation of a zero budget. */
  | 'divide_by_zero'
  /** XIRR: all cash flows share a sign, so no rate can solve it. */
  | 'no_sign_change'
  /** XIRR: the solver did not converge within its bracket. */
  | 'did_not_converge'
  /** TWR: fewer valuation points than the method needs. */
  | 'insufficient_price_history'
  | 'no_fx_rate'
  | 'no_price'
  /**
   * The answer is real but not representable — a savings rate of −10,000,000×
   * from ₹0.0001 of income against real spending exceeds `NUMERIC(20,10)`.
   *
   * Added during Phase 3 after a property test produced it: the alternative was
   * a `RangeError` thrown from a read path, which would take the money page down
   * rather than render an em dash. Clamping was rejected — a clamped ratio is a
   * wrong number presented as a right one.
   */
  | 'out_of_range';

export type Metric<T> =
  | { readonly value: T; readonly reason?: undefined }
  | { readonly value: null; readonly reason: MetricUnavailable };

export function metric<T>(value: T): Metric<T> {
  return { value };
}

export function unavailable<T>(reason: MetricUnavailable): Metric<T> {
  return { value: null, reason };
}

export function isAvailable<T>(m: Metric<T>): m is { value: T; reason?: undefined } {
  return m.value !== null;
}

/** Human-readable text for a reason. Used by the UI tooltip and by AI tool output. */
export const METRIC_REASON_TEXT: Record<MetricUnavailable, string> = {
  no_data: 'no records in this period',
  divide_by_zero: 'the denominator is zero',
  no_sign_change: 'every cash flow has the same sign',
  did_not_converge: 'the solver did not converge',
  insufficient_price_history: 'not enough price history',
  no_fx_rate: 'no exchange rate for that date',
  no_price: 'no price available',
  out_of_range: 'the result is too large to represent exactly',
};

/**
 * A total computed over a set with gaps (FINANCIAL-DOMAIN.md §10.4).
 *
 * A portfolio value that silently omits two holdings is a worse answer than one
 * that says so, which is why `coverage` and the identity of what was left out
 * travel with the figure rather than being discarded at the boundary.
 */
export interface EntityRef {
  readonly type: string;
  readonly id: string;
  readonly label?: string;
}

export interface Covered<T> {
  readonly value: T;
  readonly coverage: Rate;
  readonly excluded: readonly EntityRef[];
}
