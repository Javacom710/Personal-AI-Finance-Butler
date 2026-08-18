import 'server-only';

/**
 * The provider registry — selection, capability refusal, and the one place a
 * `ProviderFailure` becomes a `MissingPriceReason`
 * ([ADR-27](../../../docs/DECISIONS.md#adr-27--market-data-adapters-return-observations-the-registry-classifies-freshness),
 * [ADR-30](../../../docs/DECISIONS.md#adr-30--one-provider-per-instrument-price-series-the-only-price-fallback-is-manual)).
 *
 * Nothing above this file learns a provider name. `services/prices.ts` asks for
 * observations and gets observations; `app/**` asks for a `PriceResult` and gets
 * one. Swapping a provider is a new file in `providers/` plus a line in
 * `defaultRegistry()`.
 *
 * **The registry is not on the read path.** A page render never reaches this
 * module: refresh jobs call it, write what comes back to the database, and pages
 * read the database. That is what makes a provider outage invisible to a user
 * until the stored quote ages into `stale`, rather than a spinner or a 500.
 */

import { err, ok, type Result } from '../../lib/result';
import type { IsoDate } from '../../lib/date';
import type { MissingPriceReason } from '../domain/pricing/price-result';
import {
  failure,
  pairKey,
  refKey,
  type CurrencyPair,
  type CorporateActionObservation,
  type FxObservation,
  type MarketDataProvider,
  type PairKey,
  type PriceObservation,
  type ProviderFailure,
  type ProviderKey,
  type ProviderOperation,
  type ProviderRef,
  type ProviderRefKey,
} from './types';

/**
 * `ProviderFailure` → `MissingPriceReason`, in one place.
 *
 * Done here rather than in each adapter so the mapping cannot drift: an adapter
 * that decided its own reason could report a transient outage as `not_found` and
 * silently stop the retry that would have fixed it.
 */
export function failureToReason(f: ProviderFailure): MissingPriceReason {
  switch (f.kind) {
    case 'not_found':
      return 'not_found';
    case 'rate_limited':
      return 'rate_limited';
    case 'unsupported':
      return 'unsupported_asset';
    case 'transport':
    case 'malformed':
      return 'provider_error';
  }
}

export interface Registry {
  readonly providers: readonly MarketDataProvider[];
  get(key: ProviderKey): MarketDataProvider | undefined;
  /**
   * Resolution order (INVESTMENT-DOMAIN.md §10):
   *   1. `instruments.price_provider` if registered **and capable**
   *   2. the first registered adapter whose `supports()` and capabilities admit it
   *   3. `ManualProvider`
   */
  resolve(ref: ProviderRef, pinned: ProviderKey | null, operation: ProviderOperation): Result<MarketDataProvider, ProviderFailure>;
  latestPrices(
    refs: readonly ProviderRef[],
    pinnedFor: (ref: ProviderRef) => ProviderKey | null,
  ): Promise<Map<ProviderRefKey, Result<PriceObservation, ProviderFailure>>>;
  historicalPrices(
    ref: ProviderRef,
    pinned: ProviderKey | null,
    from: IsoDate,
    to: IsoDate,
  ): Promise<Result<readonly PriceObservation[], ProviderFailure>>;
  corporateActions(
    ref: ProviderRef,
    pinned: ProviderKey | null,
    from: IsoDate,
    to: IsoDate,
  ): Promise<Result<readonly CorporateActionObservation[], ProviderFailure>>;
  fxRates(
    pairs: readonly CurrencyPair[],
    on?: IsoDate,
  ): Promise<Map<PairKey, Result<FxObservation, ProviderFailure>>>;
}

/**
 * Can this adapter serve this request at all?
 *
 * Checked **before** the call, so an incapable provider is refused rather than
 * asked and misunderstood — an adapter with no Indian coverage returns
 * `not_found` for a perfectly real NSE symbol, which reads as "this instrument
 * does not exist" and sends the user to fix the wrong thing. Mirrors the
 * model-fallback rule in `CLAUDE.md <model_fallbacks>`.
 */
export function capable(
  provider: MarketDataProvider,
  ref: ProviderRef,
  operation: ProviderOperation,
): boolean {
  const caps = provider.capabilities;
  if (!caps.provides.includes(operation)) return false;
  if (!caps.assetClasses.includes(ref.assetClass)) return false;
  // An empty market list means market-agnostic — mutual funds and FX have no
  // exchange, and an instrument with a null exchange cannot be excluded by one.
  if (caps.markets.length > 0 && ref.exchange !== null && !caps.markets.includes(ref.exchange)) {
    return false;
  }
  return provider.supports(ref);
}

