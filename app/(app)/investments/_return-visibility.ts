import type { PortfolioSummary } from '@/server/services';

/**
 * Whether a page shows the portfolio's aggregate returns. Since OD-21 they are
 * computed over the priced holdings alone; with any holding unpriced that is a
 * partial cohort, so pages withhold it until a labelled presentation is approved.
 */
export function canShowPortfolioReturns(
  summary: Pick<PortfolioSummary, 'unrealizedPnl' | 'unpricedInstruments'>,
): boolean {
  return summary.unrealizedPnl !== null && summary.unpricedInstruments.length === 0;
}

export const RETURN_PRICING_REASON = 'Needs every holding priced';
