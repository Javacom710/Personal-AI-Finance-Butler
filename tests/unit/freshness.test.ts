/**
 * The freshness classifier — [ADR-28](../../docs/DECISIONS.md), [TESTING.md §6.1](../../docs/TESTING.md).
 *
 * One classifier means one test file covers every provider. The regression that
 * matters most is the first one: under the wall-clock rule this phase replaces,
 * Friday's close was reported `stale` from Saturday morning until Monday's close
 * landed — for every equity, every ETF and every mutual fund, every single week.
 */

import { describe, expect, it } from 'vitest';

import { isoDate, type IsoDate } from '@/lib/date';
import {
  cadenceForAssetClass,
  classifyFreshness,
  CONTINUOUS_BACKSTOP_DAYS,
  DEFAULT_THRESHOLDS,
  SESSION_BACKSTOP_DAYS,
  sessionsBehind,
} from '@/server/market-data/freshness';
import type { Cadence } from '@/server/market-data/types';

const d = (s: string): IsoDate => isoDate(s);

/** A fortnight of NSE sessions: weekdays only, no holidays. */
const SESSIONS: IsoDate[] = [
  '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07',
  '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14',
].map(d);

interface Overrides {
  cadence?: Cadence;
  tradingDate?: string;
  observedAt?: string;
  now?: string;
  today?: string;
  sessions?: IsoDate[];
  staleAfterSessions?: number;
  staleAfterHours?: number;
}

function classify(over: Overrides = {}) {
  const tradingDate = d(over.tradingDate ?? '2026-08-14');
  return classifyFreshness({
    cadence: over.cadence ?? 'eod',
    tradingDate,
    observedAt: new Date(over.observedAt ?? `${tradingDate}T10:00:00Z`),
    now: new Date(over.now ?? '2026-08-14T12:00:00Z'),
    today: d(over.today ?? '2026-08-14'),
    sessions: over.sessions ?? SESSIONS,
    thresholds: {
      staleAfterSessions: over.staleAfterSessions ?? DEFAULT_THRESHOLDS.staleAfterSessions,
      staleAfterHours: over.staleAfterHours ?? DEFAULT_THRESHOLDS.staleAfterHours,
    },
  });
}

describe('sessionsBehind', () => {
  it('counts only sessions strictly after the observation', () => {
    expect(sessionsBehind(SESSIONS, d('2026-08-14'))).toBe(0);
    expect(sessionsBehind(SESSIONS, d('2026-08-13'))).toBe(1);
    expect(sessionsBehind(SESSIONS, d('2026-08-10'))).toBe(4);
  });

  it('handles a date that is not itself a session', () => {
    // A price hand-entered on a Sunday, or a NAV date the exchange never traded.
    expect(sessionsBehind(SESSIONS, d('2026-08-09'))).toBe(5); // Sunday before the 10th
  });
});

describe('freshness — trading days', () => {
  it('is current on the latest session', () => {
    const verdict = classify({ tradingDate: '2026-08-14' });
    expect(verdict.freshness).toBe('current');
    expect(verdict.sessionsBehind).toBe(0);
    expect(verdict.basis).toBe('sessions');
  });

  it('is recent one and two sessions behind, and stale at three', () => {
    expect(classify({ tradingDate: '2026-08-13' }).freshness).toBe('recent');
    expect(classify({ tradingDate: '2026-08-12' }).freshness).toBe('recent');
    expect(classify({ tradingDate: '2026-08-11' }).freshness).toBe('stale');
  });

  it('honours a configured session threshold', () => {
    expect(classify({ tradingDate: '2026-08-13', staleAfterSessions: 1 }).freshness).toBe('stale');
    expect(classify({ tradingDate: '2026-08-11', staleAfterSessions: 5 }).freshness).toBe('recent');
  });
});

describe("freshness — the weekend regression this rule exists for", () => {
  // Friday 14 August is the latest session. Monday morning is 17 August.
  const MONDAY_MORNING = '2026-08-17T03:30:00Z'; // 09:00 IST

  it("does NOT call Friday's close stale on Monday morning", () => {
    const verdict = classify({
      tradingDate: '2026-08-14',
      observedAt: '2026-08-14T10:00:00Z', // 15:30 IST close
      now: MONDAY_MORNING,
      today: '2026-08-17',
    });

    // ~65 hours old. The wall-clock rule at 24h reported `stale`.
    expect(verdict.ageHours).toBeGreaterThan(60);
    expect(verdict.freshness).toBe('current');
    expect(verdict.sessionsBehind).toBe(0);
  });

  it('is still not stale on Saturday or Sunday', () => {
    for (const [now, today] of [
      ['2026-08-15T12:00:00Z', '2026-08-15'],
      ['2026-08-16T12:00:00Z', '2026-08-16'],
    ] as const) {
      expect(classify({ tradingDate: '2026-08-14', now, today }).freshness).toBe('current');
    }
  });

  it('a multi-day exchange closure does not advance the session count', () => {
    // The calendar simply has no rows for the closed days, so nothing moves.
    const verdict = classify({
      tradingDate: '2026-08-14',
      now: '2026-08-19T12:00:00Z',
      today: '2026-08-19',
    });
    expect(verdict.sessionsBehind).toBe(0);
    expect(verdict.freshness).toBe('current');
  });
});

