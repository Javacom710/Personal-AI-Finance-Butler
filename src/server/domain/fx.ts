/**
 * FX rate selection (FINANCIAL-DOMAIN.md §2).
 *
 * Pure: the caller fetches candidate rows, this decides which one applies. The
 * split matters because the *rule* is where the correctness lives:
 *
 * - Exact `as_of` match, else the most recent **earlier** date, else `no_rate`.
 * - **Never** interpolate, and never use a later rate for an earlier date. Doing
 *   so would make last March's totals change every time a new rate arrives.
 * - `rate(X, X, _) = 1` without a table lookup.
 * - If `(base, quote)` is missing but `(quote, base)` exists, use `1 / rate` at
 *   `RATE_SCALE` with `half_even`, and record that it was derived so an audit
 *   can see the inversion.
 */

import { compareDates, type IsoDate } from '../../lib/date';
import type { CurrencyCode } from '../../lib/decimal/money';
import { invert, Rate } from '../../lib/decimal/rate';
import { err, ok, type Result } from '../../lib/result';

export interface FxRateRow {
  readonly baseCode: CurrencyCode;
  readonly quoteCode: CurrencyCode;
  readonly asOf: IsoDate;
  /** 1 base = `rate` quote. */
  readonly rate: Rate;
}

export interface FxSelection {
  readonly rate: Rate;
  /** The date of the row actually used, which may be earlier than the date asked for. */
  readonly asOf: IsoDate;
  readonly source: 'identity' | 'direct' | 'inverse';
}

export type FxUnavailable = 'no_rate';

/**
 * Choose the rate converting `from` into `to`, in force on `on`.
 *
 * `rows` may contain anything; rows dated after `on` are ignored rather than
 * trusted, so passing an unfiltered table is safe.
 */
export function selectRate(
  rows: readonly FxRateRow[],
  from: CurrencyCode,
  to: CurrencyCode,
  on: IsoDate,
): Result<FxSelection, FxUnavailable> {
  if (from === to) {
    return ok({ rate: Rate.one(), asOf: on, source: 'identity' });
  }

  let direct: FxRateRow | null = null;
  let inverse: FxRateRow | null = null;

  for (const row of rows) {
    if (compareDates(row.asOf, on) > 0) continue;

    if (row.baseCode === from && row.quoteCode === to) {
      if (!direct || compareDates(row.asOf, direct.asOf) > 0) direct = row;
    } else if (row.baseCode === to && row.quoteCode === from) {
      if (!inverse || compareDates(row.asOf, inverse.asOf) > 0) inverse = row;
    }
  }

  // A direct rate always wins, even when an inverse row is more recent: the
  // stored direction is the one that was actually quoted.
  if (direct) return ok({ rate: direct.rate, asOf: direct.asOf, source: 'direct' });
  if (inverse) {
    return ok({ rate: invert(inverse.rate, 'half_even'), asOf: inverse.asOf, source: 'inverse' });
  }

  return err('no_rate');
}
