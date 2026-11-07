import 'server-only';
import type { AiReadCtx } from '../../ai-read';
import type { Orchestrator } from '../orchestrator';
import { runFinancialReview, type ReviewPlan } from './review';
export function financialHealthPlan(ai: AiReadCtx): ReviewPlan {
  return { title: 'Financial-health analysis', capability: 'analyzeFinancialHealth',
    scope: { recordedAsOf: ai.today, baseCurrency: ai.base,
      cashFlowScope: 'Recorded calendar-month cash flow, including future-dated entries in that month.',
      commitmentScope: 'Scheduled commitments in the upcoming thirty days. Schedules are not guaranteed future cash flows.',
      metricScope: 'Only metrics returned by the financial engine. No composite health score, inferred affordability ratio or return assumption.',
      liabilityScope: 'Transacted liabilities refer to linked account balances; their null standalone balances must not be counted again.' },
    calls: [
      { id: 'recorded_monthly_cash_flow', name: 'get_cashflow_summary', argumentsJson: JSON.stringify({ asOf: ai.today }) },
      { id: 'account_balances', name: 'get_accounts', argumentsJson: JSON.stringify({ asOf: ai.today }) },
      { id: 'current_budget_status', name: 'get_budget_status', argumentsJson: JSON.stringify({ asOf: ai.today }) },
      { id: 'liabilities_and_linked_balances', name: 'get_liabilities', argumentsJson: '{}' },
      { id: 'upcoming_scheduled_commitments', name: 'get_recurring_transactions', argumentsJson: JSON.stringify({ horizonDays: 30 }) },
    ],
  };
}
export function analyzeFinancialHealth(ai: AiReadCtx, orchestrator: Orchestrator) {
  return runFinancialReview(ai, orchestrator, financialHealthPlan(ai));
}
