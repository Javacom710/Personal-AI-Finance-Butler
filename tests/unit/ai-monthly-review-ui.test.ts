import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { FinancialReviewResult } from '@app/(app)/ai/reviews/review-result';
import { reviewEvidence } from '@/server/ai/reviews/evidence';
import type { FinancialReview } from '@/server/ai/reviews/review';
const auth = vi.hoisted(() => vi.fn());
vi.mock('@/server/auth/guards', () => ({ requireSession: auth }));
import MonthlyReviewPage from '@app/(app)/ai/reviews/monthly/page';
import { generateMonthlyReviewAction } from '@app/(app)/ai/reviews/monthly/actions';
beforeEach(() => { auth.mockReset(); auth.mockResolvedValue({ userId: 'owner' }); });
const review: FinancialReview = { title: 'Monthly financial review', scope: { from: '2026-10-01' }, modelId: 'fake-model', interpretation: '<script>bad()</script> Qualitative interpretation.', recommendation: 'Review the source categories.', sources: [{ callId: 'cash', name: 'get_cashflow_summary', failed: false, result: { ok: true, data: { savings: { kind: 'money', amount: '900719925474.0001', currency: 'INR', scale: 4 }, savingsRate: { value: null, unavailableReason: 'divide_by_zero' } }, meta: { truncated: true, currency: 'INR' } } }] };
it('separates the four evidence kinds, preserves exact precision and unavailable reasons, and escapes text', () => {
  const html = renderToStaticMarkup(createElement(FinancialReviewResult, { review }));
  for (const label of ['Facts', 'Deterministic calculations', 'Interpretation', 'Recommendation']) expect(html).toContain(label);
  expect(html).toContain('900719925474.0001'); expect(html).toContain('INR'); expect(html).toContain('divide by zero');
  expect(html).toContain('Some source rows were omitted'); expect(html).not.toContain('<script>bad()');
});
it('keeps metadata facts, real zero and absent metrics distinct without numerical coercion', () => {
  const items = reviewEvidence({ ok: true, data: { count: 0, missing: null, amount: { kind: 'money', amount: '0.0000', currency: 'INR', scale: 4 } }, meta: { rowCount: 0, truncated: false } });
  expect(items.find(i => i.path === 'meta.rowCount')).toMatchObject({ category: 'fact', value: 0 });
  expect(items.find(i => i.path === 'data.missing')).toMatchObject({ category: 'calculation', value: null });
  expect(items.find(i => i.path === 'data.amount')?.value).toMatchObject({ amount: '0.0000' });
});
it('marks domain-level failed reads unavailable even if dispatch itself succeeded', () => {
  const html = renderToStaticMarkup(createElement(FinancialReviewResult, { review: { ...review, sources: [{ callId: 'bad', name: 'get_budget_status', failed: false, result: { ok: false, error: { message: 'Unavailable' } } }] } }));
  expect(html).toContain('This review is incomplete'); expect(html).toContain('— unavailable');
});
it('keeps both the page and direct action unavailable without creating a model or read context', async () => {
  const html = renderToStaticMarkup(await MonthlyReviewPage());
  expect(html).toMatch(/<input[^>]*disabled=""/); expect(html).toMatch(/<button[^>]*disabled=""/);
  expect((await generateMonthlyReviewAction()).status).toBe('unavailable');
  expect(auth).toHaveBeenCalledWith('/ai/reviews/monthly');
});
it('authenticates the page and direct action independently', async () => {
  auth.mockRejectedValue(new Error('login required'));
  await expect(MonthlyReviewPage()).rejects.toThrow('login required');
  await expect(generateMonthlyReviewAction()).rejects.toThrow('login required');
});
