import { beforeEach, expect, it, vi } from 'vitest';
import type { AiReadCtx } from '@/server/ai-read';
import { monthlyFinancialReview, monthlyReviewPlan } from '@/server/ai/reviews/monthly';
import { reviewNarrative } from '@/server/ai/reviews/review';
import { answerFinanceQuestionSystemPrompt } from '@/server/ai/prompts/answer-finance-question';
import { fakeReviewProvider, REVIEW_PROSE } from '../helpers/fake-review-provider';
const reads = vi.hoisted(() => ({ call: vi.fn(), result: {} as unknown }));
vi.mock('@/server/ai-read', async () => {
  const actual = await import('@/server/ai-read/projections');
  const read = async (ctx: unknown, args: unknown) => { reads.call(ctx, args); return reads.result; };
  return { jsonBytes: actual.jsonBytes, MAX_TOOL_RESULT_BYTES: actual.MAX_TOOL_RESULT_BYTES, getCashflowSummary: read, comparePeriods: read, getExpenseSummary: read, getIncomeSummary: read, getBudgetStatus: read };
});
const ai = { today: '2026-11-03', base: 'INR', fiscalYearStartMonth: 4 } as AiReadCtx;
beforeEach(() => { reads.call.mockReset(); reads.result = { ok: true, data: { total: { kind: 'money', amount: '1234.0001', currency: 'INR', scale: 4 } }, meta: { currency: 'INR', rowCount: 1, truncated: false } }; });
it('uses the existing period route, frozen tool definitions, exact results and unchanged system prompt', async () => {
  const fake = fakeReviewProvider(); const result = await monthlyFinancialReview(ai, fake.orchestrator, '2026-10');
  expect(result.ok, JSON.stringify(result)).toBe(true); expect(reads.call).toHaveBeenCalledTimes(5);
  expect(reads.call).toHaveBeenCalledWith(ai, { asOf: '2026-10-01' });
  expect(fake.requests).toHaveLength(1); expect(fake.requests[0]?.maxTokens).toBe(4096);
  expect(fake.requests[0]?.messages[0]?.content).toBe(answerFinanceQuestionSystemPrompt({ today: ai.today, baseCurrency: ai.base }));
  expect(fake.requests[0]?.tools).toHaveLength(5);
  if (result.ok) { expect(result.value.sources).toHaveLength(5); expect(result.value.sources[0]?.result).toEqual(reads.result); expect(result.value.interpretation).not.toContain('1234'); }
});
it('does not read or call a provider when the existing measured gate refuses the route', async () => {
  const fake = fakeReviewProvider({}, false);
  expect((await monthlyFinancialReview(ai, fake.orchestrator, '2026-10')).ok).toBe(false);
  expect(reads.call).not.toHaveBeenCalled(); expect(fake.requests).toHaveLength(0);
});
it.each(['2026-13', '2026-00', '2026-2', '2027-01', '2026-10<script>', null, ['2026-10']])('rejects invalid/future month %s before reads or inference', async month => {
  const fake = fakeReviewProvider(); expect((await monthlyFinancialReview(ai, fake.orchestrator, month)).ok).toBe(false);
  expect(reads.call).not.toHaveBeenCalled(); expect(fake.requests).toHaveLength(0);
});
it('uses engine calendar boundaries across leap years and labels an open month honestly', () => {
  expect(monthlyReviewPlan(ai, '2024-02')?.scope).toMatchObject({ from: '2024-02-01', to: '2024-02-29' });
  expect(monthlyReviewPlan(ai, '2026-11')?.scope.periodCoverage).toContain('future-dated');
});
it('stops without inference when every source is unavailable or the combined context is oversized', async () => {
  const fake = fakeReviewProvider(); reads.result = { ok: false, error: { code: 'unavailable', message: 'Unavailable' } };
  expect((await monthlyFinancialReview(ai, fake.orchestrator, '2026-10')).ok).toBe(false); expect(fake.requests).toHaveLength(0);
  reads.result = { ok: true, data: 'x'.repeat(15000) };
  expect((await monthlyFinancialReview(ai, fake.orchestrator, '2026-10')).ok).toBe(false); expect(fake.requests).toHaveLength(0);
});
it.each([{ finishReason: 'length' as const }, { finishReason: 'content_filter' as const }, { toolCalls: [{ id: 'write', name: 'create_transaction', argumentsJson: '{}' }] }, { content: 'Only an interpretation.' }])('refuses incomplete, filtered, malformed or tool-requesting replies without repair', async output => {
  const fake = fakeReviewProvider(output);
  expect((await monthlyFinancialReview(ai, fake.orchestrator, '2026-10')).ok).toBe(false); expect(fake.requests).toHaveLength(1);
  expect(reads.call).toHaveBeenCalledTimes(5);
});
it.each(['₹100', '0%', '١٢', '１２', 'ten thousand', 'fifteen', 'sixty', 'double', 'twice', 'one hundred'])('does not accept new figures in model prose: %s', text => {
  expect(reviewNarrative(REVIEW_PROSE.replace('recorded cash flow', text))).toBeUndefined();
});
it('retains failed individual reads as unavailable evidence without logging private errors', async () => {
  reads.call.mockImplementationOnce(() => { throw new Error('Private storage detail'); });
  const fake = fakeReviewProvider(); const result = await monthlyFinancialReview(ai, fake.orchestrator, '2026-10');
  expect(result.ok && result.value.sources[0]?.failed).toBe(true);
  expect(JSON.stringify(fake.requests)).not.toContain('Private storage detail');
});
