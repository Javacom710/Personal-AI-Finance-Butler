import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AiReadCtx } from '@/server/ai-read';
import { periodSummaryPlan, summarizeRecordedMonth } from '@/server/ai/reviews/period-summary';
import { fakeReviewProvider } from '../helpers/fake-review-provider';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn() }));
vi.mock('@/server/auth/guards', () => ({ requireSession: mocks.auth }));
vi.mock('@/server/ai-read', async () => {
  const actual = await import('@/server/ai-read/projections');
  const read = async (ctx: unknown, args: unknown) => { mocks.read(ctx, args); return { ok: true, data: { savingsRate: { value: null, unavailableReason: 'divide_by_zero' } }, meta: { currency: 'INR', truncated: false } }; };
  return { jsonBytes: actual.jsonBytes, MAX_TOOL_RESULT_BYTES: actual.MAX_TOOL_RESULT_BYTES, getCashflowSummary: read, comparePeriods: read, getExpenseSummary: read, getIncomeSummary: read };
});
import PeriodSummaryPage from '@app/(app)/ai/reviews/summary/page';
import { generatePeriodSummaryAction } from '@app/(app)/ai/reviews/summary/actions';
const ai = { today: '2026-11-03', base: 'INR' } as AiReadCtx;
const content = 'Interpretation:\nThe recorded income and spending describe the selected month. Missing metrics remain unavailable.\nRecommendations:\nNo recommendation is supported by this summary alone.';
beforeEach(() => { mocks.auth.mockReset(); mocks.auth.mockResolvedValue({ userId: 'owner' }); mocks.read.mockClear(); });
it('uses the existing Tier 1 summary capability and production budget with four exact monthly reads', async () => {
  const plan = periodSummaryPlan(ai, '2026-10'); expect(plan?.capability).toBe('summarizeFinancialData'); expect(plan?.calls).toHaveLength(4);
  const fake = fakeReviewProvider({ content }, true, {}, 1); const result = await summarizeRecordedMonth(ai, fake.orchestrator, '2026-10');
  expect(result.ok).toBe(true); expect(fake.requests).toHaveLength(2); expect(fake.requests.every(r => r.maxTokens === 2048)).toBe(true);
  expect(mocks.read).toHaveBeenCalledTimes(4); expect(mocks.read).toHaveBeenCalledWith(ai, { asOf: '2026-10-01' });
  expect(JSON.stringify(result)).toContain('divide_by_zero'); expect(plan?.scope).not.toHaveProperty('budgetScope');
});
it.each(['2026-Q3', '2026', { period: 'yearly', month: '2026-10' }, '2026-13', '2027-01'])('rejects unsupported or invalid selection %s instead of silently summarizing a month', async selection => {
  const fake = fakeReviewProvider({ content }, true, {}, 1);
  expect((await summarizeRecordedMonth(ai, fake.orchestrator, selection)).ok).toBe(false); expect(mocks.read).not.toHaveBeenCalled(); expect(fake.requests).toHaveLength(0);
});
it('keeps the existing measured gate before all financial reads', async () => {
  const fake = fakeReviewProvider({ content }, false, {}, 1); expect((await summarizeRecordedMonth(ai, fake.orchestrator, '2026-10')).ok).toBe(false);
  expect(mocks.read).not.toHaveBeenCalled(); expect(fake.requests).toHaveLength(0);
});
it('keeps the monthly controls and direct action disabled and independently authenticated', async () => {
  const html = renderToStaticMarkup(await PeriodSummaryPage()); expect(html).toMatch(/<input[^>]*disabled=""/); expect(html).toContain('Quarterly and yearly summaries are unavailable');
  expect((await generatePeriodSummaryAction()).status).toBe('unavailable'); expect(mocks.read).not.toHaveBeenCalled();
  mocks.auth.mockRejectedValue(new Error('login required'));
  await expect(PeriodSummaryPage()).rejects.toThrow('login required'); await expect(generatePeriodSummaryAction()).rejects.toThrow('login required');
});