export function createRegistry(providers: readonly MarketDataProvider[]): Registry {
  const byKey = new Map<ProviderKey, MarketDataProvider>(providers.map((p) => [p.key, p]));

  const manual = byKey.get('manual');
  if (!manual) {
    // ADR-11: the manual provider is always registered, because it is what makes
    // "every instrument can always be valued" true rather than aspirational.
    throw new Error('createRegistry: the manual provider must always be registered');
  }

  const resolve: Registry['resolve'] = (ref, pinned, operation) => {
    if (pinned !== null) {
      const explicit = byKey.get(pinned);
      if (!explicit) {
        return err(failure.unsupported(`provider "${pinned}" is not registered`));
      }
      if (!capable(explicit, ref, operation)) {
        return err(failure.unsupported(`provider "${pinned}" cannot serve ${operation} for this instrument`));
      }
      return ok(explicit);
    }

    for (const provider of providers) {
      if (provider.key === 'manual') continue;
      if (capable(provider, ref, operation)) return ok(provider);
    }

    if (capable(manual, ref, operation)) return ok(manual);
    return err(failure.unsupported(`no registered provider serves ${operation} for this instrument`));
  };

  return {
    providers,
    get: (key) => byKey.get(key),
    resolve,

    async latestPrices(refs, pinnedFor) {
      const out = new Map<ProviderRefKey, Result<PriceObservation, ProviderFailure>>();
      if (refs.length === 0) return out;

      // Grouped so each provider is called once with all of its instruments:
      // one round trip per provider, not per instrument.
      const batches = new Map<MarketDataProvider, ProviderRef[]>();

      for (const ref of refs) {
        const resolved = resolve(ref, pinnedFor(ref), 'latest');
        if (!resolved.ok) {
          out.set(refKey(ref), err(resolved.error));
          continue;
        }
        const existing = batches.get(resolved.value);
        if (existing) existing.push(ref);
        else batches.set(resolved.value, [ref]);
      }

      for (const [provider, batch] of batches) {
        if (!provider.getLatestPrices) {
          for (const ref of batch) {
            out.set(refKey(ref), err(failure.unsupported(`${provider.key} does not provide latest prices`)));
          }
          continue;
        }
        // A provider that throws is a bug in that adapter, not a reason for the
        // job to die and leave every other provider unfetched.
        let batchResult: Map<ProviderRefKey, Result<PriceObservation, ProviderFailure>>;
        try {
          batchResult = await provider.getLatestPrices(batch);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          for (const ref of batch) {
            out.set(refKey(ref), err(failure.transport(`${provider.key} threw: ${detail}`)));
          }
          continue;
        }
        for (const ref of batch) {
          out.set(refKey(ref), batchResult.get(refKey(ref)) ?? err(failure.notFound()));
        }
      }

      return out;
    },

    async historicalPrices(ref, pinned, from, to) {
      const resolved = resolve(ref, pinned, 'history');
      if (!resolved.ok) return err(resolved.error);
      const provider = resolved.value;
      if (!provider.getHistoricalPrices) {
        return err(failure.unsupported(`${provider.key} does not provide history`));
      }
      try {
        return await provider.getHistoricalPrices(ref, from, to);
      } catch (error) {
        return err(failure.transport(`${provider.key} threw: ${describeError(error)}`));
      }
    },

    async corporateActions(ref, pinned, from, to) {
      const resolved = resolve(ref, pinned, 'corporate_actions');
      if (!resolved.ok) return err(resolved.error);
      const provider = resolved.value;
      if (!provider.getCorporateActions) {
        return err(failure.unsupported(`${provider.key} does not provide corporate actions`));
      }
      try {
        return await provider.getCorporateActions(ref, from, to);
      } catch (error) {
        return err(failure.transport(`${provider.key} threw: ${describeError(error)}`));
      }
    },

    async fxRates(pairs, on) {
      const out = new Map<PairKey, Result<FxObservation, ProviderFailure>>();
      if (pairs.length === 0) return out;

      // FX is not instrument-scoped, so resolution is by capability alone.
      const provider = providers.find((p) => p.capabilities.provides.includes('fx'));
      if (!provider?.getFxRates) {
        for (const pair of pairs) {
          out.set(pairKey(pair), err(failure.unsupported('no registered provider supplies FX rates')));
        }
        return out;
      }

      try {
        const fetched = await provider.getFxRates(pairs, on);
        for (const pair of pairs) {
          out.set(pairKey(pair), fetched.get(pairKey(pair)) ?? err(failure.notFound()));
        }
      } catch (error) {
        for (const pair of pairs) {
          out.set(pairKey(pair), err(failure.transport(`${provider.key} threw: ${describeError(error)}`)));
        }
      }
      return out;
    },
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
