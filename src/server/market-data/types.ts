/**
 * The market-data contract — observations in, nothing decided
 * ([ADR-27](../../../docs/DECISIONS.md#adr-27--market-data-adapters-return-observations-the-registry-classifies-freshness),
 * [INVESTMENT-DOMAIN.md §10](../../../docs/INVESTMENT-DOMAIN.md#10-market-data-architecture)).
 *
 * Two rules give this file its shape, and both exist to stop a provider from
 * making a decision that belongs to the system:
 *
 * 1. **An adapter reports what it observed, never a verdict.** There is no
 *    `'stale'` in any type here. `live` / `cached` / `stale` is a judgement
 *    about age relative to *now*; if each adapter made it, two adapters could
 *    reach different verdicts about the same age and "stale" would stop being a
 *    property of the system. `freshness.ts` makes it once.
 *
 * 2. **Every operation returns a `Result<_, ProviderFailure>`.** "This
 *    instrument has no history" and "the provider was down" demand opposite
 *    responses — the first must stop retrying, the second must retry — so a
 *    bare array or a `null` guarantees one of the two behaves wrongly.
 *
 * Nothing here imports a provider, and nothing outside `providers/` may name
 * one. Provider credentials are read inside `providers/**` and nowhere else
 * (SECURITY.md); the two adapters that ship in this phase need none.
 */

import type { IsoDate } from '../../lib/date';
import type { CurrencyCode } from '../../lib/decimal/money';
import type { Rate } from '../../lib/decimal/rate';
import type { UnitPrice } from '../../lib/decimal/price';
import type { AssetClass } from '../domain/pricing/valuation';

// --------------------------------------------------------------- identifiers

/** Registered adapter keys. `instruments.price_provider` holds one of these. */
export type ProviderKey = 'manual' | 'amfi' | 'frankfurter' | 'twelvedata';

/**
 * ISO 10383 MIC. Provider-specific formats — `.NS`, `.BO`, `NSE:`, `INFY.NSE` —
 * are adapter-local and never reach this layer or the database
 * ([MARKET-DATA-DESIGN.md §8.2](../../../docs/MARKET-DATA-DESIGN.md#82-exchanges)).
 */
export type Mic = string & { readonly __brand: 'Mic' };

export function mic(s: string): Mic {
  const upper = s.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(upper)) {
    throw new TypeError(`mic: expected a 4-character ISO 10383 code, received ${JSON.stringify(s)}`);
  }
  return upper as Mic;
}

/**
 * What an adapter needs to fetch one instrument.
 *
 * This is the *lookup key*, deliberately separate from identity: identity is
 * `instruments.id`, a uuid, and every lot, position and price row hangs off it.
 * That separation is why a ticker rename is a metadata edit rather than a data
 * migration.
 */
export interface ProviderRef {
  /** `instruments.id`. Carried through so a result can be attributed without a second lookup. */
  readonly instrumentId: string;
  /** `instruments.provider_symbol` where set, else the symbol. */
  readonly providerSymbol: string;
  readonly exchange: Mic | null;
  /** Preferred cross-provider bridge where the provider supports it (M13). */
  readonly isin: string | null;
  readonly currency: CurrencyCode;
  readonly assetClass: AssetClass;
}

export type ProviderRefKey = string;

/** Keyed by instrument id: unique per user, and what the caller wants back. */
export function refKey(ref: ProviderRef): ProviderRefKey {
  return ref.instrumentId;
}

export interface CurrencyPair {
  readonly base: CurrencyCode;
  readonly quote: CurrencyCode;
}

export type PairKey = string;

export function pairKey(pair: CurrencyPair): PairKey {
  return `${pair.base}/${pair.quote}`;
}

// -------------------------------------------------------------- capabilities

/**
 * How an observation ages, which decides which freshness rule applies
 * ([ADR-28](../../../docs/DECISIONS.md#adr-28--staleness-is-measured-in-trading-sessions-not-wall-clock-hours)).
 *
 * `eod` and `nav` are session-traded and age in **sessions**; `continuous` ages
 * in hours. `intraday` is declared but no adapter uses it: a delayed intraday
 * price and an end-of-day close age on different clocks, and admitting both
 * into one figure would make a single staleness rule impossible.
 */
