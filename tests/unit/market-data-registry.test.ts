/**
 * Registry — resolution order, capability refusal, and failure normalisation
 * ([ADR-27](../../docs/DECISIONS.md), [ADR-30](../../docs/DECISIONS.md),
 * [TESTING.md §6](../../docs/TESTING.md#6-market-data-contract-tests)).
 *
 * The registry is where a provider is *chosen* and where a `ProviderFailure`
 * becomes a `MissingPriceReason`. Both are single points on purpose: an adapter
 * that decided its own reason could report a transient outage as `not_found` and
 * silently stop the retry that would have fixed it.
 */

import { describe, expect, it, vi } from 'vitest';

import { ok, err } from '@/lib/result';
import { currency } from '@/lib/decimal/money';
import { UnitPrice } from '@/lib/decimal/price';
import { isoDate } from '@/lib/date';
import { capable, createRegistry, failureToReason } from '@/server/market-data/registry';
import { createManualProvider } from '@/server/market-data/providers/manual';
import {
  failure,
  mic,
  refKey,
  type MarketDataProvider,
  type PriceObservation,
  type ProviderCapabilities,
  type ProviderRef,
} from '@/server/market-data/types';

const INR = currency('INR');
const XNSE = mic('XNSE');
const XBOM = mic('XBOM');

const equity = (over: Partial<ProviderRef> = {}): ProviderRef => ({
  instrumentId: 'i-1',
  providerSymbol: 'INFY',
  exchange: XNSE,
  isin: 'INE009A01021',
  currency: INR,
  assetClass: 'equity',
  ...over,
});

const caps = (over: Partial<ProviderCapabilities> = {}): ProviderCapabilities => ({
  assetClasses: ['equity'],
  markets: [XNSE],
  cadence: 'eod',
  historyFrom: null,
  provides: ['latest', 'history'],
  requiresCredential: false,
  ...over,
});

function stub(
  key: 'amfi' | 'frankfurter' | 'twelvedata',
  over: Partial<ProviderCapabilities> = {},
  impl: Partial<MarketDataProvider> = {},
): MarketDataProvider {
  return {
    key,
    capabilities: caps(over),
    supports: () => true,
    async getLatestPrices(refs) {
      const out = new Map();
      for (const ref of refs) {
        out.set(
          refKey(ref),
          ok<PriceObservation>({
            instrumentId: ref.instrumentId,
            close: UnitPrice.of('100'),
            currency: ref.currency,
            tradingDate: isoDate('2026-08-17'),
            observedAt: new Date('2026-08-17T10:00:00Z'),
            kind: 'eod',
            source: key,
            providerRef: ref.providerSymbol,
          }),
        );
      }
      return out;
    },
    ...impl,
  };
}

describe('failure normalisation', () => {
  it('maps every provider failure onto a distinct, actionable reason', () => {
    expect(failureToReason(failure.notFound())).toBe('not_found');
    expect(failureToReason(failure.rateLimited(60))).toBe('rate_limited');
    expect(failureToReason(failure.unsupported('x'))).toBe('unsupported_asset');
    expect(failureToReason(failure.transport('x'))).toBe('provider_error');
    expect(failureToReason(failure.malformed('x'))).toBe('provider_error');
  });

  it('keeps "no such instrument" and "provider unavailable" apart', () => {
    // Collapsing these makes a permanent condition look transient, or the
    // reverse — one of the two then behaves wrongly forever.
    expect(failureToReason(failure.notFound())).not.toBe(
      failureToReason(failure.transport('down')),
    );
  });
});

describe('capability checks', () => {
  const provider = stub('twelvedata');

  it('accepts a request the capabilities cover', () => {
    expect(capable(provider, equity(), 'latest')).toBe(true);
  });

  it('refuses an operation the adapter does not provide', () => {
    expect(capable(provider, equity(), 'corporate_actions')).toBe(false);
  });

  it('refuses an asset class outside the declared list', () => {
    expect(capable(provider, equity({ assetClass: 'crypto' }), 'latest')).toBe(false);
  });

  it('refuses a market outside the declared list', () => {
    expect(capable(provider, equity({ exchange: XBOM }), 'latest')).toBe(false);
  });

  it('treats an empty market list as market-agnostic', () => {
    const anywhere = stub('amfi', { markets: [], assetClasses: ['mutual_fund'] });
    expect(capable(anywhere, equity({ assetClass: 'mutual_fund', exchange: XBOM }), 'latest')).toBe(true);
  });

  it('an instrument with no exchange is never excluded by a market list', () => {
    expect(capable(provider, equity({ exchange: null }), 'latest')).toBe(true);
  });
});

