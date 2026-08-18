import 'server-only';

/**
 * The manual provider — always registered, needs no network and no credential
 * ([ADR-11](../../../../docs/DECISIONS.md#adr-11--market-data-behind-a-provider-abstraction-with-an-always-available-manual-provider)).
 *
 * It is what makes "every instrument can always be valued" a fact rather than an
 * aspiration: whatever a feed does or does not cover, a price the user typed is
 * always available for it.
 *
 * **It is not a fallback in the ordinary sense** ([ADR-30](../../../../docs/DECISIONS.md#adr-30--one-provider-per-instrument-price-series-the-only-price-fallback-is-manual)).
 * A fallback substitutes one vendor's number for another's and hopes they agree.
 * A manual price is a *different kind* of fact — user-attested — and it is always
 * labelled `source: 'manual'` so it never masquerades as a market observation.
 *
 * There is deliberately no fetch here. Manual prices reach the database through
 * `services/prices.ts → setManualPrice`, which is a validated write path with an
 * audit entry; this adapter exists so the registry has something to resolve to,
 * and so `capabilities` can state honestly that every asset class is covered and
 * no credential is required.
 */

import type {
  MarketDataProvider,
  ProviderCapabilities,
  ProviderRef,
} from '../types';
import type { AssetClass } from '../../domain/pricing/valuation';

const ALL_ASSET_CLASSES: readonly AssetClass[] = [
  'equity',
  'mutual_fund',
  'etf',
  'bond',
  'fixed_deposit',
  'gold',
  'crypto',
  'cash_equivalent',
  'other',
];

const CAPABILITIES: ProviderCapabilities = {
  assetClasses: ALL_ASSET_CLASSES,
  // Empty means market-agnostic: a hand-entered price is as valid for an
  // unlisted holding as for an NSE one.
  markets: [],
  // A typed price is a point-in-time mark the user asserts, and the natural
  // reading of "as of Friday" is Friday's close — so it ages in sessions like
  // any other end-of-day figure.
  cadence: 'eod',
  historyFrom: null,
  provides: ['latest'],
  requiresCredential: false,
};

export function createManualProvider(): MarketDataProvider {
  return {
    key: 'manual',
    capabilities: CAPABILITIES,
    supports(_ref: ProviderRef): boolean {
      return true;
    },
    // No getLatestPrices: the registry resolving to `manual` means "there is
    // nothing to fetch — read what is stored". Returning an empty map here
    // instead would look like a provider that ran and found nothing.
  };
}
