/**
 * A deliberately small RFC 5545 recurrence subset (FINANCIAL-DOMAIN.md §7).
 *
 * Supported: `FREQ` ∈ DAILY | WEEKLY | MONTHLY | YEARLY, plus `INTERVAL`,
 * `BYMONTHDAY`, `BYDAY`, `COUNT`, `UNTIL`. Everything else is rejected at parse
 * time rather than ignored — a rule the parser silently drops half of is a rule
 * that posts rent on the wrong day.
 *
 * ## One deliberate deviation from RFC 5545
 *
 * RFC 5545 **skips** an invalid date: `BYMONTHDAY=31` produces nothing in
 * February. This module **clamps** it to the last day of the month instead, so
 * salary on the 31st arrives on 28 or 29 February and rent on the 31st is paid
 * in April. That is what people mean when they say "the last of the month", and
 * a salary that silently fails to appear in February is a worse failure than a
 * deviation from a calendaring standard. `BYMONTHDAY=-1` means the last day
 * explicitly. Both behaviours are covered by named tests.
 *
 * Pure: `expand()` takes a rule and a window and returns dates. No clock, no
 * timezone, no I/O.
 */

import { addDays, addMonths, compareDates, daysInMonth, fromParts, toEpochDay, toParts, type IsoDate } from './index';
import { err, ok, type Result } from '../result';

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface Rrule {
  readonly freq: Freq;
  /** ≥ 1. `INTERVAL=2` with `FREQ=WEEKLY` is fortnightly. */
  readonly interval: number;
  /** 1..31, or -1 for the last day of the month. Sorted, de-duplicated. */
  readonly byMonthDay?: readonly number[];
  /** WEEKLY only. Sorted in week order starting Monday. */
  readonly byDay?: readonly Weekday[];
  /** Total occurrences counted from the rule's start date, not from a query window. */
  readonly count?: number;
  /** Inclusive last date. */
  readonly until?: IsoDate;
}

export interface RruleError {
  readonly code: 'malformed' | 'unsupported' | 'out_of_range';
  readonly message: string;
}

const rruleError = (code: RruleError['code'], message: string): RruleError => ({ code, message });

const FREQS: readonly string[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];

/**
 * Parse `FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=31`.
 *
 * Accepts an optional `RRULE:` prefix so a value copied from a calendar export
 * parses. Rejects unknown parts: silently ignoring `BYSETPOS` would produce a
 * schedule the user did not describe.
 */
