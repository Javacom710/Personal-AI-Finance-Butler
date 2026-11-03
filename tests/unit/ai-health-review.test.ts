import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AiReadCtx } from '@/server/ai-read';
import { analyzeFinancialHealth, financialHealthPlan } from '@/server/ai/reviews/health';
import { fakeReviewProvider } from '../helpers/fake-review-provider';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn() }));
vi.mock('@/server/auth/guards', () => ({ requireSession: mocks.auth }));
vi.mock('@/server/ai-read', async () => {
  const actual = await import('@/server/ai-read/projections');
  const read = async (ctx: unknown, args: unknown) => { mocks.read(ctx, args); return { ok: true, data: { savingsRate: { value: null, unavailableReason: 'divide_by_zero' } }, meta: { currency: 'INR', truncated: false } }; };
  return { jsonBytes: actual.jsonBytes, MAX_TOOL_RESULT_BYTES: actual.MAX_TOOL_RESULT_BYTES, getCashflowSummary: read, getAccounts: read, getBudgetStatus: read, getLiabilities: read, getRecurringTransactions: read };
});
import FinancialHealthPage from '@app/(app)/ai/reviews/health/page';
import { generateFinancialHealthAction } from '@app/(app)/ai/reviews/health/actions';
const ai = { today: '2026-11-03', base: 'INR' } as AiReadCtx;
beforeEach(() => { mocks.auth.mockReset(); mocks.auth.mockResolvedValue({ userId: 'owner' }); mocks.read.mockClear(); });
it('uses the existing health capability and five controlled reads with current-date and commitment scope', async () => {
  const plan = financialHealthPlan(ai); const fake = fakeReviewProvider(); const result = await analyzeFinancialHealth(ai, fake.orchestrator);
  expect(plan.capability).toBe('analyzeFinancialHealth'); expect(plan.calls).toHaveLength(5);
  expect(result.ok).toBe(true); expect(mocks.read).toHaveBeenCalledTimes(5); expect(fake.requests).toHaveLength(2);
  expect(mocks.read).toHaveBeenCalledWith(ai, { asOf: ai.today }); expect(mocks.read).toHaveBeenCalledWith(ai, { horizonDays: 30 });
  expect(JSON.stringify(result)).toContain('divide_by_zero'); expect(plan.scope.liabilityScope).toContain('must not be counted again');
});
it('keeps the existing measured gate before data reads and model calls', async () => {
  const fake = fakeReviewProvider({}, false); expect((await analyzeFinancialHealth(ai, fake.orchestrator)).ok).toBe(false);
  expect(mocks.read).not.toHaveBeenCalled(); expect(fake.requests).toHaveLength(0);
});
it('rejects a widened initial read scope as a whole before reading anything', async () => {
  const calls = financialHealthPlan(ai).calls.map(c => ({ ...c })); calls[4] = { ...calls[4]!, argumentsJson: '{"horizonDays":365}' };
  const fake = fakeReviewProvider({}, true, { toolCalls: calls });
  expect((await analyzeFinancialHealth(ai, fake.orchestrator)).ok).toBe(false); expect(mocks.read).not.toHaveBeenCalled(); expect(fake.requests).toHaveLength(1);
});
it('keeps the page and direct action disabled and independently authenticated', async () => {
  expect(renderToStaticMarkup(await FinancialHealthPage())).toMatch(/<button[^>]*disabled=""/);
  expect((await generateFinancialHealthAction()).status).toBe('unavailable'); expect(mocks.read).not.toHaveBeenCalled();
  mocks.auth.mockRejectedValue(new Error('login required'));
  await expect(FinancialHealthPage()).rejects.toThrow('login required'); await expect(generateFinancialHealthAction()).rejects.toThrow('login required');
});
