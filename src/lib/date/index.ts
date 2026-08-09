/**
 * Calendar dates, kept deliberately separate from instants.
 *
 * A booking date, a trade date and a budget period are calendar dates — they
 * have no time and no zone (SCHEMA.md, Conventions). Representing them as
 * `Date` invites a timezone shift that silently moves a transaction to the
 * previous day, which is the single most common date bug in this class of
 * software. So a calendar date here is an ISO `YYYY-MM-DD` **string**, and the
 * only place a zone is consulted is when asking what "today" is for a user.
 *
 * Instants (`created_at`, `last_seen_at`, session expiry) stay as `Date`, which
 * is what they are.
 */

/** An ISO calendar date, `YYYY-MM-DD`. Branded so an arbitrary string cannot be passed as one. */
export type IsoDate = string & { readonly __brand: 'IsoDate' };

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Validate and brand. Rejects impossible dates such as 2026-02-30, which `Date` would roll over. */
export function isoDate(s: string): IsoDate {
  const parsed = parseIsoDate(s);
  if (parsed === null) {
    throw new TypeError(`Invalid ISO calendar date: ${JSON.stringify(s)} (expected YYYY-MM-DD)`);
  }
  return parsed;
}

export function isIsoDate(s: string): boolean {
  return parseIsoDate(s) !== null;
}

function parseIsoDate(s: string): IsoDate | null {
  const m = ISO_DATE_RE.exec(s);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return s as IsoDate;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** `month` is 1-based. */
export function daysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) throw new RangeError(`daysInMonth: month out of range: ${month}`);
  if (month === 2 && isLeapYear(year)) return 29;
  return MONTH_LENGTHS[month - 1]!;
}

export interface DateParts {
  readonly year: number;
  readonly month: number; // 1-based
  readonly day: number;
}

export function toParts(d: IsoDate): DateParts {
  const m = ISO_DATE_RE.exec(d)!;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function fromParts(year: number, month: number, day: number): IsoDate {
  const max = daysInMonth(year, month);
  if (day < 1 || day > max) {
    throw new RangeError(`fromParts: ${year}-${month}-${day} is not a real date`);
  }
  return `${pad4(year)}-${pad2(month)}-${pad2(day)}` as IsoDate;
}

const pad2 = (n: number): string => n.toString().padStart(2, '0');
const pad4 = (n: number): string => n.toString().padStart(4, '0');

/**
 * "Today" in the user's timezone. The zone comes from `settings.timezone`, so
 * a transaction entered at 00:30 IST books to the Indian date, not the UTC one.
 */
export function todayIn(timeZone: string, now: Date = new Date()): IsoDate {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA formats as YYYY-MM-DD, which is exactly the representation we want.
  return isoDate(fmt.format(now));
}

/** ISO dates compare correctly as strings, which is the main reason for this representation. */
export function compareDates(a: IsoDate, b: IsoDate): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDate(a: IsoDate, b: IsoDate): IsoDate {
  return a <= b ? a : b;
}

export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return a >= b ? a : b;
}

/** Days between two calendar dates, `b - a`. Computed from a day count, so DST cannot skew it. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return toEpochDay(b) - toEpochDay(a);
}

export function addDays(d: IsoDate, days: number): IsoDate {
  return fromEpochDay(toEpochDay(d) + days);
}

/**
 * Add months, clamping to the end of the target month. 31 January + 1 month is
 * 28 or 29 February, never 3 March. Recurrence in Phase 3 depends on this
 * clamping being here rather than reinvented at the call site.
 */
export function addMonths(d: IsoDate, months: number): IsoDate {
  const { year, month, day } = toParts(d);
  const zeroBased = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(zeroBased / 12);
  const targetMonth = (((zeroBased % 12) + 12) % 12) + 1;
  return fromParts(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
}

export function startOfMonth(d: IsoDate): IsoDate {
  const { year, month } = toParts(d);
  return fromParts(year, month, 1);
}

export function endOfMonth(d: IsoDate): IsoDate {
  const { year, month } = toParts(d);
  return fromParts(year, month, daysInMonth(year, month));
}

/** Days since 1970-01-01, by the proleptic Gregorian calendar. Pure integer arithmetic. */
export function toEpochDay(d: IsoDate): number {
  const { year, month, day } = toParts(d);
  // Howard Hinnant's civil-from-days algorithm, inverted.
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function fromEpochDay(epochDay: number): IsoDate {
  const z = epochDay + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return fromParts(month <= 2 ? y + 1 : y, month, day);
}

/** The UTC instant at midnight of a calendar date. For `date` columns, which carry no zone. */
export function toUtcDate(d: IsoDate): Date {
  return new Date(`${d}T00:00:00.000Z`);
}

/** The calendar date of an instant, in UTC. Use `todayIn` when the user's zone matters. */
export function fromUtcDate(dt: Date): IsoDate {
  return isoDate(dt.toISOString().slice(0, 10));
}
