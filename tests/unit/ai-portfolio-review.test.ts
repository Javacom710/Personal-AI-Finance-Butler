import { beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AiReadCtx } from '@/server/ai-read';
import { analyzeCurrentPortfolio, portfolioReviewPlan } from '@/server/ai/reviews/portfolio';
import { FinancialReviewResult } from '@app/(app)/ai/reviews/review-result';
import { fakeReviewProvider } from '../helpers/fake-review-provider';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), result: {} as unknown }));
vi.mock('@/server/auth/guards', () => ({ requireSession: mocks.auth }));
vi.mock('@/server/ai-read', async () => {
  const actual = await import('@/server/ai-read/projections');
  const read = async (ctx: unknown, args: unknown) => { mocks.read(ctx, args); return mocks.result; };
  return { jsonBytes: actual.jsonBytes, MAX_TOOL_RESULT_BYTES: actual.MAX_TOOL_RESULT_BYTES, getPortfolioSummary: read, getHoldings: read, getInvestmentAssets: read, getAssetAllocation: read };
});
import PortfolioAnalysisPage from '@app/(app)/ai/reviews/portfolio/page';
import { generatePortfolioAnalysisAction } from '@app/(app)/ai/reviews/portfolio/actions';
const ai = { today: '2026-11-03', base: 'INR' } as AiReadCtx;
const content = 'Interpretation:\nThe available prices describe the priced holdings only. Missing history is unavailable.\nRecommendations:\nConsider reviewing concentration and unpriced positions before making changes.';
beforeEach(() => { mocks.auth.mockReset(); mocks.auth.mockResolvedValue({ userId: 'owner' }); mocks.read.mockReset(); mocks.result = { ok: true, data: { twr: { value: null, unavailableReason: 'insufficient_price_history' }, priceStatus: 'stale', marketValue: { kind: 'money', amount: '1100.0001', currency: 'INR', scale: 4 } }, meta: { currency: 'INR', truncated: true } }; });
it('uses the unchanged portfolio capability and only current holdings/totals/allocation tools', async () => {
  const plan = portfolioReviewPlan(ai); const fake = fakeReviewProvider({ content });
  expect(plan.capability).toBe('analyzePortfolio'); expect(plan.calls.map(c => c.name)).toEqual(['get_portfolio_summary', 'get_holdings', 'get_investment_assets', 'get_asset_allocation', 'get_asset_allocation', 'get_asset_allocation']);
  const result = await analyzeCurrentPortfolio(ai, fake.orchestrator);
  expect(result.ok).toBe(true); expect(fake.requests).toHaveLength(2); expect(fake.requests[0]?.maxTokens).toBe(4096);
  for (const dimension of ['asset_class', 'instrument', 'currency']) expect(mocks.read).toHaveBeenCalledWith(ai, { dimension });
  if (result.ok) {
    const html = renderToStaticMarkup(createElement(FinancialReviewResult, { review: result.value }));
    expect(html).toContain('1100.0001'); expect(html).toContain('insufficient price history'); expect(html).toContain('stale'); expect(html).toContain('Some source rows were omitted');
    expect(html).toContain('allocation by asset class'); expect(html).not.toContain('0%');
  }
});
it('refuses an unmeasured route before any financial read or provider call', async () => {
  const fake = fakeReviewProvider({}, false);
  expect((await analyzeCurrentPortfolio(ai, fake.orchestrator)).ok).toBe(false);
  expect(mocks.read).not.toHaveBeenCalled(); expect(fake.requests).toHaveLength(0);
});
it('does not expose a write or scenario tool, or execute an unexpected model request', async () => {
  const fake = fakeReviewProvider({ toolCalls: [{ id: 'bad', name: 'run_financial_scenario', argumentsJson: '{}' }] });
  expect((await analyzeCurrentPortfolio(ai, fake.orchestrator)).ok).toBe(false);
  expect(mocks.read).toHaveBeenCalledTimes(6); expect(fake.requests).toHaveLength(2);
  expect(fake.requests[0]?.tools?.some(t => t.name.includes('scenario') || t.name.includes('create'))).toBe(false);
});
it('keeps generation unavailable in the authenticated page and direct action', async () => {
  const html = renderToStaticMarkup(await PortfolioAnalysisPage()); expect(html).toMatch(/<button[^>]*disabled=""/);
  expect((await generatePortfolioAnalysisAction()).status).toBe('unavailable'); expect(mocks.read).not.toHaveBeenCalled();
  mocks.auth.mockRejectedValue(new Error('login required'));
  await expect(PortfolioAnalysisPage()).rejects.toThrow('login required'); await expect(generatePortfolioAnalysisAction()).rejects.toThrow('login required');
});