export type Cadence = 'eod' | 'nav' | 'intraday' | 'continuous';

export type ProviderOperation =
  | 'latest'
  | 'history'
  | 'corporate_actions'
  | 'dividends'
  | 'fx'
  | 'search'
  | 'metadata'
  | 'trading_calendar';

/**
 * What an adapter can actually do.
 *
 * The registry refuses a resolution these do not cover rather than calling and
 * interpreting a confusing `not_found` — the same rule as `CLAUDE.md
 * <model_fallbacks>`: never downgrade a task to an incapable provider merely
 * because it is available.
 */
export interface ProviderCapabilities {
  readonly assetClasses: readonly AssetClass[];
  /** Empty means market-agnostic (FX, mutual funds — neither has an exchange). */
  readonly markets: readonly Mic[];
  readonly cadence: Cadence;
  /** Earliest data available; `null` when the provider does not state one. */
  readonly historyFrom: IsoDate | null;
  readonly provides: readonly ProviderOperation[];
  /**
   * Asserted by a test. The two adapters shipping in this phase are `false`,
   * which is why they need no configuration and cannot leak a secret.
   */
  readonly requiresCredential: boolean;
}

// -------------------------------------------------------------- observations

/**
 * One price, as the provider reported it.
 *
 * `tradingDate` and `observedAt` are separate on purpose. The first is the
 * session in the **market's** timezone and is what `instrument_prices.as_of`
 * stores; the second is the instant the value was true, and must be the
 * exchange's official close on that date — not midnight, and never the fetch
 * time, because those differ by up to ten hours and that is enough to move a
 * staleness boundary (SCHEMA.md §5).
 */
export interface PriceObservation {
  readonly instrumentId: string;
  readonly close: UnitPrice;
  readonly currency: CurrencyCode;
  readonly tradingDate: IsoDate;
  readonly observedAt: Date;
  readonly kind: Exclude<Cadence, 'nav'> | 'nav';
  /** `'amfi'`, `'frankfurter'`, `'twelvedata:XNSE'`. One value per series (I-35). */
  readonly source: string;
  /** The provider's own identifier at fetch time; stored for provenance. */
  readonly providerRef: string | null;
}

export interface FxObservation {
  readonly base: CurrencyCode;
  readonly quote: CurrencyCode;
  readonly rate: Rate;
  readonly asOf: IsoDate;
  /** Records derivation, e.g. `'frankfurter'` vs `'frankfurter:cross'`. */
  readonly source: string;
}

/**
 * A corporate action a provider believes happened.
 *
 * `ratioNum` / `ratioDen` mirror `investment_transactions` exactly, so an
 * accepted detection maps onto a proposed ledger row with no translation step
 * where an inversion could creep in. It is **never** written to the ledger by
 * anything in this layer
 * ([ADR-29](../../../docs/DECISIONS.md#adr-29--provider-corporate-actions-are-detections-never-ledger-writes)).
 */
export interface CorporateActionObservation {
  readonly instrumentId: string;
  readonly kind: 'split' | 'bonus';
  readonly exDate: IsoDate;
  readonly ratioNum: number;
  readonly ratioDen: number;
  readonly source: string;
}

/**
 * A declared dividend. Informational only: the financial fact is the ledger row
 * the user records at the amount actually received net of TDS, which a
 * provider's declared per-share figure is not.
 */
export interface DividendObservation {
  readonly instrumentId: string;
  readonly exDate: IsoDate;
  readonly payDate: IsoDate | null;
  readonly amountPerUnit: UnitPrice;
  readonly currency: CurrencyCode;
  readonly source: string;
}

export interface InstrumentMetadata {
  readonly name: string;
  readonly currency: CurrencyCode;
  readonly exchange: Mic | null;
  readonly isin: string | null;
  readonly assetClass: AssetClass;
  readonly providerSymbol: string;
}

export interface InstrumentCandidate extends InstrumentMetadata {
  readonly source: string;
}

// ------------------------------------------------------------------ failures

/**
 * Why an adapter could not answer.
 *
 * Five members, not one, because they demand different responses. Collapsing
 * `not_found` into `transport` makes a permanent condition look transient and
 * produces an infinite retry; collapsing `rate_limited` into it does the
 * reverse. `ROADMAP.md` Phase 6 requires all seven failure modes to produce a
 * result rather than a throw, and these five plus the registry's mapping are
 * how that is met.
 */