export function parseRrule(input: string): Result<Rrule, RruleError> {
  const text = input.trim().replace(/^RRULE:/i, '');
  if (text.length === 0) return err(rruleError('malformed', 'the recurrence rule is empty'));

  const parts = new Map<string, string>();
  for (const chunk of text.split(';')) {
    if (chunk.trim().length === 0) continue;
    const eq = chunk.indexOf('=');
    if (eq <= 0) return err(rruleError('malformed', `"${chunk}" is not NAME=VALUE`));
    const name = chunk.slice(0, eq).trim().toUpperCase();
    const value = chunk.slice(eq + 1).trim();
    if (parts.has(name)) return err(rruleError('malformed', `${name} appears more than once`));
    parts.set(name, value);
  }

  const known = new Set(['FREQ', 'INTERVAL', 'BYMONTHDAY', 'BYDAY', 'COUNT', 'UNTIL']);
  for (const name of parts.keys()) {
    if (!known.has(name)) {
      return err(
        rruleError('unsupported', `${name} is not supported. Supported: ${[...known].join(', ')}`),
      );
    }
  }

  const freqRaw = parts.get('FREQ')?.toUpperCase();
  if (!freqRaw) return err(rruleError('malformed', 'FREQ is required'));
  if (!FREQS.includes(freqRaw)) {
    return err(rruleError('unsupported', `FREQ=${freqRaw} is not supported (${FREQS.join(', ')})`));
  }
  const freq = freqRaw as Freq;

  let interval = 1;
  const intervalRaw = parts.get('INTERVAL');
  if (intervalRaw !== undefined) {
    if (!/^\d+$/.test(intervalRaw)) return err(rruleError('malformed', 'INTERVAL must be a whole number'));
    interval = Number(intervalRaw);
    if (interval < 1 || interval > 1000) {
      return err(rruleError('out_of_range', 'INTERVAL must be between 1 and 1000'));
    }
  }

  let byMonthDay: number[] | undefined;
  const byMonthDayRaw = parts.get('BYMONTHDAY');
  if (byMonthDayRaw !== undefined) {
    if (freq === 'DAILY' || freq === 'WEEKLY') {
      return err(rruleError('unsupported', `BYMONTHDAY has no meaning with FREQ=${freq}`));
    }
    const days: number[] = [];
    for (const raw of byMonthDayRaw.split(',')) {
      if (!/^-?\d+$/.test(raw.trim())) return err(rruleError('malformed', 'BYMONTHDAY must be whole numbers'));
      const day = Number(raw.trim());
      if (day === -1 || (day >= 1 && day <= 31)) days.push(day);
      else return err(rruleError('out_of_range', 'BYMONTHDAY must be 1..31 or -1 (last day)'));
    }
    if (days.length === 0) return err(rruleError('malformed', 'BYMONTHDAY is empty'));
    // -1 sorts last: it always resolves to the highest day in the month.
    byMonthDay = [...new Set(days)].sort((a, b) => (a === -1 ? 1 : b === -1 ? -1 : a - b));
  }

  let byDay: Weekday[] | undefined;
  const byDayRaw = parts.get('BYDAY');
  if (byDayRaw !== undefined) {
    if (freq !== 'WEEKLY') {
      return err(
        rruleError('unsupported', `BYDAY is supported only with FREQ=WEEKLY, not ${freq}`),
      );
    }
    const days: Weekday[] = [];
    for (const raw of byDayRaw.split(',')) {
      const code = raw.trim().toUpperCase();
      if (!(WEEKDAYS as readonly string[]).includes(code)) {
        return err(rruleError('malformed', `"${raw.trim()}" is not a weekday (${WEEKDAYS.join(', ')})`));
      }
      days.push(code as Weekday);
    }
    if (days.length === 0) return err(rruleError('malformed', 'BYDAY is empty'));
    byDay = [...new Set(days)].sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b));
  }

  let count: number | undefined;
  const countRaw = parts.get('COUNT');
  if (countRaw !== undefined) {
    if (!/^\d+$/.test(countRaw)) return err(rruleError('malformed', 'COUNT must be a whole number'));
    count = Number(countRaw);
    if (count < 1 || count > MAX_OCCURRENCES) {
      return err(rruleError('out_of_range', `COUNT must be between 1 and ${MAX_OCCURRENCES}`));
    }
  }

  let until: IsoDate | undefined;
  const untilRaw = parts.get('UNTIL');
  if (untilRaw !== undefined) {
    // Both the calendar form (20261231) and plain ISO are accepted. A time part
    // is dropped: everything in this domain is a calendar date.
    const compact = /^(\d{4})(\d{2})(\d{2})(T.*)?$/.exec(untilRaw);
    const iso = compact ? `${compact[1]}-${compact[2]}-${compact[3]}` : untilRaw.slice(0, 10);
    try {
      until = fromParts(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), Number(iso.slice(8, 10)));
    } catch {
      return err(rruleError('malformed', `UNTIL is not a date: ${untilRaw}`));
    }
  }

  if (count !== undefined && until !== undefined) {
    return err(rruleError('malformed', 'COUNT and UNTIL cannot both be set'));
  }

  return ok({
    freq,
    interval,
    ...(byMonthDay ? { byMonthDay } : {}),
    ...(byDay ? { byDay } : {}),
    ...(count === undefined ? {} : { count }),
    ...(until === undefined ? {} : { until }),
  });
}