describe('freshness — the calendar backstop', () => {
  it('turns a long-abandoned series stale even at zero sessions behind', () => {
    const verdict = classify({
      tradingDate: '2026-08-14',
      now: '2026-08-30T12:00:00Z',
      today: '2026-08-30', // 16 calendar days later
    });
    // Session count still says 0 — the series stopped, so the reference stopped
    // with it. This is precisely what the count cannot see on its own.
    expect(verdict.sessionsBehind).toBe(0);
    expect(verdict.freshness).toBe('stale');
    expect(verdict.basis).toBe('backstop');
  });

  it('does not fire one day inside the bound', () => {
    const withinBound = classify({
      tradingDate: '2026-08-14',
      now: '2026-08-24T12:00:00Z',
      today: '2026-08-24', // exactly SESSION_BACKSTOP_DAYS
    });
    expect(SESSION_BACKSTOP_DAYS).toBe(10);
    expect(withinBound.freshness).toBe('current');
  });
});

describe('freshness — continuous instruments still age in hours', () => {
  const base = { cadence: 'continuous' as const, tradingDate: '2026-08-14', today: '2026-08-14' };

  it('is current within six hours', () => {
    expect(classify({ ...base, observedAt: '2026-08-14T08:00:00Z', now: '2026-08-14T12:00:00Z' }).freshness).toBe('current');
  });

  it('is recent between six and twenty-four hours', () => {
    expect(classify({ ...base, observedAt: '2026-08-14T00:00:00Z', now: '2026-08-14T12:00:00Z' }).freshness).toBe('recent');
  });

  it('is stale beyond the hours threshold', () => {
    const verdict = classify({
      ...base,
      tradingDate: '2026-08-13',
      today: '2026-08-14',
      observedAt: '2026-08-13T00:00:00Z',
      now: '2026-08-14T12:00:00Z',
    });
    expect(verdict.ageHours).toBe(36);
    expect(verdict.freshness).toBe('stale');
    expect(verdict.basis).toBe('hours');
  });

  it('has a tighter backstop, because there are no closed days to forgive', () => {
    expect(CONTINUOUS_BACKSTOP_DAYS).toBe(2);
    const verdict = classify({
      ...base,
      tradingDate: '2026-08-10',
      today: '2026-08-14',
      observedAt: '2026-08-10T00:00:00Z',
      now: '2026-08-14T12:00:00Z',
    });
    expect(verdict.basis).toBe('backstop');
    expect(verdict.freshness).toBe('stale');
  });
});

describe('freshness — bootstrap and clock problems', () => {
  it('a single instrument on an exchange is its own reference and never cries wolf', () => {
    const verdict = classify({ tradingDate: '2026-08-14', sessions: [d('2026-08-14')] });
    expect(verdict.sessionsBehind).toBe(0);
    expect(verdict.freshness).toBe('current');
  });

  it('falls back to hours when no calendar is stored at all', () => {
    const verdict = classify({ tradingDate: '2026-08-14', sessions: [] });
    expect(verdict.basis).toBe('hours');
    expect(verdict.sessionsBehind).toBeNull();
  });

  it('reports a future-dated observation at age zero rather than discarding it', () => {
    const verdict = classify({
      tradingDate: '2026-08-20',
      observedAt: '2026-08-20T10:00:00Z',
      now: '2026-08-14T12:00:00Z',
      today: '2026-08-14',
    });
    // A clock problem, but still the best observation available.
    expect(verdict.freshness).toBe('current');
    expect(verdict.ageHours).toBe(0);
    expect(verdict.basis).toBe('future');
  });
});

describe('cadenceForAssetClass', () => {
  it('maps an asset class to how its price ages', () => {
    expect(cadenceForAssetClass('mutual_fund')).toBe('nav');
    expect(cadenceForAssetClass('crypto')).toBe('continuous');
    expect(cadenceForAssetClass('equity')).toBe('eod');
    expect(cadenceForAssetClass('etf')).toBe('eod');
    // Deferred asset classes still resolve, so enabling one later is an adapter
    // rather than a rule change (OD-11, OD-12).
    expect(cadenceForAssetClass('gold')).toBe('eod');
  });
});
