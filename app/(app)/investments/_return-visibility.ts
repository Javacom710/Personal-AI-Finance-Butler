import type { PortfolioSummary } from '@/server/services';

/** Whole-portfolio returns require complete pricing, as enforced by the engine. */
export function canShowPortfolioReturns(
  summary: Pick<PortfolioSummary, 'unrealizedPnl' | 'unpricedInstruments'>,
): boolean {
  return summary.unrealizedPnl !== null && summary.unpricedInstruments.length === 0;
}

/** A known partial market value remains useful when aggregate returns are unavailable. */
export function canShowPortfolioValue(valuation: {
  readonly holdings: readonly unknown[];
  readonly unpricedCount: number;
}): boolean {
  return valuation.unpricedCount === 0 || valuation.holdings.length > valuation.unpricedCount;
}

export const RETURN_PRICING_REASON = 'Needs every holding priced';