describe('resolution order', () => {
  it('requires the manual provider to be registered at all', () => {
    expect(() => createRegistry([stub('twelvedata')])).toThrow(/manual provider/);
  });

  it('prefers an explicitly pinned provider', () => {
    const registry = createRegistry([stub('amfi', { assetClasses: ['equity'] }), stub('twelvedata'), createManualProvider()]);
    const resolved = registry.resolve(equity(), 'twelvedata', 'latest');
    expect(resolved.ok && resolved.value.key).toBe('twelvedata');
  });

  it('refuses a pinned provider that cannot serve the request', () => {
    const registry = createRegistry([stub('twelvedata'), createManualProvider()]);
    const resolved = registry.resolve(equity({ assetClass: 'crypto' }), 'twelvedata', 'latest');
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    // Refused up front, rather than asked and misunderstood: an adapter with no
    // coverage answers `not_found` for a perfectly real symbol, which sends the
    // user to fix the wrong thing.
    expect(resolved.error.kind).toBe('unsupported');
  });

  it('refuses a pinned provider that is not registered', () => {
    const registry = createRegistry([createManualProvider()]);
    const resolved = registry.resolve(equity(), 'twelvedata', 'latest');
    expect(resolved.ok === false && resolved.error.kind).toBe('unsupported');
  });

  it('falls to the first capable provider when nothing is pinned', () => {
    const registry = createRegistry([
      stub('amfi', { assetClasses: ['mutual_fund'], markets: [] }),
      stub('twelvedata'),
      createManualProvider(),
    ]);
    const resolved = registry.resolve(equity(), null, 'latest');
    expect(resolved.ok && resolved.value.key).toBe('twelvedata');
  });

  it('falls to manual last, never first', () => {
    // Manual claims every asset class, so ordering it first would shadow every
    // real feed and nothing would ever be fetched.
    const registry = createRegistry([stub('twelvedata'), createManualProvider()]);
    const unclaimed = registry.resolve(equity({ assetClass: 'gold' }), null, 'latest');
    expect(unclaimed.ok && unclaimed.value.key).toBe('manual');

    const claimed = registry.resolve(equity(), null, 'latest');
    expect(claimed.ok && claimed.value.key).toBe('twelvedata');
  });
});

describe('batching and isolation', () => {
  it('calls each provider once for all of its instruments', async () => {
    const spy = vi.fn(async (refs: readonly ProviderRef[]) => {
      const out = new Map();
      for (const ref of refs) out.set(refKey(ref), err(failure.notFound()));
      return out;
    });
    const registry = createRegistry([stub('twelvedata', {}, { getLatestPrices: spy }), createManualProvider()]);

    await registry.latestPrices(
      [equity({ instrumentId: 'a' }), equity({ instrumentId: 'b' }), equity({ instrumentId: 'c' })],
      () => null,
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toHaveLength(3);
  });

  it('an adapter that throws does not take the whole run down', async () => {
    const registry = createRegistry([
      stub('twelvedata', {}, {
        getLatestPrices: async () => {
          throw new Error('adapter bug');
        },
      }),
      createManualProvider(),
    ]);

    const results = await registry.latestPrices([equity()], () => null);
    const result = results.get('i-1');
    expect(result?.ok).toBe(false);
    if (result?.ok) return;
    expect(result?.error.kind).toBe('transport');
    expect(failureToReason(result!.error)).toBe('provider_error');
  });

  it('an instrument the provider omits from its reply is not_found, not undefined', async () => {
    const registry = createRegistry([
      stub('twelvedata', {}, { getLatestPrices: async () => new Map() }),
      createManualProvider(),
    ]);
    const results = await registry.latestPrices([equity()], () => null);
    expect(results.get('i-1')?.ok).toBe(false);
  });

  it('resolving to manual yields unsupported rather than a fabricated price', async () => {
    const registry = createRegistry([createManualProvider()]);
    const results = await registry.latestPrices([equity()], () => null);
    const result = results.get('i-1');
    expect(result?.ok).toBe(false);
    if (result?.ok) return;
    expect(result?.error.kind).toBe('unsupported');
  });
});

describe('FX routing', () => {
  it('reports unsupported for every pair when no adapter supplies FX', async () => {
    const registry = createRegistry([stub('twelvedata'), createManualProvider()]);
    const results = await registry.fxRates([{ base: currency('USD'), quote: INR }]);
    const result = results.get('USD/INR');
    expect(result?.ok === false && result.error.kind).toBe('unsupported');
  });
});
