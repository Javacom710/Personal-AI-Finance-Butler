import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantAnswer } from '@app/(app)/ai/answer';
import type { QuestionAnswer } from '@/server/ai/assistant/question';
const auth = vi.hoisted(() => vi.fn());
const history = vi.hoisted(() => vi.fn());
vi.mock('@/server/services', () => ({ createReadCtx: async () => ({ ok: true, value: { userId: 'owner' } }), listConversationPage: history, createConversation: vi.fn(), renameConversation: vi.fn(), archiveConversation: vi.fn(), deleteConversation: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/auth/guards', () => ({ requireSession: auth }));
import { askFinanceQuestionAction } from '@app/(app)/ai/actions';
import AiPage from '@app/(app)/ai/page';
const answer: QuestionAnswer = { interpretation: '<script>alert(1)</script> This is interpretation.', sources: [{ callId: 'one', name: 'get_portfolio_summary', failed: false, result: { ok: true, data: { total: { kind: 'money', amount: '1250.5000', currency: 'INR', scale: 4 }, twr: { value: null, unavailableReason: 'insufficient_history' } }, meta: { truncated: true, asOf: '2026-10-31', currency: 'INR' } } }], modelId: 'fake-test-model', fallbackDepth: 1 };
beforeEach(() => { auth.mockReset(); auth.mockResolvedValue({ userId: 'owner' }); history.mockReset(); history.mockResolvedValue({ ok: true, value: { items: [], page: 1, hasMore: false } }); });
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
describe('saved conversation navigation', () => {
  it('links to older active history and escapes saved titles while keeping questions disabled', async () => {
    history.mockResolvedValue({ ok: true, value: { items: [{ id: 'saved-id', title: '<script>private title</script>' }], page: 1, hasMore: true } });
    const html = renderToStaticMarkup(await AiPage());
    expect(history).toHaveBeenCalledWith({ userId: 'owner' }, false, 1);
    expect(html).toContain('/ai?history=active&amp;page=2');
    expect(html).not.toContain('Newer conversations');
    expect(html).toContain('/ai/conversations/saved-id'); expect(html).toContain('&lt;script&gt;');
    expect(html).toMatch(/<textarea[^>]*disabled=""/);
  });
  it('preserves the archived group across page navigation', async () => {
    history.mockResolvedValue({ ok: true, value: { items: [], page: 2, hasMore: true } });
    const html = renderToStaticMarkup(await AiPage({ searchParams: Promise.resolve({ history: 'archived', page: '2' }) }));
    expect(history).toHaveBeenCalledWith({ userId: 'owner' }, true, '2');
    expect(html).toContain('/ai?history=archived&amp;page=1');
    expect(html).toContain('/ai?history=archived&amp;page=3');
  });
  it('offers a first-page correction for rejected history input', async () => {
    history.mockResolvedValue({ ok: false, error: { kind: 'validation_failed' } });
    const html = renderToStaticMarkup(await AiPage({ searchParams: Promise.resolve({ history: 'archived', page: ['1', '2'] }) }));
    expect(history).toHaveBeenCalledWith({ userId: 'owner' }, true, ['1', '2']);
    expect(html).toContain('role="alert"'); expect(html).toContain('/ai?history=archived&amp;page=1');
  });
  it('keeps the way back from an empty out-of-range page', async () => {
    history.mockResolvedValue({ ok: true, value: { items: [], page: 3, hasMore: false } });
    const html = renderToStaticMarkup(await AiPage({ searchParams: Promise.resolve({ page: '3' }) }));
    expect(html).toContain('No conversations on this page');
    expect(html).toContain('Newer conversations'); expect(html).not.toContain('Older conversations');
  });
});
describe('assistant answer presentation', () => {
  it('separates interpretation from exact deterministic source data and preserves honesty metadata', () => {
    const html = renderToStaticMarkup(createElement(AssistantAnswer, { answer }));
    expect(html).toContain('Interpretation'); expect(html).toContain('Facts and deterministic calculations');
    expect(html).toContain('1250.5000'); expect(html).toContain('INR');
    expect(html).toContain('Unavailable:'); expect(html).toContain('insufficient history'); expect(html).not.toContain('0%');
    expect(html).toContain('truncated'); expect(html).toContain('true'); expect(html).toContain('2026-10-31');
    expect(html).toContain('— partial results</summary>');
    expect(html).toContain('Some rows were omitted');
    expect(html).toContain('Authoritative totals, where supplied, still apply');
    expect(html).toContain('Fallback used'); expect(html).toContain('Scenario projections are unavailable');
    expect(html).not.toContain('<script>alert(1)</script>'); expect(html).toContain('&lt;script&gt;');
  });
  it('shows a concept answer without pretending financial evidence was fetched', () => {
    const html = renderToStaticMarkup(createElement(AssistantAnswer, { answer: { ...answer, sources: [] } }));
    expect(html).toContain('No financial data was read');
  });
  it('keeps real zero separate from a missing metric and renders failed reads as unavailable', () => {
    const html = renderToStaticMarkup(createElement(AssistantAnswer, { answer: { ...answer, sources: [{ callId: 'zero', name: 'get_accounts', failed: true, result: { balance: 0, metric: null, reason: 'missing price', meta: { truncated: true } } }] } }));
    expect(html).toContain('— unavailable'); expect(html).toContain('>0</span>'); expect(html).toContain('Unavailable'); expect(html).toContain('missing price');
    expect(html).not.toContain('— partial results');
  });
  it.each([undefined, null, { truncated: false }, { truncated: 'true' }])('does not label a complete or unmarked source as partial (%j)', meta => {
    const html = renderToStaticMarkup(createElement(AssistantAnswer, { answer: { ...answer, sources: [{ callId: 'one', name: 'get_accounts', failed: false, result: { ok: true, data: {}, meta } }] } }));
    expect(html).not.toContain('— partial results');
    expect(html).not.toContain('Some rows were omitted');
  });
});
