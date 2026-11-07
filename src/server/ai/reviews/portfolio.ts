import 'server-only';
import type { AiReadCtx } from '../../ai-read';
import type { Orchestrator } from '../orchestrator';
import { runFinancialReview, type ReviewPlan } from './review';
export function portfolioReviewPlan(ai: AiReadCtx): ReviewPlan {
  return { title: 'Portfolio analysis', capability: 'analyzePortfolio',
    scope: { recordedAsOf: ai.today, baseCurrency: ai.base,
      valuationScope: 'Current holdings and available prices, with price status and coverage. Unpriced holdings are not valued at cost.',
      priceCurrencyScope: 'Instrument currencies are supplied separately; unit prices are not converted to the base currency.',
      performanceScope: 'Only metrics supplied by portfolio tools. Missing historical performance or benchmarks remain unavailable; no hypothetical returns.' },
    calls: [
      { id: 'portfolio_totals', name: 'get_portfolio_summary', argumentsJson: '{}' },
      { id: 'holdings_with_price_status', name: 'get_holdings', argumentsJson: '{}' },
      { id: 'instrument_currencies', name: 'get_investment_assets', argumentsJson: '{}' },
      ...(['asset_class', 'instrument', 'currency'] as const).map(dimension => ({ id: `allocation_by_${dimension}`, name: 'get_asset_allocation', argumentsJson: JSON.stringify({ dimension }) })),
    ],
  };
}
export function analyzeCurrentPortfolio(ai: AiReadCtx, orchestrator: Orchestrator) {
  return runFinancialReview(ai, orchestrator, portfolioReviewPlan(ai));
}
