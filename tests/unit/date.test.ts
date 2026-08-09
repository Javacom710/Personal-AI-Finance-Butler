import { describe, expect, it } from 'vitest';

import {
  addDays,
  addMonths,
  compareDates,
  daysBetween,
  daysInMonth,
  endOfMonth,
  fromEpochDay,
  isIsoDate,
  isLeapYear,
  isoDate,
  startOfMonth,
  todayIn,
  toEpochDay,
} from '@/lib/date';

describe('isoDate', () => {
  it('accepts a well-formed calendar date', () => {
    expect(isoDate('2026-08-09')).toBe('2026-08-09');
  });

  it('rejects an impossible date instead of rolling it over the way Date does', () => {
    // new Date('2026-02-30') would silently become 2 March.
    for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '2025-02-29', '2026-04-31']) {
      expect(isIsoDate(bad), `${bad} should be rejected`).toBe(false);
      expect(() => isoDate(bad)).toThrow(TypeError);
    }
  });

  it('rejects anything that is not exactly YYYY-MM-DD', () => {
    for (const bad of ['2026-8-9', '09-08-2026', '2026/08/09', '2026-08-09T00:00:00Z', '']) {
      expect(isIsoDate(bad), `${bad} should be rejected`).toBe(false);
    }
  });
});

describe('leap years', () => {
  it('follows the full Gregorian rule, including the century exceptions', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2025)).toBe(false);
    expect(isLeapYear(1900)).toBe(false); // divisible by 100, not 400
    expect(isLeapYear(2000)).toBe(true); // divisible by 400
  });

  it('gives February the right length in both cases', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe('addMonths', () => {
  it('clamps the 31st into a shorter month rather than overflowing', () => {
    // The single most common recurrence bug: 31 Jan + 1 month must not be 3 March.
    expect(addMonths(isoDate('2025-01-31'), 1)).toBe('2025-02-28');
    expect(addMonths(isoDate('2024-01-31'), 1)).toBe('2024-02-29');
    expect(addMonths(isoDate('2026-01-31'), 3)).toBe('2026-04-30');
  });

  it('crosses year boundaries in both directions', () => {
    expect(addMonths(isoDate('2026-12-15'), 1)).toBe('2027-01-15');
    expect(addMonths(isoDate('2026-01-15'), -1)).toBe('2025-12-15');
    expect(addMonths(isoDate('2026-01-15'), -13)).toBe('2024-12-15');
  });

  it('is not lossy when the day is safe', () => {
    expect(addMonths(isoDate('2026-03-15'), 12)).toBe('2027-03-15');
  });
});

describe('day arithmetic', () => {
  it('round-trips through the epoch-day representation', () => {
    for (const d of ['1970-01-01', '2000-02-29', '2026-08-09', '2100-03-01', '1899-12-31']) {
      expect(fromEpochDay(toEpochDay(isoDate(d)))).toBe(d);
    }
  });

  it('anchors the epoch correctly', () => {
    expect(toEpochDay(isoDate('1970-01-01'))).toBe(0);
    expect(toEpochDay(isoDate('1970-01-02'))).toBe(1);
    expect(toEpochDay(isoDate('1969-12-31'))).toBe(-1);
  });

  it('counts days across a leap day', () => {
    expect(daysBetween(isoDate('2024-02-28'), isoDate('2024-03-01'))).toBe(2);
    expect(daysBetween(isoDate('2025-02-28'), isoDate('2025-03-01'))).toBe(1);
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays(isoDate('2026-12-31'), 1)).toBe('2027-01-01');
    expect(addDays(isoDate('2026-01-01'), -1)).toBe('2025-12-31');
    expect(addDays(isoDate('2024-02-28'), 1)).toBe('2024-02-29');
  });

  it('is unaffected by daylight saving, because it never touches a wall clock', () => {
    // 29 March 2026 is the European DST transition. A Date-based implementation
    // that added 24×60×60×1000 ms would land on the wrong day here.
    expect(addDays(isoDate('2026-03-28'), 1)).toBe('2026-03-29');
    expect(addDays(isoDate('2026-03-29'), 1)).toBe('2026-03-30');
    expect(daysBetween(isoDate('2026-03-28'), isoDate('2026-03-30'))).toBe(2);
  });
});

describe('month boundaries', () => {
  it('finds the first and last day', () => {
    expect(startOfMonth(isoDate('2026-08-09'))).toBe('2026-08-01');
    expect(endOfMonth(isoDate('2026-08-09'))).toBe('2026-08-31');
    expect(endOfMonth(isoDate('2024-02-05'))).toBe('2024-02-29');
    expect(endOfMonth(isoDate('2025-02-05'))).toBe('2025-02-28');
  });
});

describe('todayIn', () => {
  it('books to the user timezone, not to UTC', () => {
    // 23:30 UTC on 8 August is already 05:00 on 9 August in Kolkata. A
    // transaction entered then must book to the 9th.
    const instant = new Date('2026-08-08T23:30:00.000Z');
    expect(todayIn('Asia/Kolkata', instant)).toBe('2026-08-09');
    expect(todayIn('UTC', instant)).toBe('2026-08-08');
    expect(todayIn('America/New_York', instant)).toBe('2026-08-08');
  });
});

describe('comparison', () => {
  it('orders ISO dates lexicographically, which is why they are strings', () => {
    expect(compareDates(isoDate('2026-01-02'), isoDate('2026-01-10'))).toBe(-1);
    expect(compareDates(isoDate('2026-01-10'), isoDate('2026-01-02'))).toBe(1);
    expect(compareDates(isoDate('2026-01-02'), isoDate('2026-01-02'))).toBe(0);
  });
});
