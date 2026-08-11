/**
 * `PriceResult` — the discriminated union every price is reported as
 * ([ADR-11](../../../../docs/DECISIONS.md#adr-11--market-data-behind-a-provider-abstraction-with-an-always-available-manual-provider)).
 *
 * Its whole purpose is that the **absence** of a price is a first-class value
 * rather than a zero or a thrown exception. A portfolio value that silently
 * omits an unpriced holding is worse than one that says "₹X across 12 of 14
 * holdings; 2 unpriced", and a valuation that throws turns one bad symbol into a
 * blank dashboard.
 *
 * Phase 4 has no provider registry — that arrives in Phase 6 with the adapters
 * and the refresh job. What exists now is the shape, plus the one source that
 * needs no network: prices the user entered by hand, read from
 * `instrument_quotes`. The staleness classification below is the same one the
 * registry will apply, so nothing about this union changes when providers land.
 */

import type { CurrencyCode } from '../../../lib/decimal/money';
import type { UnitPrice } from '../../../lib/decimal/price';

export type MissingPriceReason =
  /** No adapter claims the instrument, and no manual price has been entered. */
  | 'no_provider'
  /** The provider ran, and does not know the symbol. */
  | 'not_found'
  /**
   * The provider failed, **or** returned a price in a currency that is not the
   * instrument's. The latter is a provider error, not a conversion opportunity:
   * multiplying a quantity by a price in another currency is silently wrong, and
   * the database cannot express the cross-table rule that forbids it.
   */
  | 'provider_error';

export type PriceResult =
  | { readonly status: 'live'; readonly price: UnitPrice; readonly currency: CurrencyCode; readonly asOf: Date; readonly source: string }
  | {
      readonly status: 'cached';
      readonly price: UnitPrice;
      readonly currency: CurrencyCode;
      readonly asOf: Date;
      readonly source: string;
      readonly ageHours: number;
    }
  | {
      readonly status: 'stale';
      readonly price: UnitPrice;
      readonly currency: CurrencyCode;
      readonly asOf: Date;
      readonly source: string;
      readonly ageHours: number;
    }
  | { readonly status: 'missing'; readonly reason: MissingPriceReason };

export type UsablePrice = Extract<PriceResult, { price: UnitPrice }>;

/**
 * A stale price is **used**, and visibly marked (edge case 11). Refusing to use
 * it would blank the portfolio every time a market is closed for a long weekend.
 */
export function isUsable(price: PriceResult): price is UsablePrice {
  return price.status !== 'missing';
}

export const missing = (reason: MissingPriceReason): PriceResult => ({ status: 'missing', reason });

/**
 * Classify a stored quote by its age.
 *
 * Staleness is **computed, not stored** (SCHEMA.md §5): a boolean column would
 * need a job to keep it honest, and a stale flag that is itself stale is worse
 * than none. `now` is injected, so the boundary is testable without a clock.
 */
export function classifyQuote(args: {
  readonly price: UnitPrice;
  readonly currency: CurrencyCode;
  readonly instrumentCurrency: CurrencyCode;
  readonly asOf: Date;
  readonly source: string;
  readonly now: Date;
  readonly staleAfterHours: number;
}): PriceResult {
  // The cross-table rule the database cannot express. A price in the wrong
  // currency is a provider error, never a silently mixed multiplication.
  if (args.currency !== args.instrumentCurrency) return missing('provider_error');

  const ageHours = (args.now.getTime() - args.asOf.getTime()) / 3_600_000;
  const common = {
    price: args.price,
    currency: args.currency,
    asOf: args.asOf,
    source: args.source,
    ageHours,
  } as const;

  // A quote dated in the future is not "fresher than fresh" — it is a clock
  // problem — but it is still the best price available, so it is reported as
  // cached at age zero rather than discarded.
  if (ageHours <= 0) return { ...common, status: 'cached', ageHours: 0 };
  return ageHours > args.staleAfterHours
    ? { ...common, status: 'stale' }
    : { ...common, status: 'cached' };
}
