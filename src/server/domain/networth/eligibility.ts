/**
 * Date-driven eligibility — the normative core of `Net Worth as of T`
 * ([FINANCIAL-DOMAIN.md §9.3](../../../../docs/FINANCIAL-DOMAIN.md#93-calculation),
 * [ADR-26](../../../../docs/DECISIONS.md)).
 *
 * > **Every filter is a date comparison against a recorded fact. `is_active` —
 * > on `accounts`, `manual_assets`, `liabilities` or `instruments` — is read by
 * > no calculation, ever.**
 *
 * `is_active` describes an entity *today*; net worth is computed *as of* a date.
 * Mixing the two rewrites history silently: an account closed this morning
 * vanishes from last year's figure, and the series changes shape every time the
 * user tidies up. **No function in this file takes a flag.** Invariant I-26 is a
 * source scan that asserts the same thing mechanically, because a rule that
 * depends on every future reader remembering it is not a rule.
 *
 * `asOf === null` means the present-tense read — "today, unbounded".
 */

import { compareDates, type IsoDate } from '../../../lib/date';

/** `d <= asOf`, with `null` meaning "no upper bound". */
export function onOrBefore(d: IsoDate, asOf: IsoDate | null): boolean {
  return asOf === null || compareDates(d, asOf) <= 0;
}

/** `d > asOf`, with `null` meaning "no upper bound" (so nothing is after it). */
export function strictlyAfter(d: IsoDate, asOf: IsoDate | null): boolean {
  return asOf !== null && compareDates(d, asOf) > 0;
}

/**
 * An account contributes when it existed at `asOf`.
 *
 * Its **opening balance is gated by the same test** — see
 * `openingContribution()` in the ledger domain. An account whose `opening_date`
 * is after `asOf` is **absent** from the breakdown, not present at zero, so it
 * cannot be confused with one that genuinely held nothing.
 *
 * Closing is not a term here at all: a closed account's balance is already the
 * right answer at every date.
 */
export function accountEligible(openingDate: IsoDate, asOf: IsoDate | null): boolean {
  return onOrBefore(openingDate, asOf);
}

/**
 * A tax lot contributes when it was **opened** on or before `asOf`.
 *
 * **`opened_on`, never `acquired_on`** (invariant I-23). A `transfer_in` carries
 * the original acquisition date forward so a demat transfer does not reset a
 * long-term holding to short-term, and `acquired_on` can precede `opened_on` by
 * years. Using it would place the destination lot in the destination account
 * from the original purchase date — while the source account's lot is *also*
 * still open until its `transfer_out` — counting the same value **twice** for
 * the whole intervening period. This is the one place in the design where a
 * plausible column choice produces a silent double count.
 */
export function lotEligible(openedOn: IsoDate, asOf: IsoDate | null): boolean {
  return onOrBefore(openedOn, asOf);
}

/**
 * A disposal has consumed basis by `asOf` when it closed on or before it.
 * `remainingCost(ℓ, T) = cost_total − Σ cost_consumed where closed_on <= T`.
 */
export function disposalCounted(closedOn: IsoDate, asOf: IsoDate | null): boolean {
  return onOrBefore(closedOn, asOf);
}

export interface ManualAssetDates {
  /** `acquired_on ?? the earliest asset_valuations.as_of`. */
  readonly startOn: IsoDate | null;
  readonly disposedOn: IsoDate | null;
}

/**
 * A manual asset contributes while it is held.
 *
 * - Acquired after `asOf` → **ineligible**. Not an exclusion: it was not yet
 *   held, which is a different statement from "held, value unknown".
 * - `disposed_on > asOf` → still fully present, at its valuation in force.
 * - `disposed_on <= asOf` → gone from that date onward; every earlier figure is
 *   unchanged.
 *
 * An asset with no dates at all is eligible: it exists and has been valued, and
 * the valuation lookup decides what it is worth.
 */
export function manualAssetEligible(dates: ManualAssetDates, asOf: IsoDate | null): boolean {
  if (dates.startOn !== null && !onOrBefore(dates.startOn, asOf)) return false;
  if (dates.disposedOn !== null && onOrBefore(dates.disposedOn, asOf)) return false;
  return true;
}

/**
 * Pick the row in force at `asOf` from a dated series — the greatest
 * `as_of <= asOf`.
 *
 * Used for `valuationInForce` and for a scheduled liability's outstanding, which
 * are the same rule over different tables. `null` when the series has nothing on
 * or before the date: for a manual asset that is *eligible but unvalued*, which
 * is **excluded and named, never zero**; for a liability it means the debt did
 * not yet exist, which contributes nothing.
 *
 * The input need not be sorted.
 */
export function inForce<T extends { readonly asOf: IsoDate }>(
  series: readonly T[],
  asOf: IsoDate | null,
): T | null {
  let best: T | null = null;
  for (const row of series) {
    if (!onOrBefore(row.asOf, asOf)) continue;
    if (best === null || compareDates(row.asOf, best.asOf) > 0) best = row;
  }
  return best;
}
