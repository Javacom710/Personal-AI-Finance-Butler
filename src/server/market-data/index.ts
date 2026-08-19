import 'server-only';

/**
 * The market-data layer's public surface.
 *
 * Everything above this module works in terms of instruments, observations and
 * `PriceResult`. **No caller outside `providers/` may name a provider** — that
 * rule is what keeps a provider swap to one new file plus one line of
 * `defaultRegistry()` below, and it is asserted by a source scan in the tests
 * ([ARCHITECTURE.md §3](../../../docs/ARCHITECTURE.md)).
 */

import { env } from '../../lib/env';
import { createAmfiProvider } from './providers/amfi';
import { createFrankfurterProvider } from './providers/frankfurter';
import { createManualProvider } from './providers/manual';
import { createTwelveDataProvider } from './providers/twelvedata';
import { createRegistry, type Registry } from './registry';
import type { FetchLike } from './http';

export type {
  Cadence,
  CorporateActionObservation,
  CurrencyPair,
  DividendObservation,
  FxObservation,
  InstrumentCandidate,
  InstrumentMetadata,
  MarketDataProvider,
  Mic,
  PairKey,
  PriceObservation,
  ProviderCapabilities,
  ProviderFailure,
  ProviderKey,
  ProviderOperation,
  ProviderRef,
  ProviderRefKey,
} from './types';
export { describeFailure, failure, isTransient, mic, pairKey, refKey } from './types';

export {
  cadenceForAssetClass,
  classifyFreshness,
  CONTINUOUS_BACKSTOP_DAYS,
  DEFAULT_THRESHOLDS,
  SESSION_BACKSTOP_DAYS,
  sessionsBehind,
  type Freshness,
  type FreshnessThresholds,
  type FreshnessVerdict,
} from './freshness';

export { capable, createRegistry, failureToReason, type Registry } from './registry';
export type { FetchLike } from './http';

export { createTwelveDataProvider } from './providers/twelvedata';
export {
  EXCHANGE_SESSIONS,
  exchangeCloseInstant,
  resolveMic,
  sessionFor,
  supportedMics,
  tradingDateFromLocal,
} from './exchanges';

export interface RegistryOptions {
  /**
   * Injected so tests replay fixtures and never touch the network, and so the
   * "a read makes no network call" assertion can pass a fetch that throws.
   */
  readonly fetch?: FetchLike;
  /**
   * Overrides the environment. Tests pass `null` to exercise the unconfigured
   * path without touching `process.env`, and the live smoke test passes the real
   * key explicitly rather than relying on ambient state.
   */
  readonly twelveDataApiKey?: string | null;
}

/**
 * The registry this application runs with.
 *
 * Order matters: the first capable adapter wins when an instrument has no pinned
 * provider, and `manual` is deliberately last because it can serve *everything*
 * and would otherwise shadow every real feed.
 *
 * **Twelve Data is registered whether or not a key is configured.** An adapter
 * that vanishes when unconfigured would make "why is nothing priced?" depend on
 * which files loaded; registered-but-unconfigured means every call returns the
 * same typed refusal, on every code path, and the reason reaches the screen.
 */
export function defaultRegistry(options: RegistryOptions = {}): Registry {
  const fetchImpl: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const apiKey =
    options.twelveDataApiKey !== undefined ? options.twelveDataApiKey : (env().TWELVE_DATA_API_KEY ?? null);

  return createRegistry([
    createAmfiProvider({ fetch: fetchImpl }),
    createTwelveDataProvider({ fetch: fetchImpl, apiKey }),
    createFrankfurterProvider({ fetch: fetchImpl }),
    createManualProvider(),
  ]);
}

/** Whether equity pricing is configured. For a settings surface, never for a decision. */
export function isEquityProviderConfigured(): boolean {
  return (env().TWELVE_DATA_API_KEY ?? null) !== null;
}
