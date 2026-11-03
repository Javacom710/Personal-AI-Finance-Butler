import 'server-only';
import type { AiReadCtx } from '../../ai-read';
import type { Orchestrator } from '../orchestrator';
import { runFinancialReview, type ReviewPlan } from './review';
export function crossDomainPlan(ai: AiReadCtx): ReviewPlan {
  return { title: 'Cross-domain financial analysis', capability: 'analyzeFinancialHealth',
    scope: { recordedAsOf: ai.today, baseCurrency: ai.base,
      netWorthBasis: 'Cost and market net worth are separately labeled. They are different valuation bases, not amounts to add together.',
      cashFlowScope: 'Recorded calendar-month cash flow, including future-dated entries within that month.',
      commitmentScope: 'Upcoming thirty-day schedules, separate from recorded cash flows.',
      unavailableMetrics: 'Ratios and deployable-cash capacity not supplied by tools remain unavailable. No scenario or investment-return projection.',
      liabilityScope: 'Linked liabilities refer to account balances and must not be counted again.' },
    calls: [
      { id: 'recorded_monthly_cash_flow', name: 'get_cashflow_summary', argumentsJson: JSON.stringify({ asOf: ai.today }) },
      { id: 'account_balances', name: 'get_accounts', argumentsJson: JSON.stringify({ asOf: ai.today }) },
      { id: 'net_worth_at_cost', name: 'get_net_worth', argumentsJson: JSON.stringify({ asOf: ai.today, basis: 'cost' }) },
      { id: 'net_worth_at_market', name: 'get_net_worth', argumentsJson: JSON.stringify({ asOf: ai.today, basis: 'market' }) },
      { id: 'portfolio_totals_and_coverage', name: 'get_portfolio_summary', argumentsJson: '{}' },
      { id: 'portfolio_allocation_by_asset_class', name: 'get_asset_allocation', argumentsJson: '{"dimension":"asset_class"}' },
      { id: 'liabilities_and_linked_balances', name: 'get_liabilities', argumentsJson: '{}' },
      { id: 'upcoming_scheduled_commitments', name: 'get_recurring_transactions', argumentsJson: '{"horizonDays":30}' },
    ],
  };
}
export function analyzeCrossDomainFinances(ai: AiReadCtx, orchestrator: Orchestrator) {
  return runFinancialReview(ai, orchestrator, crossDomainPlan(ai));
}