/** The canonical text form, so a parsed rule round-trips to the same string. */
export function formatRrule(rule: Rrule): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byDay) parts.push(`BYDAY=${rule.byDay.join(',')}`);
  if (rule.byMonthDay) parts.push(`BYMONTHDAY=${rule.byMonthDay.join(',')}`);
  if (rule.count !== undefined) parts.push(`COUNT=${rule.count}`);
  if (rule.until !== undefined) parts.push(`UNTIL=${rule.until.replace(/-/g, '')}`);
  return parts.join(';');
}

/** A hard stop on how many occurrences one rule may ever produce. */
export const MAX_OCCURRENCES = 10_000;

/** Monday = 0. Derived from the epoch day, so no `Date` and no timezone. */
export function weekdayIndex(d: IsoDate): number {
  return (((toEpochDay(d) + 3) % 7) + 7) % 7;
}

export function startOfWeek(d: IsoDate): IsoDate {
  return addDays(d, -weekdayIndex(d));
}

/** Resolve a BYMONTHDAY value inside a specific month, clamping to its length. */
function resolveMonthDay(year: number, month: number, day: number): IsoDate {
  const last = daysInMonth(year, month);
  return fromParts(year, month, day === -1 ? last : Math.min(day, last));
}

/**
 * Every occurrence of `rule` starting at `startsOn` that falls in `[from, to]`.
 *
 * The series is always walked from `startsOn`, never from `from`: `COUNT` counts
 * occurrences from the beginning of the series, so a window in the middle of a
 * `COUNT=12` rule must know how many came before it.
 *
 * `endsOn` (the rule's own end date, stored beside the rrule) is applied here
 * as well, so a rule whose `ends_on` falls mid-expansion stops at the right
 * place rather than emitting a tail nobody asked for.
 */
export function expand(
  rule: Rrule,
  startsOn: IsoDate,
  window: { readonly from: IsoDate; readonly to: IsoDate },
  endsOn?: IsoDate | null,
): IsoDate[] {
  if (compareDates(window.from, window.to) > 0) return [];

  const hardEnd = [rule.until, endsOn].filter((d): d is IsoDate => !!d).sort(compareDates)[0];
  const limit = hardEnd && compareDates(hardEnd, window.to) < 0 ? hardEnd : window.to;

  const out: IsoDate[] = [];
  let emitted = 0;

  for (const date of candidates(rule, startsOn)) {
    if (rule.count !== undefined && emitted >= rule.count) break;
    if (hardEnd && compareDates(date, hardEnd) > 0) break;
    if (compareDates(date, limit) > 0) break;

    emitted += 1;
    if (compareDates(date, window.from) >= 0) out.push(date);

    if (emitted >= MAX_OCCURRENCES) break;
  }

  return out;
}

/** The next occurrence strictly after `after`, or `null` if the series has ended. */
export function nextAfter(
  rule: Rrule,
  startsOn: IsoDate,
  after: IsoDate,
  endsOn?: IsoDate | null,
): IsoDate | null {
  const hardEnd = [rule.until, endsOn].filter((d): d is IsoDate => !!d).sort(compareDates)[0];

  let emitted = 0;
  for (const date of candidates(rule, startsOn)) {
    if (rule.count !== undefined && emitted >= rule.count) return null;
    if (hardEnd && compareDates(date, hardEnd) > 0) return null;
    emitted += 1;
    if (compareDates(date, after) > 0) return date;
    if (emitted >= MAX_OCCURRENCES) return null;
  }
  return null;
}

/**
 * The raw, unbounded series in ascending order, beginning at the first
 * occurrence on or after `startsOn`.
 *
 * A generator so that `expand` and `nextAfter` share one definition of the
 * schedule: two implementations would eventually disagree about February.
 */
