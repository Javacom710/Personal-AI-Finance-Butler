import 'server-only';
import { err } from '../../../lib/result';
import { isIsoDate, type IsoDate } from '../../../lib/date';
import { monthRange } from '../../../lib/date/periods';
import type { AiReadCtx } from '../../ai-read';
import type { Orchestrator } from '../orchestrator';
import { invalidOutput } from '../errors';
import { runFinancialReview, type ReviewPlan } from './review';

export function monthlyReviewPlan(ai: AiReadCtx, month: unknown): ReviewPlan | undefined {
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) return undefined;
  const asOf = `${month}-01`;
  if (!isIsoDate(asOf) || asOf > ai.today) return undefined;
  const period = monthRange(asOf as IsoDate);
  return { title: 'Monthly financial review', capability: 'analyzeFinancialPeriod',
    scope: { from: period.from, to: period.to, baseCurrency: ai.base, recordedAsOf: ai.today,
      periodCoverage: month === ai.today.slice(0, 7) ? 'Open calendar month; includes recorded future-dated entries in this month.' : 'Recorded calendar month.',
      budgetScope: 'Budgets applicable on the first day of the month; their own periods may differ.' },
    calls: ['get_cashflow_summary', 'compare_periods', 'get_expense_summary', 'get_income_summary', 'get_budget_status']
      .map(name => ({ id: name, name, argumentsJson: JSON.stringify({ asOf }) })),
  };
}
export async function monthlyFinancialReview(ai: AiReadCtx, orchestrator: Orchestrator, month: unknown) {
  const plan = monthlyReviewPlan(ai, month);
  return plan ? runFinancialReview(ai, orchestrator, plan) : err(invalidOutput('Choose a valid calendar month no later than the current month.'));
}
