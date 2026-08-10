import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/date';
import {
  describeRrule,
  expand,
  formatRrule,
  nextAfter,
  parseRrule,
  startOfWeek,
  weekdayIndex,
  type Rrule,
} from '@/lib/date/rrule';

const d = isoDate;
const rule = (text: string): Rrule => {
  const parsed = parseRrule(text);
  if (!parsed.ok) throw new Error(`fixture rrule did not parse: ${parsed.error.message}`);
  return parsed.value;
};

const between = (from: string, to: string) => ({ from: d(from), to: d(to) });

describe('parseRrule', () => {
  it('parses the minimum: a frequency', () => {
    expect(rule('FREQ=MONTHLY')).toEqual({ freq: 'MONTHLY', interval: 1 });
  });

  it('accepts an RRULE: prefix, as a calendar export produces', () => {
    expect(rule('RRULE:FREQ=WEEKLY;INTERVAL=2').interval).toBe(2);
  });

  it('sorts and de-duplicates BYMONTHDAY, with -1 last', () => {
    expect(rule('FREQ=MONTHLY;BYMONTHDAY=15,1,-1,15').byMonthDay).toEqual([1, 15, -1]);
  });

  it('sorts BYDAY into week order', () => {
    expect(rule('FREQ=WEEKLY;BYDAY=FR,MO,WE').byDay).toEqual(['MO', 'WE', 'FR']);
  });

  it('accepts UNTIL in the calendar form and in ISO', () => {
    expect(rule('FREQ=MONTHLY;UNTIL=20261231').until).toBe('2026-12-31');
    expect(rule('FREQ=MONTHLY;UNTIL=2026-12-31').until).toBe('2026-12-31');
  });

  it('rejects an unsupported part rather than ignoring it', () => {
    // Silently dropping BYSETPOS would produce a schedule the user did not describe.
    const parsed = parseRrule('FREQ=MONTHLY;BYSETPOS=-1');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.code).toBe('unsupported');
  });

  it('rejects a missing FREQ', () => {
    expect(parseRrule('INTERVAL=2').ok).toBe(false);
  });

  it('rejects BYDAY outside WEEKLY, where this subset gives it no meaning', () => {
    expect(parseRrule('FREQ=MONTHLY;BYDAY=MO').ok).toBe(false);
  });

  it('rejects BYMONTHDAY on a daily or weekly rule', () => {
    expect(parseRrule('FREQ=DAILY;BYMONTHDAY=1').ok).toBe(false);
    expect(parseRrule('FREQ=WEEKLY;BYMONTHDAY=1').ok).toBe(false);
  });

  it('rejects an out-of-range BYMONTHDAY', () => {
    expect(parseRrule('FREQ=MONTHLY;BYMONTHDAY=32').ok).toBe(false);
    expect(parseRrule('FREQ=MONTHLY;BYMONTHDAY=-2').ok).toBe(false);
    expect(parseRrule('FREQ=MONTHLY;BYMONTHDAY=0').ok).toBe(false);
  });

  it('rejects COUNT and UNTIL together — they would disagree', () => {
    expect(parseRrule('FREQ=MONTHLY;COUNT=3;UNTIL=20261231').ok).toBe(false);
  });

  it('rejects a repeated part', () => {
    expect(parseRrule('FREQ=MONTHLY;INTERVAL=1;INTERVAL=2').ok).toBe(false);
  });

  it('round-trips through formatRrule', () => {
    for (const text of [
      'FREQ=DAILY',
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE',
      'FREQ=MONTHLY;BYMONTHDAY=1,-1',
      'FREQ=MONTHLY;COUNT=12',
      'FREQ=YEARLY;UNTIL=20301231',
    ]) {
      expect(formatRrule(rule(text))).toBe(text);
    }
  });
});

describe('weekday helpers', () => {
  it('indexes Monday as 0', () => {
    // 2026-08-10 is a Monday.
    expect(weekdayIndex(d('2026-08-10'))).toBe(0);
    expect(weekdayIndex(d('2026-08-16'))).toBe(6);
    expect(startOfWeek(d('2026-08-16'))).toBe('2026-08-10');
  });
});

