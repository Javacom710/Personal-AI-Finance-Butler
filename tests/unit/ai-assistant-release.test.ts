import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantAnswer } from '@app/(app)/ai/answer';
import type { QuestionAnswer } from '@/server/ai/assistant/question';
const auth = vi.hoisted(() => vi.fn());
vi.mock('@/server/auth/guards', () => ({ requireSession: auth }));
import { askFinanceQuestionAction } from '@app/(app)/ai/actions';
import AiPage from '@app/(app)/ai/page';
const answer: QuestionAnswer = { interpretation: '<script>alert(1)</script> This is interpretation.', sources: [{ callId: 'one', name: 'get_portfolio_summary', failed: false, result: { ok: true, data: { total: { kind: 'money', amount: '1250.5000', currency: 'INR', scale: 4 }, twr: { value: null, unavailableReason: 'insufficient_history' } }, meta: { truncated: true, asOf: '2026-10-31', currency: 'INR' } } }], modelId: 'fake-test-model', fallbackDepth: 1 };
beforeEach(() => { auth.mockReset(); auth.mockResolvedValue({ userId: 'owner' }); });
describe('disabled assistant release boundary', () => {
  it('authenticates direct calls and returns unavailable without composing any runtime', async () => {
    expect(await askFinanceQuestionAction()).toEqual({ status: 'unavailable', message: expect.stringContaining('not been sent') });
    expect(auth).toHaveBeenCalledWith('/ai');
  });
  it('refuses unauthenticated callers', async () => {
    auth.mockRejectedValueOnce(new Error('login required'));
    await expect(askFinanceQuestionAction()).rejects.toThrow('login required');
  });
  it('renders disabled question controls without fake answers or a live composition root', async () => {
    const html = renderToStaticMarkup(await AiPage());
    expect(html).toMatch(/<textarea[^>]*disabled=""/); expect(html).toMatch(/<button[^>]*disabled=""/);
    expect(html).toContain('Awaiting setup approval'); expect(html).not.toContain('fake-test-model');
  });
});
describe('assistant answer presentation', () => {
  it('separates interpretation from exact deterministic source data and preserves honesty metadata', () => {
    const html = renderToStaticMarkup(createElement(AssistantAnswer, { answer }));
    expect(html).toContain('Interpretation'); expect(html).toContain('Facts and deterministic calculations');
    expect(html).toContain('1250.5000'); expect(html).toContain('INR');
    expect(html).toContain('Unavailable:'); expect(html).toContain('insufficient history'); expect(html).not.toContain('0%');
    expect(html).toContain('truncated'); expect(html).toContain('true'); expect(html).toContain('2026-10-31');
    expect(html).toContain('Fallback used'); expect(html).toContain('Scenario projections are unavailable');
    expect(html).not.toContain('<script>alert(1)</script>'); expect(html).toContain('&lt;script&gt;');
  });
  it('shows a concept answer without pretending financial evidence was fetched', () => {
    const html = renderToStaticMarkup(createElement(AssistantAnswer, { answer: { ...answer, sources: [] } }));
    expect(html).toContain('No financial data was read');
  });
  it('keeps real zero separate from a missing metric and renders failed reads as unavailable', () => {
    const html = renderToStaticMarkup(createElement(AssistantAnswer, { answer: { ...answer, sources: [{ callId: 'zero', name: 'get_accounts', failed: true, result: { balance: 0, metric: null, reason: 'missing price' } }] } }));
    expect(html).toContain('— unavailable'); expect(html).toContain('>0</span>'); expect(html).toContain('Unavailable'); expect(html).toContain('missing price');
  });
});
