/**
 * XIRR — money-weighted return
 * ([INVESTMENT-DOMAIN.md §7](../../../../docs/INVESTMENT-DOMAIN.md#7-xirr)).
 *
 * This is the **one place `number` is used** for a financial quantity
 * ([ADR-04](../../../../docs/DECISIONS.md#adr-04--money-is-an-exact-scaled-integer-never-a-float)).
 * `Money` values are converted at the module boundary, the solver runs in
 * floating point — correct, because root-finding is not accounting — and the
 * resulting rate is rounded to 6 decimal places and returned as a `Rate`. **No
 * monetary value ever comes back out of this module.**
 *
 * XIRR is the headline return figure, because it is the only one that handles
 * both the size and the timing of every flow. `totalReturnPct` is a supporting
 * figure with a known weakness: `costDeployed` accumulates across round trips,
 * so buying and selling the same ₹10,000 ten times shows ₹100,000 deployed.
 *
 * Day count: **actual/365 fixed**, documented on screen next to the figure.
 */

import { daysBetween, type IsoDate } from '../../../lib/date';
import { Rate } from '../../../lib/decimal/rate';
import { toMinorNumber, type Money } from '../../../lib/decimal/money';
import { metric, unavailable, type Metric } from '../../../lib/metric';

export interface CashFlow {
  readonly on: IsoDate;
  /**
   * From the **investor's** perspective: negative is money out (a purchase, a
   * standalone fee), positive is money back (sale proceeds, a dividend, and the
   * terminal market value of what is still held).
   */
  readonly amount: Money;
}

const DAYS_PER_YEAR = 365;
const TOLERANCE = 1e-7;
const MAX_ITERATIONS = 100;
const SEED = 0.1;
const BRACKET_LOW = -0.9999;
const BRACKET_HIGH = 10;

/**
 * Solve `NPV(r) = Σ cf_i / (1+r)^(d_i/365) = 0`.
 *
 * Newton–Raphson seeded at 10%, with a bisection fallback over
 * `[-0.9999, 10]` whenever Newton diverges or leaves the bracket. Tolerance is
 * on NPV **as a fraction of total inflow**, so a ₹1 residual is judged against
 * the size of the portfolio rather than against an absolute threshold that would
 * be trivially met by a small one and unreachable by a large one.
 *
 * Returns `null` **with its reason** in each of the four documented cases. A
 * test asserting only `null` would pass against a function that always failed,
 * which is why every one of them asserts the reason too.
 */
export function xirr(flows: readonly CashFlow[]): Metric<Rate> {
  if (flows.length < 2) return unavailable('no_data');

  const ordered = [...flows].sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));
  const start = ordered[0]!.on;

  const amounts = ordered.map((f) => toMinorNumber(f.amount));
  const years = ordered.map((f) => daysBetween(start, f.on) / DAYS_PER_YEAR);

  if (years.every((y) => y === years[0])) return unavailable('no_data');

  const hasPositive = amounts.some((a) => a > 0);
  const hasNegative = amounts.some((a) => a < 0);
  // With every flow the same sign there is no root: NPV is monotone and never
  // crosses zero. Reporting 0% here would say "you broke even", which is false.
  if (!hasPositive || !hasNegative) return unavailable('no_sign_change');

  const scale = amounts.reduce((acc, a) => acc + (a > 0 ? a : 0), 0);
  const tolerance = Math.max(scale, 1) * TOLERANCE;

  const npv = (rate: number): number => {
    let total = 0;
    for (let i = 0; i < amounts.length; i += 1) {
      total += amounts[i]! / (1 + rate) ** years[i]!;
    }
    return total;
  };

  const derivative = (rate: number): number => {
    let total = 0;
    for (let i = 0; i < amounts.length; i += 1) {
      const t = years[i]!;
      if (t === 0) continue;
      total -= (t * amounts[i]!) / (1 + rate) ** (t + 1);
    }
    return total;
  };

  const newton = solveNewton(npv, derivative, tolerance);
  const solved = newton ?? solveBisection(npv, tolerance);
  if (solved === null) return unavailable('did_not_converge');

  // Six decimal places: 0.0725 is 7.25%, and the seventh digit of an
  // annualised return is noise from a floating-point solver, not information.
  const rounded = Math.round(solved * 1e6) / 1e6;
  return metric(Rate.of(rounded.toFixed(10)));
}

/**
 * The NPV tolerance is an **acceptance** test, not an early exit.
 *
 * Stopping the moment `|NPV| < tolerance` looks equivalent and is not: the rate
 * error it permits is `tolerance / |dNPV/dr|`, and that derivative shrinks as
 * the rate grows. On a `−1000 → +5000` series it let the solver stop 2.5×10⁻⁶
 * away from the root and report **399.9999%** where the answer is 400%. So the
 * loop runs until the *rate* stops moving, and the tolerance then decides
 * whether the fixed point it found is actually a root.
 */
const RATE_CONVERGENCE = 1e-13;

function solveNewton(
  npv: (r: number) => number,
  derivative: (r: number) => number,
  tolerance: number,
): number | null {
  let rate = SEED;
  for (let i = 0; i < MAX_ITERATIONS; i += 1) {
    const value = npv(rate);
    if (!Number.isFinite(value)) return null;

    const slope = derivative(rate);
    if (!Number.isFinite(slope) || slope === 0) return null;

    const next = rate - value / slope;
    // Leaving the bracket means Newton has run off; bisection takes over rather
    // than the loop wandering for another ninety iterations.
    if (!Number.isFinite(next) || next <= BRACKET_LOW || next > BRACKET_HIGH) return null;

    const settled = Math.abs(next - rate) < RATE_CONVERGENCE * Math.max(1, Math.abs(rate));
    rate = next;
    if (settled) return Math.abs(npv(rate)) < tolerance ? rate : null;
  }
  return Math.abs(npv(rate)) < tolerance ? rate : null;
}

function solveBisection(npv: (r: number) => number, tolerance: number): number | null {
  let low = BRACKET_LOW;
  let high = BRACKET_HIGH;
  let valueLow = npv(low);
  const valueHigh = npv(high);
  if (!Number.isFinite(valueLow) || !Number.isFinite(valueHigh)) return null;
  // No sign change across the bracket means the root, if any, lies outside a
  // range this application can meaningfully report.
  if (valueLow * valueHigh > 0) return null;

  for (let i = 0; i < MAX_ITERATIONS * 10; i += 1) {
    const mid = (low + high) / 2;
    const value = npv(mid);
    if (!Number.isFinite(value)) return null;
    // Bisect until the bracket itself is narrower than the reported precision,
    // then accept only if the midpoint really is a root.
    if (high - low < RATE_CONVERGENCE * Math.max(1, Math.abs(mid))) {
      return Math.abs(value) < tolerance ? mid : null;
    }
    if (valueLow * value <= 0) {
      high = mid;
    } else {
      low = mid;
      valueLow = value;
    }
  }
  return null;
}
