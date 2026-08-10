/**
 * Budget status (FINANCIAL-DOMAIN.md §6).
 *
 * ```
 * budgetStatus(budget, period) = {
 *   budgeted, actual, remaining,
 *   utilization: actual / budgeted,                        // null when budgeted is zero
 *   daysElapsed, daysTotal,
 *   pace: (actual / budgeted) - (daysElapsed / daysTotal)   // > 0 = ahead of pace
 * }
 * ```
 *
 * Two rules the type system cannot state, so they are stated here:
 *
 * - **Only `kind='expense'` counts.** Transfers and income never do. The caller
 *   filters, and `totalsByGroup` in `cashflow.ts` makes that filter a required
 *   argument so it cannot be forgotten.
 * - **Over budget is a state, not an error.** Nothing is blocked, nothing
 *   throws; `isOverBudget` is a flag the UI colours.
 *
 * Deliberately not built: envelopes, rollover, zero-based budgeting, goal-linked
 * budgets (`CLAUDE.md` — "avoid complex budgeting methodologies unless
 * explicitly requested").
 */

import { cmp, isZero, sub, type Money } from '../../../lib/decimal/money';
import type { Rate } from '../../../lib/decimal/rate';
import { isAvailable, unavailable, type Metric } from '../../../lib/metric';
import { ratio, ratioOfCounts, subtractRates } from './ratio';

export interface BudgetStatusInput {
  /** The budget amount, already converted to base currency by the service. */
  readonly budgeted: Money;
  /** Actual spending in the period, as a positive magnitude, in the same currency. */
  readonly actual: Money;
  readonly daysElapsed: number;
  readonly daysTotal: number;
}

export interface BudgetStatus {
  readonly budgeted: Money;
  readonly actual: Money;
  /** Negative once the budget is exceeded — the overspend, not a floor at zero. */
  readonly remaining: Money;
  readonly utilization: Metric<Rate>;
  readonly daysElapsed: number;
  readonly daysTotal: number;
  /** `utilization − timeElapsed`. Positive means spending faster than the period is passing. */
  readonly pace: Metric<Rate>;
  readonly isOverBudget: boolean;
}

export function budgetStatus(input: BudgetStatusInput): BudgetStatus {
  const { budgeted, actual, daysElapsed, daysTotal } = input;

  if (budgeted.currency !== actual.currency) {
    throw new TypeError(
      `budgetStatus: budget is ${budgeted.currency} but spending is ${actual.currency}. ` +
        'Convert through the FX module before comparing.',
    );
  }

  // A zero budget cannot be created (`CHECK (amount > 0)`), but utilisation must
  // still be null-safe: a budget row could be reached through a fixture, an
  // import, or a future amount edit (FINANCIAL-DOMAIN.md §12, case 9).
  const utilization = isZero(budgeted) ? unavailable<Rate>('divide_by_zero') : ratio(actual, budgeted);
  const elapsed = ratioOfCounts(daysElapsed, daysTotal);

  // Written as nested conditionals returning the unavailable metric itself
  // rather than rebuilding it: the reason must survive, and re-deriving it is
  // how a `divide_by_zero` quietly becomes a `no_data` on the screen.
  const pace: Metric<Rate> = isAvailable(utilization)
    ? isAvailable(elapsed)
      ? subtractRates(utilization.value, elapsed.value)
      : elapsed
    : utilization;

  return {
    budgeted,
    actual,
    remaining: sub(budgeted, actual),
    utilization,
    daysElapsed,
    daysTotal,
    pace,
    isOverBudget: cmp(actual, budgeted) > 0,
  };
}
