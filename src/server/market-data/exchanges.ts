/**
 * Exchange identity and session times — the one place a market name becomes a
 * MIC, and a trading date becomes an instant.
 *
 * Pure. No provider, no network, no clock.
 *
 * ## Why this module exists
 *
 * `instruments.exchange` is free text (`varchar(32)`, upper-cased) because a
 * user types it: `NSE`, `BSE`, `NASDAQ`. The market-data layer works in **ISO
 * 10383 MIC** codes, because that is what a provider's `mic_code` parameter
 * takes and what unambiguously identifies a venue
 * ([MARKET-DATA-DESIGN.md §8.2](../../../docs/MARKET-DATA-DESIGN.md#82-exchanges)).
 * Something has to translate, and doing it here rather than in each adapter is
 * what stops two adapters disagreeing about what `NSE` means.
 *
 * **Translation never guesses.** An unrecognised name resolves to `null`, and an
 * adapter that needs a venue refuses the instrument rather than picking a
 * plausible one — pricing an NSE ticker off a same-named US listing is the
 * silent wrong-security error this rule exists to prevent.
 *
 * ## Session close instants
 *
 * SCHEMA.md §5 requires a stored quote's `as_of` to be **the exchange's official
 * close on that trading date**, not midnight and never the fetch time; the
 * candidates differ by up to ten hours, which is enough to move a staleness
 * boundary. That needs a per-venue close time and timezone, which is what the
 * table below is for.
 */

import { fromParts, toParts, type IsoDate } from '../../lib/date';
import { mic, type Mic } from './types';

export const XNSE = mic('XNSE');
export const XBOM = mic('XBOM');
export const XNAS = mic('XNAS');
export const XNYS = mic('XNYS');
export const XLON = mic('XLON');

export interface ExchangeSession {
  readonly mic: Mic;
  /** IANA zone. India does not observe DST; the US and UK venues do. */
  readonly timeZone: string;
  /** Official close, local wall-clock time at the venue. */
  readonly closeHour: number;
  readonly closeMinute: number;
}

/**
 * The venues this application can date a close for.
 *
 * Deliberately short. A venue absent from this table is **unsupported**, not
 * approximated: without its close time we cannot stamp `as_of` correctly, and a
 * quote stamped at the wrong instant ages wrongly.
 */
export const EXCHANGE_SESSIONS: readonly ExchangeSession[] = [
  { mic: XNSE, timeZone: 'Asia/Kolkata', closeHour: 15, closeMinute: 30 },
  { mic: XBOM, timeZone: 'Asia/Kolkata', closeHour: 15, closeMinute: 30 },
  { mic: XNAS, timeZone: 'America/New_York', closeHour: 16, closeMinute: 0 },
  { mic: XNYS, timeZone: 'America/New_York', closeHour: 16, closeMinute: 0 },
  { mic: XLON, timeZone: 'Europe/London', closeHour: 16, closeMinute: 30 },
];

const SESSION_BY_MIC = new Map<string, ExchangeSession>(
  EXCHANGE_SESSIONS.map((session) => [session.mic, session]),
);

/**
 * Names a user might type, mapped to the venue they mean.
 *
 * Only unambiguous aliases belong here. `SSE` is Shanghai to one person and
 * something else to another; a wrong entry in this table is precisely the
 * silent wrong-security error, so the bar for adding one is that it has exactly
 * one plausible reading.
 */
const ALIASES: Readonly<Record<string, Mic>> = {
  NSE: XNSE,
  NSEI: XNSE,
  'NSE INDIA': XNSE,
  BSE: XBOM,
  BOM: XBOM,
  'BSE INDIA': XBOM,
  NASDAQ: XNAS,
  NSDQ: XNAS,
  NYSE: XNYS,
  LSE: XLON,
  LON: XLON,
};

/**
 * A stored exchange label → a MIC, or `null` when it cannot be resolved.
 *
 * Returns `null` rather than throwing. A user-typed value reaching this function
 * is ordinary input, not a programming error, and the caller's job is to refuse
 * the instrument cleanly — which it cannot do if this throws first.
 */
export function resolveMic(raw: string | null | undefined): Mic | null {
  if (raw === null || raw === undefined) return null;
  const value = raw.trim().toUpperCase();
  if (value === '') return null;

  // An exact MIC passes through, but only if we know its session — a code we
  // cannot date a close for is no more usable than an unknown name.
  if (/^[A-Z0-9]{4}$/.test(value) && SESSION_BY_MIC.has(value)) return value as Mic;

  return ALIASES[value] ?? null;
}

export function sessionFor(venue: Mic | null): ExchangeSession | null {
  return venue === null ? null : (SESSION_BY_MIC.get(venue) ?? null);
}

/** Every venue this application can price. Used to declare adapter capabilities. */
export function supportedMics(): readonly Mic[] {
  return EXCHANGE_SESSIONS.map((session) => session.mic);
}

/**
 * The UTC offset of `timeZone` at `at`, in minutes east of UTC.
 *
 * Derived from `Intl` rather than a hard-coded table, so a DST rule change is the
 * platform's problem rather than ours.
 */
function offsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);

  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  // `hour` can format as 24 for midnight under hour12:false on some engines.
  const hour = get('hour') % 24;

  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  return (asIfUtc - at.getTime()) / 60_000;
}

/**
 * The instant an exchange closed on a trading date.
 *
 * Two passes, because the offset depends on the instant we are trying to find:
 * guess by treating the local time as UTC, read the zone's offset at that guess,
 * correct, then re-read and correct once more. The second pass only matters when
 * the first guess lands on the far side of a DST boundary; no venue in the table
 * closes within an hour of a transition, so it converges immediately and is
 * there for safety rather than for a known case.
 *
 * India needs neither pass — `Asia/Kolkata` has no DST — which is the common
 * case for this application.
 */
export function exchangeCloseInstant(venue: Mic, tradingDate: IsoDate): Date | null {
  const session = SESSION_BY_MIC.get(venue);
  if (!session) return null;

  const { year, month, day } = toParts(tradingDate);
  const localAsUtc = Date.UTC(year, month - 1, day, session.closeHour, session.closeMinute, 0, 0);

  let instant = new Date(localAsUtc - offsetMinutes(new Date(localAsUtc), session.timeZone) * 60_000);
  instant = new Date(localAsUtc - offsetMinutes(instant, session.timeZone) * 60_000);
  return instant;
}

/**
 * The trading date a provider's local-exchange datetime belongs to.
 *
 * Providers return `"2026-08-17"` for a daily bar and `"2026-08-17 15:30:00"`
 * for an intraday one, both already in exchange-local time. Taking the date part
 * is therefore correct and needs no conversion — and doing anything cleverer
 * would risk shifting a session by a day, which is the error §10.2 of the design
 * calls the most likely one in the whole layer.
 */
export function tradingDateFromLocal(datetime: string): IsoDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(datetime.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  try {
    // Round-trips through the domain's validator, so 31 February is rejected
    // here rather than becoming a plausible-looking wrong session downstream.
    const iso = fromParts(year, month, day);
    return toParts(iso).day === day ? iso : null;
  } catch {
    return null;
  }
}
