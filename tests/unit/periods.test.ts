import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/date';
import {
  daysInRange,
  elapsedInPeriod,
  fiscalYearRange,
  monthRange,
  periodContaining,
  periodLabel,
  periodsBetween,
  previousPeriod,
  quarterRange,
  rangeContains,
} from '@/lib/date/periods';

const d = isoDate;

/** The Indian fiscal year, which is the application default. */
const APRIL = 4;
const JANUARY = 1;

describe('monthRange', () => {
  it('covers a whole calendar month', () => {
    expect(monthRange(d('2026-08-10'))).toEqual({ from: '2026-08-01', to: '2026-08-31' });
  });

  it('handles February in a non-leap year', () => {
    expect(monthRange(d('2026-02-15'))).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('handles February in a leap year', () => {
    expect(monthRange(d('2028-02-15'))).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('handles December, where the next month is in the next year', () => {
    expect(monthRange(d('2026-12-31'))).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});

describe('quarterRange — aligned to the fiscal year, not to January', () => {
  it('puts April in Q1 of an April fiscal year', () => {
    expect(quarterRange(d('2026-04-15'), APRIL)).toEqual({ from: '2026-04-01', to: '2026-06-30' });
  });

  it('puts March in the quarter that began in January', () => {
    expect(quarterRange(d('2026-03-31'), APRIL)).toEqual({ from: '2026-01-01', to: '2026-03-31' });
  });

  it('falls back to calendar quarters when the fiscal year starts in January', () => {
    expect(quarterRange(d('2026-08-10'), JANUARY)).toEqual({ from: '2026-07-01', to: '2026-09-30' });
  });
});

describe('fiscalYearRange', () => {
  it('runs April to March', () => {
    expect(fiscalYearRange(d('2026-08-10'), APRIL)).toEqual({ from: '2026-04-01', to: '2027-03-31' });
  });

  it('puts a March date in the year that began the previous April (edge case 8)', () => {
    expect(fiscalYearRange(d('2026-03-31'), APRIL)).toEqual({ from: '2025-04-01', to: '2026-03-31' });
  });

  it('is the calendar year when the fiscal year starts in January', () => {
    expect(fiscalYearRange(d('2026-08-10'), JANUARY)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('spans a leap day without losing it', () => {
    const range = fiscalYearRange(d('2028-01-01'), APRIL);
    expect(range).toEqual({ from: '2027-04-01', to: '2028-03-31' });
    expect(daysInRange(range)).toBe(366);
  });

  it('rejects a fiscal month outside 1–12', () => {
    expect(() => fiscalYearRange(d('2026-08-10'), 13)).toThrow();
    expect(() => fiscalYearRange(d('2026-08-10'), 0)).toThrow();
  });
});

describe('daysInRange', () => {
  it('is inclusive on both ends', () => {
    expect(daysInRange({ from: d('2026-08-10'), to: d('2026-08-10') })).toBe(1);
    expect(daysInRange(monthRange(d('2026-02-01')))).toBe(28);
    expect(daysInRange(monthRange(d('2028-02-01')))).toBe(29);
  });
});

describe('previousPeriod', () => {
  it('steps back one calendar month', () => {
    const august = periodContaining(d('2026-08-10'), 'monthly', APRIL);
    expect(previousPeriod(august, 'monthly', APRIL)).toEqual({ from: '2026-07-01', to: '2026-07-31' });
  });

  it('steps back across a year boundary', () => {
    const january = periodContaining(d('2026-01-10'), 'monthly', APRIL);
    expect(previousPeriod(january, 'monthly', APRIL)).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('steps back a whole fiscal year', () => {
    const year = periodContaining(d('2026-08-10'), 'yearly', APRIL);
    expect(previousPeriod(year, 'yearly', APRIL)).toEqual({ from: '2025-04-01', to: '2026-03-31' });
  });

  it('steps back a fiscal quarter', () => {
    const q1 = periodContaining(d('2026-04-15'), 'quarterly', APRIL);
    expect(previousPeriod(q1, 'quarterly', APRIL)).toEqual({ from: '2026-01-01', to: '2026-03-31' });
  });
});

describe('periodsBetween', () => {
  it('enumerates every month a span touches, including partial ones at each end', () => {
    const ranges = periodsBetween(
      { from: d('2026-01-15'), to: d('2026-03-05') },
      'monthly',
      APRIL,
    );
    expect(ranges.map((r) => r.from)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
  });

  it('returns one period when the span sits inside it', () => {
    const ranges = periodsBetween({ from: d('2026-08-05'), to: d('2026-08-06') }, 'monthly', APRIL);
    expect(ranges).toHaveLength(1);
  });

  it('enumerates fiscal years across a boundary', () => {
    const ranges = periodsBetween({ from: d('2025-06-01'), to: d('2026-06-01') }, 'yearly', APRIL);
    expect(ranges.map((r) => r.from)).toEqual(['2025-04-01', '2026-04-01']);
  });
});

describe('elapsedInPeriod', () => {
  const august = monthRange(d('2026-08-01'));

  it('counts the day itself as elapsed', () => {
    expect(elapsedInPeriod(august, d('2026-08-01'))).toEqual({ daysElapsed: 1, daysTotal: 31 });
    expect(elapsedInPeriod(august, d('2026-08-10'))).toEqual({ daysElapsed: 10, daysTotal: 31 });
  });

  it('clamps to the whole period once it has ended', () => {
    expect(elapsedInPeriod(august, d('2026-09-15'))).toEqual({ daysElapsed: 31, daysTotal: 31 });
  });

  it('reports zero before the period starts', () => {
    expect(elapsedInPeriod(august, d('2026-07-31'))).toEqual({ daysElapsed: 0, daysTotal: 31 });
  });
});

describe('rangeContains', () => {
  it('is inclusive at both ends', () => {
    const august = monthRange(d('2026-08-01'));
    expect(rangeContains(august, d('2026-08-01'))).toBe(true);
    expect(rangeContains(august, d('2026-08-31'))).toBe(true);
    expect(rangeContains(august, d('2026-09-01'))).toBe(false);
  });
});

describe('periodLabel', () => {
  it('names a month', () => {
    expect(periodLabel(monthRange(d('2026-08-10')), 'monthly', APRIL)).toBe('August 2026');
  });

  it('names an Indian fiscal year as a span', () => {
    expect(periodLabel(fiscalYearRange(d('2026-08-10'), APRIL), 'yearly', APRIL)).toBe('FY2026-27');
  });

  it('names a calendar fiscal year as one year', () => {
    expect(periodLabel(fiscalYearRange(d('2026-08-10'), JANUARY), 'yearly', JANUARY)).toBe('FY2026');
  });

  it('numbers quarters from the fiscal year start', () => {
    expect(periodLabel(quarterRange(d('2026-04-15'), APRIL), 'quarterly', APRIL)).toBe('Q1 FY2026-27');
    expect(periodLabel(quarterRange(d('2026-03-15'), APRIL), 'quarterly', APRIL)).toBe('Q4 FY2025-26');
  });
});
