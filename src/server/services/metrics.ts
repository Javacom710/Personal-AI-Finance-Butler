import 'server-only';

/**
 * Financial-health metrics on the read path
 * ([FINANCIAL-DOMAIN.md §8.1](../../../docs/FINANCIAL-DOMAIN.md#81-financial-health-metrics)).
 *
 * Holds no arithmetic. Each input is fetched through the service that already
 * owns it — period cash flow, the net-worth cash group, pending recurring
 * occurrences — and the figures come from `domain/calc/metrics.ts`. Liquid cash
 * is therefore *the same number* the Net Worth and Overview pages show, not a
 * second sum over accounts that could drift from it.
 */

import { addDays, addMonths, startOfMonth } from '../../lib/date';
import type { IsoDate } from '../../lib/date';
import { dateRange, periodContaining, type DateRange } from '../../lib/date/periods';
import { Money, type Money as MoneyValue } from '../../lib/decimal/money';
import type { Rate } from '../../lib/decimal/rate';
import { unavailable, type Metric } from '../../lib/metric';
import { ok, type DomainError, type Result } from '../../lib/result';
import {
  averageMonthlyExpenses,
  commitmentCoverage,
  expenseRatio,
  runwayMonths,
  type Commitment,
  type CommitmentCoverage,
} from '../domain/calc/metrics';
import type { ReadCtx } from './_ctx';
import { listAccounts } from './accounts';
import { periodSummary } from './cashflow';
import { netWorthReconciliation } from './networth';
import { DEFAULT_HORIZON_DAYS, pendingExpensesDue } from './recurring';

export const DEFAULT_TRAILING_MONTHS = 3;
export const DEFAULT_COMMITMENT_DAYS = 30;
const MAX_TRAILING_MONTHS = 24;

export interface FinancialMetricsOptions {
  /** Complete calendar months averaged for runway. Default 3, at most 24. */
  readonly trailingMonths?: number;
  /** How far ahead commitments are counted. Default 30, capped at the materialisation horizon. */
  readonly commitmentDays?: number;
}

export interface FinancialMetrics {
  readonly asOf: IsoDate;
  /** The current month, which `savingsRate` and `expenseRatio` describe. */
  readonly period: DateRange;
  readonly savingsRate: Metric<Rate>;
  readonly expenseRatio: Metric<Rate>;
  /** The net-worth `cash` group: cash, bank and wallet balances in credit. Excludes brokerage cash. */
  readonly liquidCash: MoneyValue;
  readonly trailing: {
    readonly range: DateRange;
    readonly months: number;
    readonly expenses: MoneyValue;
    readonly averageMonthlyExpenses: Metric<MoneyValue>;
  };
  /** A multiple, not a percentage — render with `format.rate`. */
  readonly runwayMonths: Metric<Rate>;
  readonly commitments: CommitmentCoverage & {
    readonly windowDays: number;
    /** Occurrences whose amount could not be converted to base. Non-zero makes `coverage` unavailable. */
    readonly unconvertedCount: number;
  };
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isInteger(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

export async function financialMetrics(
  ctx: ReadCtx,
  options: FinancialMetricsOptions = {},
): Promise<Result<FinancialMetrics, DomainError>> {
  const trailingMonths = clampInt(options.trailingMonths, DEFAULT_TRAILING_MONTHS, 1, MAX_TRAILING_MONTHS);
  const windowDays = clampInt(options.commitmentDays, DEFAULT_COMMITMENT_DAYS, 1, DEFAULT_HORIZON_DAYS);

  const period = periodContaining(ctx.today, 'monthly', ctx.fiscalYearStartMonth);
  // The N complete calendar months before this one. The current month is
  // excluded because a part-month would understate the average.
  const monthStart = startOfMonth(ctx.today);
  const trailingRange = dateRange(addMonths(monthStart, -trailingMonths), addDays(monthStart, -1));

  const [current, trailing, netWorth, pending, accounts] = await Promise.all([
    periodSummary(ctx, period),
    periodSummary(ctx, trailingRange),
    netWorthReconciliation(ctx),
    pendingExpensesDue(ctx, ctx.today, addDays(ctx.today, windowDays)),
    listAccounts(ctx, { includeInactive: true }),
  ]);
  if (!netWorth.ok) return netWorth;

  const liquidCash =
    netWorth.value.result.groups.find((g) => g.group === 'cash')?.total ?? Money.zero(ctx.base);

  // A recurring amount is in its account's currency; coverage is a base figure.
  const currencyOf = new Map(accounts.map((a) => [a.id, a.currency]));
  const due: Commitment[] = [];
  let unconvertedCount = 0;

  for (const expense of pending) {
    const currency = currencyOf.get(expense.accountId);
    const converted =
      currency === undefined ? null : ctx.fx.toBase(Money.of(expense.amountText, currency), ctx.today);
    if (converted === null || !converted.ok) {
      unconvertedCount += 1;
      continue;
    }
    due.push({ amount: converted.value.amount });
  }

  const average = averageMonthlyExpenses({
    months: trailingMonths,
    entryCount: trailing.entryCount,
    expenses: trailing.expenses,
  });
  const coverage = commitmentCoverage(liquidCash, due, ctx.base);

  return ok({
    asOf: ctx.today,
    period,
    savingsRate: current.savingsRate,
    expenseRatio: expenseRatio(current),
    liquidCash,
    trailing: {
      range: trailingRange,
      months: trailingMonths,
      expenses: trailing.expenses,
      averageMonthlyExpenses: average,
    },
    runwayMonths: runwayMonths(liquidCash, average),
    commitments: {
      ...coverage,
      // A ratio against a total known to be missing an obligation would
      // overstate the cover, so it is withheld rather than shown partial.
      coverage: unconvertedCount > 0 ? unavailable('no_fx_rate') : coverage.coverage,
      windowDays,
      unconvertedCount,
    },
  });
}
