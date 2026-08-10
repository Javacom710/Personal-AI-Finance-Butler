/**
 * The one place two `Money` figures become a `Rate`.
 *
 * Savings rate, budget utilisation and every period-over-period percentage go
 * through this function, so two rules are written once rather than at each
 * caller:
 *
 * 1. **A zero denominator yields `null` with a reason**, never `0` and never
 *    `Infinity` (FINANCIAL-DOMAIN.md §10.3).
 * 2. **A quotient too large for `NUMERIC(20,10)` yields `null` too.** ₹0.0001 of
 *    income against real spending produces a savings rate of several billion,
 *    which `Rate` cannot hold. Returning `out_of_range` keeps that a rendered em
 *    dash rather than a `RangeError` thrown out of a page render, and clamping
 *    was rejected because a clamped ratio is a wrong number that looks right.
 */

import { divRound, pow10, type Rounding } from '../../../lib/decimal/rounding';
import { RATE_MAX_VALUE, RATE_SCALE, Rate } from '../../../lib/decimal/rate';
import { isZero, type Money } from '../../../lib/decimal/money';
import { metric, unavailable, type Metric } from '../../../lib/metric';

const RATE_UNIT = pow10(RATE_SCALE);

/**
 * `numerator / denominator` as a `Rate`.
 *
 * Rounding is `half_up` by default and named at every call site that differs,
 * per ADR-04's rule that no lossy operation has a silent default.
 */
export function ratio(
  numerator: Money,
  denominator: Money,
  rounding: Rounding = 'half_up',
): Metric<Rate> {
  if (numerator.currency !== denominator.currency) {
    throw new TypeError(
      `ratio: cannot divide ${numerator.currency} by ${denominator.currency}. Convert through the FX module first.`,
    );
  }
  if (isZero(denominator)) return unavailable('divide_by_zero');
  return fromQuotient(numerator.minor, denominator.minor, rounding);
}

/** `a / b` at `RATE_SCALE`, from two scaled integers. Throws on a zero divisor. */
export function divideToRate(a: bigint, b: bigint, rounding: Rounding = 'half_up'): Rate {
  if (b === 0n) throw new RangeError('divideToRate: division by zero');
  return Rate.fromValue(divRound(a * RATE_UNIT, b, rounding));
}

/** A whole-number ratio as a `Rate`, e.g. days elapsed over days in the period. */
export function ratioOfCounts(a: number, b: number, rounding: Rounding = 'half_up'): Metric<Rate> {
  if (!Number.isInteger(a) || !Number.isInteger(b)) {
    throw new TypeError(`ratioOfCounts: expected whole numbers, got ${a} and ${b}`);
  }
  if (b === 0) return unavailable('divide_by_zero');
  return fromQuotient(BigInt(a), BigInt(b), rounding);
}

/**
 * Subtract one rate from another, reporting an unrepresentable result rather
 * than throwing. Budget pace is `utilization − timeElapsed`, and a utilisation
 * near the top of the range can push the difference past it.
 */
export function subtractRates(a: Rate, b: Rate): Metric<Rate> {
  return inRange(a.value - b.value);
}

function fromQuotient(a: bigint, b: bigint, rounding: Rounding): Metric<Rate> {
  return inRange(divRound(a * RATE_UNIT, b, rounding));
}

function inRange(value: bigint): Metric<Rate> {
  const magnitude = value < 0n ? -value : value;
  if (magnitude > RATE_MAX_VALUE) return unavailable('out_of_range');
  return metric(Rate.fromValue(value));
}
