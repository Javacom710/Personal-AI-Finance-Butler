/**
 * **The** freshness classifier — one, for every provider
 * ([ADR-28](../../../docs/DECISIONS.md#adr-28--staleness-is-measured-in-trading-sessions-not-wall-clock-hours)).
 *
 * Pure: dates and numbers in, a verdict out. No clock, no database, no network.
 *
 * ## Why this is not a wall-clock rule
 *
 * `settings.price_stale_after_hours` defaults to 24, and comparing `now − as_of`
 * in hours is correct for something that trades continuously and wrong for
 * everything else. Against an **end-of-day** close it fires every single week:
 *
 * | Moment | Age of Friday's close | Wall-clock verdict |
 * |---|---|---|
 * | Friday 18:00 IST  |  2.5 h | fine |
 * | Saturday 18:00    | 26.5 h | **stale** |
 * | Monday 09:00      | 65.5 h | **stale** |
 *
 * Every equity, every ETF and every mutual fund would carry a staleness badge
 * across every weekend and for days after each of India's many market holidays.
 * A warning that fires when nothing is wrong is a warning the user learns to
 * dismiss — and it then fails silently on the day something *is* wrong, which is
 * the outcome `CLAUDE.md` is most insistent about avoiding.
 *
 * ## The rule
 *
 * A session-traded instrument ages in **completed trading sessions**; a
 * continuously-traded one ages in hours.
 *
 * | | `eod` / `nav` | `continuous` |
 * |---|---|---|
 * | `current` | 0 sessions behind | ≤ 6 h |
 * | `recent`  | 1 … `staleAfterSessions − 1` | ≤ `staleAfterHours` |
 * | `stale`   | ≥ `staleAfterSessions`, **or** past the calendar backstop | beyond |
 *
 * ## The calendar is the price series
 *
 * `sessions` is the ascending list of dates on which this market is known to
 * have traded, read from `instrument_prices`. There is deliberately no
 * trading-calendar table: the series cannot drift from the prices it describes,
 * it is automatically right for every exchange a provider covers, and it needs
 * no holiday list to maintain.
 *
 * Two guards make that safe. With a single instrument on an exchange its own
 * latest close *is* the reference, so `sessionsBehind` is 0 — correct by
 * construction, and unable to raise a false alarm. What that cannot detect is a
 * provider which has quietly stopped, and the **calendar-day backstop** is
 * exactly what catches it. Neither rule is sufficient alone; together they are.
 */

import { compareDates, daysBetween, type IsoDate } from '../../lib/date';
import type { Cadence } from './types';

export type Freshness = 'current' | 'recent' | 'stale';

/** Below this an actively-traded instrument is `current`. Not user-tunable: it is a unit of meaning, not a preference. */
export const CONTINUOUS_CURRENT_HOURS = 6;

/**
 * Past this many calendar days an observation is `stale` however many sessions
 * the exchange has recorded. This is the rule that notices a provider dropping
 * coverage — the session count cannot, because a series that stops also stops
 * advancing the reference.
 */
export const SESSION_BACKSTOP_DAYS = 10;

/** A continuous market has no non-trading days to forgive, so its backstop is tight. */
export const CONTINUOUS_BACKSTOP_DAYS = 2;

export interface FreshnessThresholds {
  /** `settings.price_stale_after_sessions`, default 3. */
  readonly staleAfterSessions: number;
  /** `settings.price_stale_after_hours`, default 24. Continuous instruments only. */
  readonly staleAfterHours: number;
}

export const DEFAULT_THRESHOLDS: FreshnessThresholds = {
  staleAfterSessions: 3,
  staleAfterHours: 24,
};

export interface FreshnessInput {
  readonly cadence: Cadence;
  /** The session the observation belongs to, in the market's timezone. */
  readonly tradingDate: IsoDate;
  /** The instant the value was true — the exchange's close, never the fetch time. */
  readonly observedAt: Date;
  readonly now: Date;
  /** Today in the user's timezone, for the calendar backstop. */
  readonly today: IsoDate;
  /**
   * Ascending, distinct sessions known for this instrument's market. Empty when
   * no history is stored yet, which falls back to the hours branch — honest,
   * because with no calendar there is nothing to count.
   */
  readonly sessions: readonly IsoDate[];
  readonly thresholds: FreshnessThresholds;
}