export type ProviderFailure =
  /** The provider ran and does not know this instrument. Permanent — stop retrying. */
  | { readonly kind: 'not_found' }
  /** Quota exhausted. Transient — retry, honouring `retryAfterSeconds` when given. */
  | { readonly kind: 'rate_limited'; readonly retryAfterSeconds: number | null }
  /** The adapter cannot serve this asset class or operation at all. Permanent. */
  | { readonly kind: 'unsupported'; readonly detail: string }
  /** Network, timeout, or a non-2xx status. Transient. */
  | { readonly kind: 'transport'; readonly detail: string }
  /**
   * The response arrived and could not be trusted: unparseable, a price with
   * more precision than `UnitPrice` holds, a negative close, an impossible
   * date. **Nothing is written.** Transient only in the sense that the provider
   * may fix it; never in the sense that the data may be used.
   */
  | { readonly kind: 'malformed'; readonly detail: string };

export const failure = {
  notFound: (): ProviderFailure => ({ kind: 'not_found' }),
  rateLimited: (retryAfterSeconds: number | null = null): ProviderFailure => ({
    kind: 'rate_limited',
    retryAfterSeconds,
  }),
  unsupported: (detail: string): ProviderFailure => ({ kind: 'unsupported', detail }),
  transport: (detail: string): ProviderFailure => ({ kind: 'transport', detail }),
  malformed: (detail: string): ProviderFailure => ({ kind: 'malformed', detail }),
} as const;

/** Transient failures are worth retrying; permanent ones burn quota forever. */
export function isTransient(f: ProviderFailure): boolean {
  return f.kind === 'rate_limited' || f.kind === 'transport';
}

export function describeFailure(f: ProviderFailure): string {
  switch (f.kind) {
    case 'not_found':
      return 'not recognised by the provider';
    case 'rate_limited':
      return f.retryAfterSeconds === null
        ? 'provider rate limit reached'
        : `provider rate limit reached; retry after ${f.retryAfterSeconds}s`;
    case 'unsupported':
      return `unsupported: ${f.detail}`;
    case 'transport':
      return `provider unreachable: ${f.detail}`;
    case 'malformed':
      return `provider response rejected: ${f.detail}`;
  }
}

// ------------------------------------------------------------- the interface

import type { Result } from '../../lib/result';

/**
 * Every adapter implements this. Optional members are the ones an adapter may
 * legitimately not provide — the registry checks `capabilities.provides` before
 * calling, so an absent method is a declared limitation rather than a crash.
 */
export interface MarketDataProvider {
  readonly key: ProviderKey;
  readonly capabilities: ProviderCapabilities;

  /** Cheap, synchronous, and consulted before any network call. */
  supports(ref: ProviderRef): boolean;

  getInstrument?(ref: ProviderRef): Promise<Result<InstrumentMetadata, ProviderFailure>>;

  searchInstruments?(
    query: string,
    hint?: AssetClass,
  ): Promise<Result<readonly InstrumentCandidate[], ProviderFailure>>;

  /**
   * Batched: one network round trip per provider, not per instrument. A partial
   * result is normal and expected — the map carries a `Result` per ref so one
   * unknown symbol never fails the other twenty-nine.
   */
  getLatestPrices?(
    refs: readonly ProviderRef[],
  ): Promise<Map<ProviderRefKey, Result<PriceObservation, ProviderFailure>>>;

  getHistoricalPrices?(
    ref: ProviderRef,
    from: IsoDate,
    to: IsoDate,
  ): Promise<Result<readonly PriceObservation[], ProviderFailure>>;

  getCorporateActions?(
    ref: ProviderRef,
    from: IsoDate,
    to: IsoDate,
  ): Promise<Result<readonly CorporateActionObservation[], ProviderFailure>>;

  getDividends?(
    ref: ProviderRef,
    from: IsoDate,
    to: IsoDate,
  ): Promise<Result<readonly DividendObservation[], ProviderFailure>>;

  getFxRates?(
    pairs: readonly CurrencyPair[],
    on?: IsoDate,
  ): Promise<Map<PairKey, Result<FxObservation, ProviderFailure>>>;
}
