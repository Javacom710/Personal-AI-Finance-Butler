/**
 * Time-weighted return — Modified Dietz per sub-period, chain-linked
 * ([INVESTMENT-DOMAIN.md §8](../../../../docs/INVESTMENT-DOMAIN.md#8-time-weighted-return)).
 *
 * ```
 * For each sub-period [t_{i-1}, t_i] bounded by external cash-flow dates:
 *   r_i = (V_i − V_{i-1} − C_i) / (V_{i-1} + Σ_j w_j·c_j)
 *         where C_i = net external flows in the period,
 *               w_j = (t_i − t_j) / (t_i − t_{i-1})
 *
 * TWR = Π(1 + r_i) − 1        (annualised over ≥1y: (1+TWR)^(365/days) − 1)
 * ```
 *
 * **Boundary convention: a flow dated `D` belongs to the period *starting* at
 * `D`.** Sub-period `i` is the half-open interval `(t_{i−1}, t_i]`, valued at
 * each boundary's close. This is stated, and pinned by a test against the figure
 * the opposite convention would produce, because the choice must be deliberate
 * rather than an artefact of how the loop was written.
 *
 * ## The launch limitation, which is not a defect
 *
 * TWR needs a valuation at every sub-period boundary, which needs
 * `instrument_prices` history. That table is populated by
 * `getHistoricalPrices()`, which needs the commercial provider blocked on
 * decision **OD-3**. Until it is resolved, only manually priced instruments and
 * AMFI-sourced mutual funds can produce a figure — **every equity and ETF
 * returns `null` with reason `insufficient_price_history`.**
 *
 * That is the documented behaviour, shown in the UI as the reason. It is not
 * grounds for substituting a partial figure computed from the valuations that do
 * exist: a chain-linked return with a missing link is not a smaller-sample
 * answer, it is a wrong one.
 */

import { daysBetween, type IsoDate } from '../../../lib/date';
import { toMinorNumber, type Money } from '../../../lib/decimal/money';
import { Rate } from '../../../lib/decimal/rate';
import { metric, unavailable, type Metric } from '../../../lib/metric';

/** A portfolio valuation on a date. One is required at every sub-period boundary. */
export interface Valuation {
  readonly on: IsoDate;
  readonly value: Money;
}

/** An external flow — money into or out of the portfolio, not within it. */
export interface ExternalFlow {
  readonly on: IsoDate;
  /** Positive is a contribution, negative a withdrawal. */
  readonly amount: Money;
}

export interface TwrInput {
  readonly from: IsoDate;
  readonly to: IsoDate;
  /** Must include a valuation on `from`, on `to`, and on every flow date. */
  readonly valuations: readonly Valuation[];
  readonly flows: readonly ExternalFlow[];
  /** Annualise when the window is at least a year. Defaults to true. */
  readonly annualise?: boolean;
}

export interface TwrResult {
  readonly twr: Rate;
  readonly annualised: boolean;
  readonly subPeriods: number;
  readonly days: number;
}

const DAYS_PER_YEAR = 365;

export function twr(input: TwrInput): Metric<TwrResult> {
  const { from, to } = input;
  const totalDays = daysBetween(from, to);
  if (totalDays <= 0) return unavailable('no_data');

  const valueOn = new Map(input.valuations.map((v) => [v.on, v.value]));

  // A boundary at every flow date, plus the two ends. Sorted and de-duplicated,
  // so two flows on one date collapse to a single boundary — which is the case
  // the weighted Modified Dietz form below is retained for.
  const boundaries = [...new Set([from, to, ...input.flows.map((f) => f.on)])]
    .filter((d) => d >= from && d <= to)
    .sort();

  for (const boundary of boundaries) {
    if (!valueOn.has(boundary)) return unavailable('insufficient_price_history');
  }
  if (boundaries.length < 2) return unavailable('insufficient_price_history');

  let chained = 1;

  for (let i = 1; i < boundaries.length; i += 1) {
    const openOn = boundaries[i - 1]!;
    const closeOn = boundaries[i]!;
    const opening = toMinorNumber(valueOn.get(openOn)!);
    const closing = toMinorNumber(valueOn.get(closeOn)!);
    const spanDays = daysBetween(openOn, closeOn);
    if (spanDays <= 0) continue;

    // A flow dated D belongs to the period STARTING at D — so the flow on
    // `openOn` is inside this sub-period, and the one on `closeOn` is not.
    const inPeriod = input.flows.filter((f) => f.on >= openOn && f.on < closeOn);

    let netFlow = 0;
    let weighted = 0;
    for (const flow of inPeriod) {
      const amount = toMinorNumber(flow.amount);
      netFlow += amount;
      // w = (t_i − t_j) / (t_i − t_{i−1}); a flow on the opening boundary is
      // present for the whole period, so its weight is 1.
      weighted += amount * (daysBetween(flow.on, closeOn) / spanDays);
    }

    const denominator = opening + weighted;
    if (denominator === 0) {
      // A period that starts empty and is funded on its first day has no capital
      // at risk to measure a return against. It contributes a factor of 1 only
      // when it also ended empty; otherwise the series cannot be chained.
      if (closing - opening - netFlow === 0) continue;
      return unavailable('divide_by_zero');
    }

    chained *= 1 + (closing - opening - netFlow) / denominator;
    if (!Number.isFinite(chained)) return unavailable('did_not_converge');
  }

  const raw = chained - 1;
  const shouldAnnualise = (input.annualise ?? true) && totalDays >= DAYS_PER_YEAR;
  if (!shouldAnnualise) {
    return metric({
      twr: toRate(raw),
      annualised: false,
      subPeriods: boundaries.length - 1,
      days: totalDays,
    });
  }

  // (1 + TWR)^(365/days) − 1. A total factor at or below zero — the portfolio
  // was wiped out — has no real annualised root, and reporting −100% p.a. for a
  // −100% total would be a coincidence rather than a calculation.
  if (chained <= 0) return unavailable('did_not_converge');
  const annualisedValue = chained ** (DAYS_PER_YEAR / totalDays) - 1;
  if (!Number.isFinite(annualisedValue)) return unavailable('did_not_converge');

  return metric({
    twr: toRate(annualisedValue),
    annualised: true,
    subPeriods: boundaries.length - 1,
    days: totalDays,
  });
}

/** Six decimal places, matching XIRR — the seventh digit is solver noise. */
function toRate(value: number): Rate {
  return Rate.of((Math.round(value * 1e6) / 1e6).toFixed(10));
}
