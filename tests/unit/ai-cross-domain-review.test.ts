import { beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AiReadCtx } from '@/server/ai-read';
import { analyzeCrossDomainFinances, crossDomainPlan } from '@/server/ai/reviews/cross-domain';
import { FinancialReviewResult } from '@app/(app)/ai/reviews/review-result';
import { fakeReviewProvider } from '../helpers/fake-review-provider';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), holdings: undefined as unknown }));
vi.mock('@/server/auth/guards', () => ({ requireSession: mocks.auth }));
vi.mock('@/server/ai-read', async () => {
  const actual = await import('@/server/ai-read/projections');
  const read = async (ctx: unknown, args: unknown) => { mocks.read(ctx, args); return { ok: true, data: { basis: (args as { basis?: string })?.basis, balance: { kind: 'money', amount: '1234.0001', currency: 'INR', scale: 4 } }, meta: { currency: 'INR', truncated: false } }; };
  return { jsonBytes: actual.jsonBytes, MAX_TOOL_RESULT_BYTES: actual.MAX_TOOL_RESULT_BYTES, getCashflowSummary: read, getAccounts: read, getNetWorth: read, getPortfolioSummary: read, getHoldings: async (ctx: unknown, args: unknown) => { mocks.read(ctx, args); return mocks.holdings; }, getLiabilities: read, getRecurringTransactions: read };
});
import CrossDomainPage from '@app/(app)/ai/reviews/cross-domain/page';
import { generateCrossDomainAnalysisAction } from '@app/(app)/ai/reviews/cross-domain/actions';
const content = 'Interpretation:\nThe available cash flow and valuation bases describe distinct aspects of the records. Missing metrics remain unavailable.\nRecommendations:\nConsider reviewing valuation coverage and scheduled commitments before making changes.';
const ai = { today: '2026-11-03', base: 'INR' } as AiReadCtx;
beforeEach(() => { mocks.auth.mockReset(); mocks.auth.mockResolvedValue({ userId: 'owner' }); mocks.read.mockClear(); mocks.holdings = { ok: true, data: { holdings: [{ name: 'Review holding', priceStatus: 'cached' }] }, meta: { truncated: false } }; });
it('uses the existing Tier 2 health route and eight fixed reads, with distinct cost and market source labels', async () => {
  const plan = crossDomainPlan(ai); const fake = fakeReviewProvider({ content }); const result = await analyzeCrossDomainFinances(ai, fake.orchestrator);
  expect(plan.capability).toBe('analyzeFinancialHealth'); expect(plan.calls).toHaveLength(8); expect(result.ok).toBe(true);
  expect(mocks.read).toHaveBeenCalledWith(ai, { asOf: ai.today, basis: 'cost' }); expect(mocks.read).toHaveBeenCalledWith(ai, { asOf: ai.today, basis: 'market' });
  expect(fake.requests).toHaveLength(2);
  if (result.ok) { const html = renderToStaticMarkup(createElement(FinancialReviewResult, { review: result.value })); expect(html).toContain('net worth at cost'); expect(html).toContain('net worth at market'); expect(html).toContain('1234.0001'); }
});
it('does not read or call a model if the existing measured route is unavailable', async () => {
  const fake = fakeReviewProvider({}, false); expect((await analyzeCrossDomainFinances(ai, fake.orchestrator)).ok).toBe(false);
  expect(mocks.read).not.toHaveBeenCalled(); expect(fake.requests).toHaveLength(0);
});
it('refuses substituting a scenario call or dropping a valuation basis before any read', async () => {
  const calls = crossDomainPlan(ai).calls.map(c => ({ ...c })); calls[3] = { ...calls[3]!, name: 'run_financial_scenario', argumentsJson: '{}' };
  const fake = fakeReviewProvider({ content }, true, { toolCalls: calls }); expect((await analyzeCrossDomainFinances(ai, fake.orchestrator)).ok).toBe(false);
  expect(mocks.read).not.toHaveBeenCalled(); expect(fake.requests).toHaveLength(1);
});
it('accepts equivalent argument property order without treating it as a changed scope', async () => {
  const calls = crossDomainPlan(ai).calls.map(c => c.name === 'get_net_worth' ? { ...c, argumentsJson: JSON.stringify({ basis: JSON.parse(c.argumentsJson).basis, asOf: ai.today }) } : c);
  expect((await analyzeCrossDomainFinances(ai, fakeReviewProvider({ content }, true, { toolCalls: calls }).orchestrator)).ok).toBe(true);
});
it('keeps the page and direct action disabled and independently authenticated', async () => {
  expect(renderToStaticMarkup(await CrossDomainPage())).toMatch(/<button[^>]*disabled=""/);
  expect((await generateCrossDomainAnalysisAction()).status).toBe('unavailable'); expect(mocks.read).not.toHaveBeenCalled();
  mocks.auth.mockRejectedValue(new Error('login required'));
  await expect(CrossDomainPage()).rejects.toThrow('login required'); await expect(generateCrossDomainAnalysisAction()).rejects.toThrow('login required');
});

it.each(['cached', 'stale'])('supplies engine price status %s to the model and evidence without treating complete coverage as freshness', async status => {
  mocks.holdings = { ok: true, data: { holdings: [{ name: 'Review holding', priceStatus: status }], coverage: { kind: 'rate', value: '1.0000000000' } }, meta: { truncated: false } };
  const provider = fakeReviewProvider({ content }); const result = await analyzeCrossDomainFinances(ai, provider.orchestrator); expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.sources.find(s => s.name === 'get_holdings')?.result).toEqual(mocks.holdings);
  expect(provider.requests[1]?.messages.some(m => m.role === 'tool' && m.content.includes(`"priceStatus":"${status}"`))).toBe(true);
  const html = renderToStaticMarkup(createElement(FinancialReviewResult, { review: result.value }));
  expect(html).toContain('holdings with price status'); expect(html).toContain(status);
  expect(html).toContain('Stale quotes can contribute even with complete coverage');
});
it('keeps failed or clipped holdings evidence explicit and treats full-valuation freshness as unavailable', async () => {
  for (const [result, warning] of [
    [{ ok: false, error: { code: 'insufficient_data', message: 'Holdings unavailable' } }, 'Some financial sources are unavailable'],
    [{ ok: true, data: { holdings: [] }, meta: { truncated: true, totalMatching: 501 } }, 'Some source rows were omitted'],
  ] as const) {
    mocks.holdings = result;
    const review = await analyzeCrossDomainFinances(ai, fakeReviewProvider({ content }).orchestrator); expect(review.ok).toBe(true);
    if (review.ok) { const html = renderToStaticMarkup(createElement(FinancialReviewResult, { review: review.value })); expect(html).toContain(warning); expect(html).toContain('freshness of the full valuation is unavailable'); }
  }
});
