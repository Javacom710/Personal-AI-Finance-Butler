/**
 * `PriceResult` — the discriminated union every price is reported as
 * ([ADR-11](../../../../docs/DECISIONS.md#adr-11--market-data-behind-a-provider-abstraction-with-an-always-available-manual-provider),
 * [ADR-27](../../../../docs/DECISIONS.md#adr-27--market-data-adapters-return-observations-the-registry-classifies-freshness)).
 *
 * Its whole purpose is that the **absence** of a price is a first-class value
 * rather than a zero or a thrown exception. A portfolio value that silently
 * omits an unpriced holding is worse than one that says "₹X across 12 of 14
 * holdings; 2 unpriced", and a valuation that throws turns one bad symbol into a
 * blank dashboard.
 *
 * **Adapters never construct one of these.** They return observations; this
 * classification is made once, by `classifyQuote` below, over what is stored —
 * so two providers cannot reach different verdicts about the same age
 * (ADR-27). The freshness rule itself lives in `market-data/freshness.ts`,
 * which is the single classifier ADR-28 requires; this module is the shape it
 * is reported in.
 */

import type { CurrencyCode } from '../../../lib/decimal/money';
import type { UnitPrice } from '../../../lib/decimal/price';
import { fromUtcDate, type IsoDate } from '../../../lib/date';
import {
  classifyFreshness,
  DEFAULT_THRESHOLDS,
  type Freshness,
} from '../../market-data/freshness';
import type { Cadence } from '../../market-data/types';

/**
 * Why a holding has no usable price. Seven members, not one, because they call
 * for different responses from the system and from the user — see
 * [INVESTMENT-DOMAIN.md §5](../../../../docs/INVESTMENT-DOMAIN.md#5-valuation).
 *
 * Collapsing `not_found` into `provider_error` makes a permanent condition look
 * transient and produces an infinite retry; collapsing `rate_limited` into it
 * does the reverse.
 */
export type MissingPriceReason =
  /** No adapter claims the instrument, and no manual price has been entered. */
  | 'no_provider'
  /** The provider ran, and does not know the symbol. Permanent: stop retrying, and **never delete stored history**. */
  | 'not_found'
  /**
   * The provider failed, **or** returned a price in a currency that is not the
   * instrument's. The latter is a provider error, not a conversion opportunity:
   * multiplying a quantity by a price in another currency is silently wrong, and
   * the database cannot express the cross-table rule that forbids it (I-33).
   */
  | 'provider_error'
  /** Quota exhausted. Transient — the last good quote stands and the job retries. */
  | 'rate_limited'
  /** An adapter exists but cannot price this asset class. A fixed deposit has no market price; it accrues. */
  | 'unsupported_asset'
  /** The instrument has stopped trading. Cost basis and realised P&L are unaffected. */
  | 'delisted'
  /**
   * A provider corporate action with an ex-date inside the holding period is not
   * in the ledger, so price and quantity are on different sides of it
   * ([ADR-29](../../../../docs/DECISIONS.md#adr-29--provider-corporate-actions-are-detections-never-ledger-writes)).
   * Multiplying them yields a large, internally consistent, wrong number — so the
   * value is **suppressed**, never adjusted.
   */
  | 'unreconciled_corporate_action';

interface UsableCommon {
  readonly price: UnitPrice;
  readonly currency: CurrencyCode;
  readonly asOf: Date;
  readonly source: string;
  readonly ageHours: number;
  /** ADR-28's classification. `status` is the coarse view of the same verdict. */
  readonly freshness: Freshness;
  /** `null` when no trading calendar was available and the hours branch decided. */
  readonly sessionsBehind: number | null;
}

export type PriceResult =
  /**
   * A price from a real-time feed. **No adapter produces this today** — the MVP
   * is end-of-day only, deliberately, because a delayed intraday price and an
   * EOD close age on different clocks and mixing them makes one staleness rule
   * impossible. Retained so a future real-time provider has a home.
   */
  | ({ readonly status: 'live' } & UsableCommon & { readonly freshness: 'current' })
  | ({ readonly status: 'cached' } & UsableCommon & { readonly freshness: 'current' | 'recent' })
  | ({ readonly status: 'stale' } & UsableCommon & { readonly freshness: 'stale' })
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

/** Human-facing, and the same sentence everywhere the reason is shown. */
export function describeMissing(reason: MissingPriceReason): string {
  switch (reason) {
    case 'no_provider':
      return 'no price source — enter one by hand';
    case 'not_found':
      return 'not recognised by its price provider';
    case 'provider_error':
      return 'the price provider returned an error';
    case 'rate_limited':
      return 'the price provider is rate limited — the last price is being kept';
    case 'unsupported_asset':
      return 'this kind of asset is not priced by a market feed';
    case 'delisted':
      return 'no longer trading';
    case 'unreconciled_corporate_action':
      return 'a corporate action is missing from your ledger — record it to resume valuation';
  }
}

export interface ClassifyQuoteArgs {
  readonly price: UnitPrice;
  readonly currency: CurrencyCode;
  readonly instrumentCurrency: CurrencyCode;
  readonly asOf: Date;
  readonly source: string;
  readonly now: Date;
  readonly staleAfterHours: number;
  /**
   * ADR-28's session context. All four are optional together: without them the
   * classifier falls back to the wall-clock branch, which is honest, because
   * with no stored calendar there is nothing to count sessions against.
   */
  readonly cadence?: Cadence;
  readonly staleAfterSessions?: number;
  readonly today?: IsoDate;
  readonly sessions?: readonly IsoDate[];
}

/**
 * Classify a stored quote.
 *
 * Staleness is **computed, not stored** (SCHEMA.md §5): a boolean column would
 * need a job to keep it honest, and a stale flag that is itself stale is worse
 * than none. `now` is injected, so the boundary is testable without a clock.
 *
 * The verdict itself comes from `market-data/freshness.ts` — the one classifier.
 * This function's own job is only the currency guard and the mapping onto the
 * union above.
 */
export function classifyQuote(args: ClassifyQuoteArgs): PriceResult {
  // The cross-table rule the database cannot express (I-33). A price in the
  // wrong currency is a provider error, never a silently mixed multiplication.
  if (args.currency !== args.instrumentCurrency) return missing('provider_error');

  const verdict = classifyFreshness({
    cadence: args.cadence ?? 'eod',
    tradingDate: fromUtcDate(args.asOf),
    observedAt: args.asOf,
    now: args.now,
    today: args.today ?? fromUtcDate(args.now),
    sessions: args.sessions ?? [],
    thresholds: {
      staleAfterHours: args.staleAfterHours,
      staleAfterSessions: args.staleAfterSessions ?? DEFAULT_THRESHOLDS.staleAfterSessions,
    },
  });

  const common = {
    price: args.price,
    currency: args.currency,
    asOf: args.asOf,
    source: args.source,
    ageHours: verdict.ageHours,
    sessionsBehind: verdict.sessionsBehind,
  } as const;

  if (verdict.freshness === 'stale') {
    return { ...common, status: 'stale', freshness: 'stale' };
  }
  return { ...common, status: 'cached', freshness: verdict.freshness };
}
