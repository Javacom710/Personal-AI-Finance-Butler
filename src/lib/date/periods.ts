/**
 * Period boundaries (FINANCIAL-DOMAIN.md §6).
 *
 * A budget period, a cash-flow window and a comparison range are all the same
 * thing: an inclusive pair of calendar dates. They are computed here rather than
 * at each call site, because a report and a budget that disagree about when
 * "this month" ends produce two different numbers for the same question.
 *
 * The fiscal year start is a setting (`settings.fiscal_year_start_month`,
 * default 4 — April, the Indian convention). Quarters are aligned to it rather
 * than to January, so an Indian Q1 is Apr–Jun. Monthly periods are calendar
 * months regardless: a "monthly" budget runs a calendar month.
 */

import { addDays, addMonths, compareDates, daysBetween, fromParts, toParts, type IsoDate } from './index';

export type PeriodKind = 'monthly' | 'quarterly' | 'yearly';

export const PERIOD_KINDS: readonly PeriodKind[] = ['monthly', 'quarterly', 'yearly'];

/** An inclusive calendar range. `from <= to` always. */
export interface DateRange {
  readonly from: IsoDate;
  readonly to: IsoDate;
}

export function dateRange(from: IsoDate, to: IsoDate): DateRange {
  if (compareDates(from, to) > 0) {
    throw new RangeError(`dateRange: ${from} is after ${to}`);
  }
  return { from, to };
}

/** Inclusive on both ends, so a single-day range has a length of 1. */
export function daysInRange(range: DateRange): number {
  return daysBetween(range.from, range.to) + 1;
}

export function rangeContains(range: DateRange, d: IsoDate): boolean {
  return compareDates(d, range.from) >= 0 && compareDates(d, range.to) <= 0;
}

function assertFiscalMonth(month: number): void {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`fiscalYearStartMonth must be 1..12, got ${month}`);
  }
}

/** The first and last day of the calendar month containing `d`. */
export function monthRange(d: IsoDate): DateRange {
  const { year, month } = toParts(d);
  const from = fromParts(year, month, 1);
  return { from, to: addDays(addMonths(from, 1), -1) };
}

/**
 * The fiscal quarter containing `d`, aligned to the fiscal year start.
 *
 * With a start month of April, the quarters are Apr–Jun, Jul–Sep, Oct–Dec and
 * Jan–Mar. With a start month of January they are the calendar quarters.
 */
export function quarterRange(d: IsoDate, fiscalYearStartMonth: number): DateRange {
  assertFiscalMonth(fiscalYearStartMonth);
  const { year, month } = toParts(d);

  // Months since the fiscal year start, 0..11 — then how far into its quarter
  // this month sits. Stepping back by `offset` itself would land on the start of
  // the fiscal *year*, not the start of the quarter.
  const offset = (month - fiscalYearStartMonth + 12) % 12;
  const monthsIntoQuarter = offset % 3;

  const from = addMonths(fromParts(year, month, 1), -monthsIntoQuarter);
  return { from, to: addDays(addMonths(from, 3), -1) };
}

/**
 * The fiscal year containing `d`. With a start month of April, 2026-03-31 falls
 * in the year that began 2025-04-01.
 */
export function fiscalYearRange(d: IsoDate, fiscalYearStartMonth: number): DateRange {
  assertFiscalMonth(fiscalYearStartMonth);
  const { year, month } = toParts(d);
  const startYear = month >= fiscalYearStartMonth ? year : year - 1;
  const from = fromParts(startYear, fiscalYearStartMonth, 1);
  return { from, to: addDays(addMonths(from, 12), -1) };
}

/** The period of the given kind that contains `d`. */
export function periodContaining(
  d: IsoDate,
  kind: PeriodKind,
  fiscalYearStartMonth: number,
): DateRange {
  switch (kind) {
    case 'monthly':
      return monthRange(d);
    case 'quarterly':
      return quarterRange(d, fiscalYearStartMonth);
    case 'yearly':
      return fiscalYearRange(d, fiscalYearStartMonth);
  }
}

const MONTHS_PER_PERIOD: Record<PeriodKind, number> = { monthly: 1, quarterly: 3, yearly: 12 };

/** Shift a period by `n` whole periods. `-1` is the immediately preceding one. */
export function shiftPeriod(
  range: DateRange,
  kind: PeriodKind,
  n: number,
  fiscalYearStartMonth: number,
): DateRange {
  return periodContaining(addMonths(range.from, MONTHS_PER_PERIOD[kind] * n), kind, fiscalYearStartMonth);
}

export function previousPeriod(
  range: DateRange,
  kind: PeriodKind,
  fiscalYearStartMonth: number,
): DateRange {
  return shiftPeriod(range, kind, -1, fiscalYearStartMonth);
}

/**
 * Every period of `kind` that overlaps `[from, to]`, in order.
 *
 * Used to lay a budget's periods over its active window, and to build a monthly
 * series for a cash-flow chart.
 */
export function periodsBetween(
  range: DateRange,
  kind: PeriodKind,
  fiscalYearStartMonth: number,
): DateRange[] {
  const out: DateRange[] = [];
  let current = periodContaining(range.from, kind, fiscalYearStartMonth);

  // Bounded so a malformed range cannot loop forever: 12 monthly periods a year
  // over a century is 1,200, and nothing legitimate approaches it.
  for (let guard = 0; guard < 2000; guard += 1) {
    out.push(current);
    if (compareDates(current.to, range.to) >= 0) return out;
    current = shiftPeriod(current, kind, 1, fiscalYearStartMonth);
  }
  throw new RangeError('periodsBetween: range is implausibly long');
}

/**
 * How far through a period a given date is, as a day count.
 *
 * `daysElapsed` counts the days up to and including `asOf`, clamped to the
 * period: a date after the period end reports the whole period, and a date
 * before it reports zero. Budget pace depends on this clamping being here
 * rather than being reinvented per call site.
 */
export function elapsedInPeriod(
  range: DateRange,
  asOf: IsoDate,
): { readonly daysElapsed: number; readonly daysTotal: number } {
  const daysTotal = daysInRange(range);
  if (compareDates(asOf, range.from) < 0) return { daysElapsed: 0, daysTotal };
  if (compareDates(asOf, range.to) >= 0) return { daysElapsed: daysTotal, daysTotal };
  return { daysElapsed: daysBetween(range.from, asOf) + 1, daysTotal };
}

/** A short human label: "August 2026", "Q2 FY2026-27", "FY2026-27". */
export function periodLabel(range: DateRange, kind: PeriodKind, fiscalYearStartMonth: number): string {
  const { year, month } = toParts(range.from);

  if (kind === 'monthly') {
    return `${MONTH_NAMES[month - 1]} ${year}`;
  }

  const fiscal = fiscalYearRange(range.from, fiscalYearStartMonth);
  const fiscalStartYear = toParts(fiscal.from).year;
  // A fiscal year starting in January is a calendar year; anything else spans two.
  const yearLabel =
    fiscalYearStartMonth === 1
      ? `${fiscalStartYear}`
      : `${fiscalStartYear}-${String((fiscalStartYear + 1) % 100).padStart(2, '0')}`;

  if (kind === 'yearly') return `FY${yearLabel}`;

  const quarterIndex = Math.floor(((month - fiscalYearStartMonth + 12) % 12) / 3) + 1;
  return `Q${quarterIndex} FY${yearLabel}`;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