function* candidates(rule: Rrule, startsOn: IsoDate): Generator<IsoDate> {
  // A ceiling on steps taken, distinct from the ceiling on occurrences emitted:
  // a rule can legitimately produce a period with no dates in it.
  const MAX_STEPS = MAX_OCCURRENCES * 4;

  switch (rule.freq) {
    case 'DAILY': {
      let current = startsOn;
      for (let step = 0; step < MAX_STEPS; step += 1) {
        yield current;
        current = addDays(current, rule.interval);
      }
      return;
    }

    case 'WEEKLY': {
      if (!rule.byDay) {
        let current = startsOn;
        for (let step = 0; step < MAX_STEPS; step += 1) {
          yield current;
          current = addDays(current, 7 * rule.interval);
        }
        return;
      }

      // Weeks are anchored at the week containing `startsOn`, with Monday as
      // the week start (RFC 5545's default WKST). Days earlier in that first
      // week than `startsOn` are not occurrences.
      const anchor = startOfWeek(startsOn);
      const offsets = rule.byDay.map((d) => WEEKDAYS.indexOf(d)).sort((a, b) => a - b);

      for (let week = 0; week < MAX_STEPS; week += 1) {
        const weekStart = addDays(anchor, 7 * week * rule.interval);
        for (const offset of offsets) {
          const date = addDays(weekStart, offset);
          if (compareDates(date, startsOn) >= 0) yield date;
        }
      }
      return;
    }

    case 'MONTHLY': {
      const start = toParts(startsOn);
      const days = rule.byMonthDay ?? [start.day];
      const firstOfStartMonth = fromParts(start.year, start.month, 1);

      for (let step = 0; step < MAX_STEPS; step += 1) {
        const monthStart = toParts(addMonths(firstOfStartMonth, step * rule.interval));
        // De-duplicated because 31 and -1 resolve to the same date in a 31-day
        // month, and one occurrence must never be posted twice.
        const resolved = [
          ...new Set(days.map((d) => resolveMonthDay(monthStart.year, monthStart.month, d))),
        ].sort(compareDates);

        for (const date of resolved) {
          if (compareDates(date, startsOn) >= 0) yield date;
        }
      }
      return;
    }

    case 'YEARLY': {
      const start = toParts(startsOn);
      const days = rule.byMonthDay ?? [start.day];

      for (let step = 0; step < MAX_STEPS; step += 1) {
        const year = start.year + step * rule.interval;
        // 29 February in a non-leap year clamps to the 28th, by the same rule
        // that makes the 31st the last day of a short month.
        const resolved = [...new Set(days.map((d) => resolveMonthDay(year, start.month, d)))].sort(
          compareDates,
        );

        for (const date of resolved) {
          if (compareDates(date, startsOn) >= 0) yield date;
        }
      }
      return;
    }
  }
}

/** A short human description, for the recurring rules list. */
export function describeRrule(rule: Rrule): string {
  const every = rule.interval === 1 ? '' : `every ${rule.interval} `;

  let base: string;
  switch (rule.freq) {
    case 'DAILY':
      base = rule.interval === 1 ? 'Daily' : `Every ${rule.interval} days`;
      break;
    case 'WEEKLY':
      base = rule.byDay
        ? `${rule.interval === 1 ? 'Weekly' : `Every ${rule.interval} weeks`} on ${rule.byDay.join(', ')}`
        : rule.interval === 1
          ? 'Weekly'
          : `Every ${rule.interval} weeks`;
      break;
    case 'MONTHLY':
      base = `${every ? `Every ${rule.interval} months` : 'Monthly'}${
        rule.byMonthDay ? ` on day ${rule.byMonthDay.map((d) => (d === -1 ? 'last' : d)).join(', ')}` : ''
      }`;
      break;
    case 'YEARLY':
      base = rule.interval === 1 ? 'Yearly' : `Every ${rule.interval} years`;
      break;
  }

  if (rule.count !== undefined) return `${base}, ${rule.count} times`;
  if (rule.until !== undefined) return `${base}, until ${rule.until}`;
  return base;
}
