/**
 * Recurring-rule scheduling (FINANCIAL-DOMAIN.md §7).
 *
 * The recurrence *grammar* lives in `src/lib/date/rrule.ts`; this module applies
 * it to a stored rule — start date, optional end date, active flag — and answers
 * the three questions the application actually asks:
 *
 * - which dates fall due in a window (the posting job),
 * - what is next (the rules list),
 * - what is coming up (the Overview's 14-day commitments).
 *
 * Pure. Idempotency is **not** enforced here: it is the `UNIQUE (rule_id,
 * due_on)` constraint (ADR-15). A pure function cannot know what has already
 * been posted, and pretending otherwise would put the guarantee in the wrong
 * layer.
 */

import { addDays, compareDates, type IsoDate } from '../../../lib/date';
import { expand, nextAfter, type Rrule } from '../../../lib/date/rrule';
import type { DateRange } from '../../../lib/date/periods';

export interface RecurringRuleSpec {
  readonly rrule: Rrule;
  readonly startsOn: IsoDate;
  readonly endsOn: IsoDate | null;
  readonly isActive: boolean;
}

/**
 * Every due date in `window`, inclusive.
 *
 * An inactive rule yields nothing: deactivating a rule stops future postings
 * without deleting the ones already made.
 */
export function dueDates(spec: RecurringRuleSpec, window: DateRange): IsoDate[] {
  if (!spec.isActive) return [];
  return expand(spec.rrule, spec.startsOn, window, spec.endsOn);
}

/** The next due date strictly after `after`, or `null` once the series has ended. */
export function nextDue(spec: RecurringRuleSpec, after: IsoDate): IsoDate | null {
  if (!spec.isActive) return null;
  return nextAfter(spec.rrule, spec.startsOn, after, spec.endsOn);
}

/**
 * Dates due from `today` through `today + horizonDays`, inclusive of both.
 *
 * The Overview shows a 14-day horizon; the posting job uses a longer one so an
 * occurrence row exists before its due date and can be seen coming.
 */
export function upcoming(spec: RecurringRuleSpec, today: IsoDate, horizonDays: number): IsoDate[] {
  if (horizonDays < 0) throw new RangeError(`upcoming: horizonDays must be >= 0, got ${horizonDays}`);
  return dueDates(spec, { from: today, to: addDays(today, horizonDays) });
}

/**
 * Dates due on or before `today` that the job should materialise, starting from
 * `since` — normally the rule's start date, so a rule created with a start date
 * in the past catches up on its first run rather than losing that history.
 */
export function overdue(spec: RecurringRuleSpec, since: IsoDate, today: IsoDate): IsoDate[] {
  if (compareDates(since, today) > 0) return [];
  return dueDates(spec, { from: since, to: today });
}
