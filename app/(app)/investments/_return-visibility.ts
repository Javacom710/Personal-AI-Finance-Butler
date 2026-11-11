import type { PortfolioSummary } from '@/server/services';

/** Match Overview's OD-21 protection until aggregate return cohorts are corrected. */
export function canShowPortfolioReturns(
  summary: Pick<PortfolioSummary, 'unrealizedPnl' | 'unpricedInstruments'>,
): boolean {
  return summary.unrealizedPnl !== null && summary.unpricedInstruments.length === 0;
}

export const RETURN_PRICING_REASON = 'Needs every holding priced';
