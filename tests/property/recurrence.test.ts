import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { addDays, compareDates, fromEpochDay, toEpochDay, type IsoDate } from '@/lib/date';
import { expand, nextAfter, parseRrule, type Rrule } from '@/lib/date/rrule';

/**
 * Laws the recurrence expander must obey.
 *
 * The one that matters most operationally is determinism: the posting job
 * re-expands a rule on every run, and a schedule that shifted between runs would
 * post the same commitment on two different dates.
 */

/** Calendar dates between 2000 and 2040, well inside the algorithm's range. */
const date = fc
  .integer({ min: toEpochDay('2000-01-01' as IsoDate), max: toEpochDay('2040-12-31' as IsoDate) })
  .map(fromEpochDay);

const RULE_TEXTS = [
  'FREQ=DAILY',
  'FREQ=DAILY;INTERVAL=7',
  'FREQ=WEEKLY',
  'FREQ=WEEKLY;INTERVAL=2',
  'FREQ=WEEKLY;BYDAY=MO,WE,FR',
  'FREQ=MONTHLY',
  'FREQ=MONTHLY;BYMONTHDAY=1',
  'FREQ=MONTHLY;BYMONTHDAY=31',
  'FREQ=MONTHLY;BYMONTHDAY=-1',
  'FREQ=MONTHLY;BYMONTHDAY=1,15',
  'FREQ=MONTHLY;INTERVAL=3',
  'FREQ=YEARLY',
] as const;

const rrule = fc.constantFrom(...RULE_TEXTS).map((text): Rrule => {
  const parsed = parseRrule(text);
  if (!parsed.ok) throw new Error(`fixture rrule did not parse: ${text}`);
  return parsed.value;
});

/** A start date and a window that begins at or after it, capped to two years. */
const scenario = fc
  .tuple(rrule, date, fc.nat({ max: 400 }), fc.nat({ max: 400 }))
  .map(([rule, startsOn, offset, span]) => ({
    rule,
    startsOn,
    window: { from: addDays(startsOn, offset), to: addDays(startsOn, offset + span) },
  }));

describe('expand', () => {
  it('is deterministic — the same inputs give the same dates', () => {
    fc.assert(
      fc.property(scenario, ({ rule, startsOn, window }) => {
        expect(expand(rule, startsOn, window)).toEqual(expand(rule, startsOn, window));
      }),
    );
  });

  it('returns dates in strictly ascending order, with no duplicates', () => {
    fc.assert(
      fc.property(scenario, ({ rule, startsOn, window }) => {
        const dates = expand(rule, startsOn, window);
        for (let i = 1; i < dates.length; i += 1) {
          // Strictly ascending: a duplicate date would become two occurrence
          // rows fighting over one `UNIQUE (rule_id, due_on)` slot.
          expect(compareDates(dates[i - 1]!, dates[i]!)).toBe(-1);
        }
      }),
    );
  });

  it('never emits a date outside the window', () => {
    fc.assert(
      fc.property(scenario, ({ rule, startsOn, window }) => {
        for (const d of expand(rule, startsOn, window)) {
          expect(compareDates(d, window.from)).toBeGreaterThanOrEqual(0);
          expect(compareDates(d, window.to)).toBeLessThanOrEqual(0);
        }
      }),
    );
  });

  it('never emits a date before the rule starts', () => {
    fc.assert(
      fc.property(
        fc.tuple(rrule, date, fc.nat({ max: 400 })),
        ([rule, startsOn, span]) => {
          const dates = expand(rule, startsOn, {
            from: addDays(startsOn, -500),
            to: addDays(startsOn, span),
          });
          for (const d of dates) {
            expect(compareDates(d, startsOn)).toBeGreaterThanOrEqual(0);
          }
        },
      ),
    );
  });

  it('respects an end date exactly', () => {
    fc.assert(
      fc.property(scenario, fc.nat({ max: 300 }), ({ rule, startsOn, window }, endOffset) => {
        const endsOn = addDays(startsOn, endOffset);
        for (const d of expand(rule, startsOn, window, endsOn)) {
          expect(compareDates(d, endsOn)).toBeLessThanOrEqual(0);
        }
      }),
    );
  });

  it('splitting the window in two yields the same dates as one expansion', () => {
    fc.assert(
      fc.property(
        fc.tuple(rrule, date, fc.nat({ max: 300 }), fc.nat({ max: 300 })),
        ([rule, startsOn, cut, tail]) => {
          const whole = { from: startsOn, to: addDays(startsOn, cut + tail) };
          const first = expand(rule, startsOn, { from: startsOn, to: addDays(startsOn, cut) });
          const second = expand(rule, startsOn, {
            from: addDays(startsOn, cut + 1),
            to: whole.to,
          });

          // The posting job relies on this: it expands from the last
          // materialised date forward, and must not lose or repeat a date at
          // the seam.
          expect([...first, ...second]).toEqual(expand(rule, startsOn, whole));
        },
      ),
    );
  });
});

describe('nextAfter', () => {
  it('agrees with the first date expand produces after the same point', () => {
    fc.assert(
      fc.property(
        fc.tuple(rrule, date, fc.nat({ max: 200 })),
        ([rule, startsOn, offset]) => {
          const after = addDays(startsOn, offset);
          const viaExpand = expand(rule, startsOn, {
            from: addDays(after, 1),
            // Two years is beyond the longest gap any supported rule produces.
            to: addDays(after, 800),
          })[0];

          expect(nextAfter(rule, startsOn, after)).toBe(viaExpand ?? null);
        },
      ),
    );
  });
});