export interface FreshnessVerdict {
  readonly freshness: Freshness;
  /** `null` on the hours branch: there was no calendar to count against. */
  readonly sessionsBehind: number | null;
  readonly ageHours: number;
  /** Which branch decided, so a surface can explain itself and a test can assert the path. */
  readonly basis: 'sessions' | 'hours' | 'backstop' | 'future';
}

/**
 * Sessions strictly after `tradingDate`.
 *
 * Counting rather than indexing handles the case where the observation's own
 * date is not itself a session — a manually entered price dated on a Sunday, or
 * a NAV date the exchange calendar does not contain.
 */
export function sessionsBehind(sessions: readonly IsoDate[], tradingDate: IsoDate): number {
  let behind = 0;
  for (const session of sessions) {
    if (compareDates(session, tradingDate) > 0) behind += 1;
  }
  return behind;
}

function backstopDaysFor(cadence: Cadence): number {
  return cadence === 'continuous' ? CONTINUOUS_BACKSTOP_DAYS : SESSION_BACKSTOP_DAYS;
}

function usesSessions(cadence: Cadence): boolean {
  return cadence === 'eod' || cadence === 'nav';
}

export function classifyFreshness(input: FreshnessInput): FreshnessVerdict {
  const ageHours = (input.now.getTime() - input.observedAt.getTime()) / 3_600_000;

  // A value dated in the future is a clock problem, not "fresher than fresh" —
  // but it is still the best observation available, so it is reported at age
  // zero rather than discarded. Phase 4 made this call and it was right.
  if (ageHours <= 0 || compareDates(input.tradingDate, input.today) > 0) {
    return { freshness: 'current', sessionsBehind: 0, ageHours: 0, basis: 'future' };
  }

  const backstop = backstopDaysFor(input.cadence);
  const calendarAge = daysBetween(input.tradingDate, input.today);

  if (usesSessions(input.cadence) && input.sessions.length > 0) {
    const behind = sessionsBehind(input.sessions, input.tradingDate);

    // The backstop only ever makes a verdict worse, never better: a provider
    // that stopped publishing also stops advancing the session count, so the
    // count alone would report `current` forever.
    if (calendarAge > backstop) {
      return { freshness: 'stale', sessionsBehind: behind, ageHours, basis: 'backstop' };
    }

    const freshness: Freshness =
      behind === 0 ? 'current' : behind < input.thresholds.staleAfterSessions ? 'recent' : 'stale';

    return { freshness, sessionsBehind: behind, ageHours, basis: 'sessions' };
  }

  // Hours branch: continuous instruments, and session-traded ones for which no
  // calendar is stored yet. `ageHours > threshold` — not `>=` — so a threshold
  // of exactly the observed age is still inside the boundary, which is the
  // convention Phase 4 established and its tests pin.
  if (calendarAge > backstop) {
    return { freshness: 'stale', sessionsBehind: null, ageHours, basis: 'backstop' };
  }

  const freshness: Freshness =
    ageHours > input.thresholds.staleAfterHours
      ? 'stale'
      : ageHours <= CONTINUOUS_CURRENT_HOURS
        ? 'current'
        : 'recent';

  return { freshness, sessionsBehind: null, ageHours, basis: 'hours' };
}

/**
 * The cadence an instrument's prices age at.
 *
 * Derived from the asset class rather than stored, because it is a property of
 * how the thing trades and not a user preference. Crypto is listed for the day
 * an adapter arrives (OD-11 defers it); the branch it selects is implemented and
 * tested regardless, so enabling crypto is an adapter and not a rule change.
 */
export function cadenceForAssetClass(assetClass: string): Cadence {
  switch (assetClass) {
    case 'mutual_fund':
      return 'nav';
    case 'crypto':
      return 'continuous';
    default:
      return 'eod';
  }
}
