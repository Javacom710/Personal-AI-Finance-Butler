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

import { createAmfiProvider } from './providers/amfi';
import { createFrankfurterProvider } from './providers/frankfurter';
import { createManualProvider } from './providers/manual';
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

export interface RegistryOptions {
  /**
   * Injected so tests replay fixtures and never touch the network, and so the
   * "a read makes no network call" assertion can pass a fetch that throws.
   */
  readonly fetch?: FetchLike;
}

/**
 * The registry this application runs with.
 *
 * Order matters: the first capable adapter wins when an instrument has no pinned
 * provider, and `manual` is deliberately last because it can serve *everything*
 * and would otherwise shadow every real feed.
 *
 * **The commercial equity adapter is not here.** It is a later Phase 6 step,
 * blocked behind its credential/configuration step (OD-3). Adding it is one
 * import and one array entry; nothing above this file changes, which is the
 * property the whole abstraction exists to provide.
 */
export function defaultRegistry(options: RegistryOptions = {}): Registry {
  const fetchImpl: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));

  return createRegistry([
    createAmfiProvider({ fetch: fetchImpl }),
    createFrankfurterProvider({ fetch: fetchImpl }),
    createManualProvider(),
  ]);
}
