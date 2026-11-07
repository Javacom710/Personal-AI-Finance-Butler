import 'server-only';
import { err } from '../../../lib/result';
import type { AiReadCtx } from '../../ai-read';
import type { Orchestrator } from '../orchestrator';
import { invalidOutput } from '../errors';
import { monthlyReviewPlan } from './monthly';
import { runFinancialReview, type ReviewPlan } from './review';
export function periodSummaryPlan(ai: AiReadCtx, month: unknown): ReviewPlan | undefined {
  const monthly = monthlyReviewPlan(ai, month);
  if (!monthly) return undefined;
  return { title: 'Monthly period summary', capability: 'summarizeFinancialData',
    scope: { ...Object.fromEntries(Object.entries(monthly.scope).filter(([key]) => key !== 'budgetScope')),
      summaryScope: 'Recorded calendar month only. Quarterly and yearly summaries are unavailable.' },
    calls: monthly.calls.filter(call => call.name !== 'get_budget_status'),
  };
}
export function summarizeRecordedMonth(ai: AiReadCtx, orchestrator: Orchestrator, month: unknown) {
  const plan = periodSummaryPlan(ai, month);
  return plan ? runFinancialReview(ai, orchestrator, plan) : Promise.resolve(err(invalidOutput('Choose a calendar month. Quarterly and yearly summaries are currently unavailable.')));
}
