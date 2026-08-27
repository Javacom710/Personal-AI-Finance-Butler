import 'server-only';

/**
 * The FX lookup a request holds (FINANCIAL-DOMAIN.md §2).
 *
 * The **rule** — exact date, else most recent earlier, else `no_rate`; never
 * interpolate; invert only as a fallback — lives in the pure
 * `src/server/domain/fx.ts`. This file does nothing but fetch the candidate
 * rows and hand them over.
 *
 * Rates are loaded once per request rather than per conversion, so the lookup
 * is **synchronous**: a pure calculation must not await a rate in the middle of
 * a sum. Only pairs touching the base currency are loaded, because every
 * conversion in the money domain is `X → base` — a cross-currency transfer
 * converts each leg to base separately rather than to each other.
 */

import { eq, or } from 'drizzle-orm';

import type { IsoDate } from '../../lib/date';
import { isoDate } from '../../lib/date';
import { currency, mulRate, type CurrencyCode, type Money } from '../../lib/decimal/money';
import { Rate } from '../../lib/decimal/rate';
import { err, ok, type Result } from '../../lib/result';
import { rateSelector, type FxRateRow, type FxSelection, type FxUnavailable } from '../domain/fx';
import type { DbExecutor } from '../db/client';
import { fxRates } from '../db/schema';

export interface FxConversion {
  readonly amount: Money;
  readonly rate: Rate;
  readonly selection: FxSelection;
}

export interface FxLookup {
  /** The rate converting `from` into `to`, in force on `on`. */
  rate(from: CurrencyCode, to: CurrencyCode, on: IsoDate): Result<FxSelection, FxUnavailable>;
  /** Convert an amount, rounding `half_up` at scale 4 — the same mode the database `CHECK` uses. */
  convert(amount: Money, to: CurrencyCode, on: IsoDate): Result<FxConversion, FxUnavailable>;
  /** The common case: convert into the user's base currency. */
  toBase(amount: Money, on: IsoDate): Result<FxConversion, FxUnavailable>;
  readonly base: CurrencyCode;
  /** How many rate rows were loaded — surfaced so a missing-rate error can say "none are loaded". */
  readonly rateCount: number;
}

export async function createFxLookup(
  executor: DbExecutor,
  base: CurrencyCode,
): Promise<FxLookup> {
  const rows = await executor
    .select({
      baseCode: fxRates.baseCode,
      quoteCode: fxRates.quoteCode,
      asOf: fxRates.asOf,
      rate: fxRates.rate,
    })
    .from(fxRates)
    .where(or(eq(fxRates.baseCode, base), eq(fxRates.quoteCode, base)));

  const parsed: FxRateRow[] = rows.map((row) => ({
    baseCode: currency(row.baseCode.trim()),
    quoteCode: currency(row.quoteCode.trim()),
    asOf: isoDate(row.asOf),
    rate: Rate.fromDbString(row.rate),
  }));

  return fromRows(parsed, base);
}

/** The same lookup over rows supplied directly. Used by tests and by the golden fixtures. */
export function fromRows(rows: readonly FxRateRow[], base: CurrencyCode): FxLookup {
  // Built once per request. The rule is `selectRate`'s, unchanged; what this
  // avoids is re-indexing every stored observation on every conversion, which a
  // market-value SERIES does once per foreign position per point.
  const rate = rateSelector(rows);

  const convert = (amount: Money, to: CurrencyCode, on: IsoDate): Result<FxConversion, FxUnavailable> => {
    const selection = rate(amount.currency, to, on);
    if (!selection.ok) return err(selection.error);
    const converted = mulRate(amount, selection.value.rate, 'half_up');
    return ok({
      amount: { minor: converted.minor, currency: to },
      rate: selection.value.rate,
      selection: selection.value,
    });
  };

  return {
    base,
    rateCount: rows.length,
    rate,
    convert,
    toBase: (amount, on) => convert(amount, base, on),
  };
}