describe('MONTHLY — the month-end rule', () => {
  it('puts the 31st on the last day of a 30-day month, not the 1st of the next', () => {
    const dates = expand(rule('FREQ=MONTHLY;BYMONTHDAY=31'), d('2026-01-31'), between('2026-01-01', '2026-07-31'));
    expect(dates).toEqual([
      '2026-01-31',
      '2026-02-28', // clamped, not skipped
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
      '2026-07-31',
    ]);
  });

  it('clamps to 29 February in a leap year', () => {
    const dates = expand(rule('FREQ=MONTHLY;BYMONTHDAY=31'), d('2028-01-31'), between('2028-01-01', '2028-03-31'));
    expect(dates).toEqual(['2028-01-31', '2028-02-29', '2028-03-31']);
  });

  it('treats BYMONTHDAY=-1 as the last day of every month', () => {
    const dates = expand(rule('FREQ=MONTHLY;BYMONTHDAY=-1'), d('2026-01-01'), between('2026-01-01', '2026-04-30'));
    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('never emits the same date twice when 31 and -1 resolve together', () => {
    const dates = expand(
      rule('FREQ=MONTHLY;BYMONTHDAY=31,-1'),
      d('2026-01-01'),
      between('2026-01-01', '2026-02-28'),
    );
    expect(dates).toEqual(['2026-01-31', '2026-02-28']);
  });

  it('uses the start date’s day when no BYMONTHDAY is given', () => {
    const dates = expand(rule('FREQ=MONTHLY'), d('2026-01-15'), between('2026-01-01', '2026-04-30'));
    expect(dates).toEqual(['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15']);
  });

  it('honours INTERVAL for a quarterly rule', () => {
    const dates = expand(rule('FREQ=MONTHLY;INTERVAL=3'), d('2026-01-10'), between('2026-01-01', '2026-12-31'));
    expect(dates).toEqual(['2026-01-10', '2026-04-10', '2026-07-10', '2026-10-10']);
  });

  it('emits multiple days within one month, in order', () => {
    const dates = expand(
      rule('FREQ=MONTHLY;BYMONTHDAY=1,15'),
      d('2026-01-01'),
      between('2026-01-01', '2026-02-28'),
    );
    expect(dates).toEqual(['2026-01-01', '2026-01-15', '2026-02-01', '2026-02-15']);
  });

  it('does not emit a date before the rule starts', () => {
    const dates = expand(
      rule('FREQ=MONTHLY;BYMONTHDAY=1,15'),
      d('2026-01-15'),
      between('2026-01-01', '2026-02-28'),
    );
    expect(dates).toEqual(['2026-01-15', '2026-02-01', '2026-02-15']);
  });
});

describe('DAILY and WEEKLY', () => {
  it('walks daily from the start date', () => {
    expect(expand(rule('FREQ=DAILY'), d('2026-08-10'), between('2026-08-10', '2026-08-13'))).toEqual([
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
      '2026-08-13',
    ]);
  });

  it('honours a daily interval', () => {
    expect(expand(rule('FREQ=DAILY;INTERVAL=3'), d('2026-08-10'), between('2026-08-10', '2026-08-20'))).toEqual([
      '2026-08-10',
      '2026-08-13',
      '2026-08-16',
      '2026-08-19',
    ]);
  });

  it('repeats weekly on the start date’s weekday when no BYDAY is given', () => {
    expect(expand(rule('FREQ=WEEKLY'), d('2026-08-10'), between('2026-08-01', '2026-09-01'))).toEqual([
      '2026-08-10',
      '2026-08-17',
      '2026-08-24',
      '2026-08-31',
    ]);
  });

  it('is fortnightly with INTERVAL=2', () => {
    expect(
      expand(rule('FREQ=WEEKLY;INTERVAL=2'), d('2026-08-10'), between('2026-08-01', '2026-09-30')),
    ).toEqual(['2026-08-10', '2026-08-24', '2026-09-07', '2026-09-21']);
  });

  it('emits each listed weekday, skipping days before the start in the first week', () => {
    // Starts on Wednesday 2026-08-12; Monday of that week is in the past.
    expect(
      expand(rule('FREQ=WEEKLY;BYDAY=MO,FR'), d('2026-08-12'), between('2026-08-01', '2026-08-31')),
    ).toEqual(['2026-08-14', '2026-08-17', '2026-08-21', '2026-08-24', '2026-08-28', '2026-08-31']);
  });

  it('anchors interval weeks to the week containing the start date', () => {
    expect(
      expand(rule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO'), d('2026-08-10'), between('2026-08-01', '2026-09-30')),
    ).toEqual(['2026-08-10', '2026-08-24', '2026-09-07', '2026-09-21']);
  });
});

describe('YEARLY', () => {
  it('repeats on the same month and day', () => {
    expect(expand(rule('FREQ=YEARLY'), d('2026-04-01'), between('2026-01-01', '2029-12-31'))).toEqual([
      '2026-04-01',
      '2027-04-01',
      '2028-04-01',
      '2029-04-01',
    ]);
  });

  it('clamps 29 February to the 28th in non-leap years', () => {
    expect(expand(rule('FREQ=YEARLY'), d('2028-02-29'), between('2028-01-01', '2032-12-31'))).toEqual([
      '2028-02-29',
      '2029-02-28',
      '2030-02-28',
      '2031-02-28',
      '2032-02-29',
    ]);
  });
});

describe('termination', () => {
  it('stops after COUNT occurrences, counted from the start of the series', () => {
    expect(expand(rule('FREQ=MONTHLY;COUNT=3'), d('2026-01-10'), between('2026-01-01', '2026-12-31'))).toEqual([
      '2026-01-10',
      '2026-02-10',
      '2026-03-10',
    ]);
  });

  it('counts occurrences before the query window against COUNT', () => {
    // A window opening in March must know that January and February already
    // consumed two of the three occurrences.
    expect(expand(rule('FREQ=MONTHLY;COUNT=3'), d('2026-01-10'), between('2026-03-01', '2026-12-31'))).toEqual([
      '2026-03-10',
    ]);
  });

  it('includes the UNTIL date itself', () => {
    expect(
      expand(rule('FREQ=MONTHLY;UNTIL=20260310'), d('2026-01-10'), between('2026-01-01', '2026-12-31')),
    ).toEqual(['2026-01-10', '2026-02-10', '2026-03-10']);
  });

  it('stops at the rule’s own end date mid-expansion (edge case 12)', () => {
    expect(
      expand(rule('FREQ=MONTHLY'), d('2026-01-10'), between('2026-01-01', '2026-12-31'), d('2026-03-31')),
    ).toEqual(['2026-01-10', '2026-02-10', '2026-03-10']);
  });

  it('takes whichever of UNTIL and the end date comes first', () => {
    expect(
      expand(
        rule('FREQ=MONTHLY;UNTIL=20260610'),
        d('2026-01-10'),
        between('2026-01-01', '2026-12-31'),
        d('2026-02-28'),
      ),
    ).toEqual(['2026-01-10', '2026-02-10']);
  });

  it('returns nothing for an inverted window', () => {
    expect(expand(rule('FREQ=DAILY'), d('2026-01-01'), between('2026-03-01', '2026-02-01'))).toEqual([]);
  });
});

describe('nextAfter', () => {
  it('finds the next occurrence strictly after a date', () => {
    expect(nextAfter(rule('FREQ=MONTHLY;BYMONTHDAY=1'), d('2026-01-01'), d('2026-03-01'))).toBe('2026-04-01');
  });

  it('returns the same day when asked from the day before', () => {
    expect(nextAfter(rule('FREQ=MONTHLY;BYMONTHDAY=1'), d('2026-01-01'), d('2026-02-28'))).toBe('2026-03-01');
  });

  it('returns null once the series has ended', () => {
    expect(nextAfter(rule('FREQ=MONTHLY;COUNT=2'), d('2026-01-10'), d('2026-06-01'))).toBeNull();
    expect(nextAfter(rule('FREQ=MONTHLY'), d('2026-01-10'), d('2026-06-01'), d('2026-03-01'))).toBeNull();
  });
});

describe('describeRrule', () => {
  it('produces something a person can read', () => {
    expect(describeRrule(rule('FREQ=MONTHLY'))).toBe('Monthly');
    expect(describeRrule(rule('FREQ=MONTHLY;BYMONTHDAY=-1'))).toBe('Monthly on day last');
    expect(describeRrule(rule('FREQ=WEEKLY;INTERVAL=2'))).toBe('Every 2 weeks');
    expect(describeRrule(rule('FREQ=MONTHLY;COUNT=12'))).toBe('Monthly, 12 times');
  });
});
