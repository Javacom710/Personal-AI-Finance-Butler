/**
 * Financial-health metrics
 * ([FINANCIAL-DOMAIN.md §8.1](../../../../docs/FINANCIAL-DOMAIN.md#81-financial-health-metrics)).
 *
 * ```
 * expenseRatio        = expenses / income                      (period)
 * avgMonthlyExpenses  = Σ expenses over N complete months / N
 * runwayMonths        = max(liquidCash, 0) / avgMonthlyExpenses
 * commitmentCoverage  = max(liquidCash, 0) / Σ commitments due in the window
 * ```
 *
 * Savings rate is the fourth metric of the set and already lives in
 * `cashflow.ts`; it is not recomputed here (FINANCIAL-DOMAIN.md §10.5 — one
 * implementation per concept).
 *
 * Every ratio goes through `ratio()`, so a zero denominator is `null` with a
 * reason and never `0` or `Infinity`. The reasons are chosen to be *different*
 * for the cases a reader must tell apart: no spending history at all is
 * `no_data`; a history with nothing spent, or a window with nothing due, is
 * `divide_by_zero`.
 *
 * `runwayMonths` and `commitmentCoverage` are plain multiples carried as a
 * `Rate` — 4.5 months, 3.2× — for the reason concentration's HHI is: so neither
 * can be mistaken for a money figure. They are **not** percentages and must be
 * rendered with `formatRate`, not `formatPercent`.
 *
 * Pure.
 */

import { Money as MoneyCtor, divInt, isZero, sum, type CurrencyCode, type Money } from '../../../lib/decimal/money';
import type { Rate } from '../../../lib/decimal/rate';
import { unavailable, type Metric } from '../../../lib/metric';
import type { CashflowSummary } from './cashflow';
import { ratio } from './ratio';

/** `expenses / income`. The complement of the savings rate; above 1 means spending outran income. */
export function expenseRatio(summary: Pick<CashflowSummary, 'income' | 'expenses'>): Metric<Rate> {
  return isZero(summary.income) ? unavailable('divide_by_zero') : ratio(summary.expenses, summary.income);
}

export interface TrailingExpenses {
  /** Complete calendar months in the window. The current, partial month is never one of them. */
  readonly months: number;
  /** Ledger entries of any kind in the window — distinguishes "nothing recorded" from "nothing spent". */
  readonly entryCount: number;
  /** Positive magnitude, base currency. */
  readonly expenses: Money;
}

/**
 * Mean monthly spending over the window, rounded `half_up` once.
 *
 * `no_data` when the window holds no entries at all: an average of an unrecorded
 * period is not zero spending, it is no information.
 */
export function averageMonthlyExpenses(trailing: TrailingExpenses): Metric<Money> {
  if (!Number.isInteger(trailing.months) || trailing.months < 1) {
    throw new RangeError(`averageMonthlyExpenses: months must be a positive integer, got ${trailing.months}`);
  }
  if (trailing.entryCount === 0) return unavailable('no_data');
  return { value: divInt(trailing.expenses, trailing.months, 'half_up') };
}

/** Cash that can be spent. An overdrawn total buys no time, so it floors at zero. */
function spendable(liquidCash: Money): Money {
  return liquidCash.minor < 0n ? MoneyCtor.zero(liquidCash.currency) : liquidCash;
}

/**
 * Months the liquid cash would last at the trailing average spend, with no
 * income. A statement about the past rate of spending, not a forecast.
 */
export function runwayMonths(liquidCash: Money, average: Metric<Money>): Metric<Rate> {
  if (average.value === null) return unavailable(average.reason);
  return ratio(spendable(liquidCash), average.value);
}

export interface Commitment {
  /** Positive magnitude, base currency. */
  readonly amount: Money;
}

export interface CommitmentCoverage {
  readonly liquidCash: Money;
  readonly commitmentsDue: Money;
  readonly commitmentCount: number;
  /** `liquidCash / commitmentsDue` as a multiple. `divide_by_zero` when nothing is due. */
  readonly coverage: Metric<Rate>;
  /** `liquidCash − commitmentsDue`. Negative means the window is not covered. */
  readonly surplus: Money;
}

/**
 * Liquid cash against the recurring outflows already scheduled in a window.
 *
 * Income expected in the same window is deliberately **not** netted off: this
 * answers "could I meet these if nothing else arrived?", which is the cautious
 * reading of "how much cash do I have relative to my upcoming obligations".
 */
export function commitmentCoverage(
  liquidCash: Money,
  commitments: readonly Commitment[],
  base: CurrencyCode,
): CommitmentCoverage {
  const due = sum(
    commitments.map((c) => c.amount),
    base,
  );
  return {
    liquidCash,
    commitmentsDue: due,
    commitmentCount: commitments.length,
    coverage: ratio(spendable(liquidCash), due),
    surplus: MoneyCtor.fromMinor(liquidCash.minor - due.minor, base),
  };
}
