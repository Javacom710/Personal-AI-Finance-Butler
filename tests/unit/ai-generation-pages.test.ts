import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ released: false, auth: vi.fn(), money: vi.fn(), conversation: vi.fn() }));
vi.mock('@/server/ai-feature-release', () => ({ isTier1GenerationReleased: () => mocks.released }));
vi.mock('@/server/auth/guards', () => ({ requireSession: mocks.auth }));
vi.mock('@app/(app)/money/_page-data', () => ({ loadMoneyContext: mocks.money }));
vi.mock('@/server/services', () => ({
  createReadCtx: async () => ({ ok: true, value: { userId: 'owner', locale: 'en-IN', timezone: 'Asia/Kolkata' } }),
  listConversationPage: async () => ({ ok: true, value: { items: [], page: 1, hasMore: false } }),
  getConversation: mocks.conversation, conversationMessages: async () => ({ ok: true, value: [] }),
  listTransactionProposalPage: async () => ({ ok: true, value: { items: [], page: 1, hasMore: false } }),
  listAccounts: async () => [], listCategories: async () => [],
}));
vi.mock('@app/(app)/ai/actions', () => ({ askFinanceQuestionAction: vi.fn(), manageConversationAction: vi.fn() }));
vi.mock('@app/(app)/money/proposals/actions', () => ({ draftTransactionAction: vi.fn(), confirmTransactionProposalAction: vi.fn(), rejectTransactionProposalAction: vi.fn() }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('not found'); } }));
import AiPage from '@app/(app)/ai/page';
import ConversationPage from '@app/(app)/ai/conversations/[conversationId]/page';
import TransactionProposalsPage from '@app/(app)/money/proposals/page';
const detail = () => ConversationPage({ params: Promise.resolve({ conversationId: 'saved-id' }) });
const markup = async (page: ReturnType<typeof detail>) => renderToStaticMarkup(await page);
beforeEach(() => {
  mocks.released = false; mocks.auth.mockReset(); mocks.auth.mockResolvedValue({ userId: 'owner' });
  mocks.money.mockReset(); mocks.money.mockResolvedValue({ ctx: { userId: 'owner' }, format: {} });
  mocks.conversation.mockReset(); mocks.conversation.mockResolvedValue({ ok: true, value: { id: 'saved-id', title: 'Saved', archivedAt: null, revision: 0 } });
});
it('keeps both composed generation forms disabled under the production release hold', async () => {
  for (const html of [await markup(detail()), await markup(TransactionProposalsPage())]) {
    expect(html).toMatch(/<textarea[^>]*disabled=""/); expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(?:Ask about my finances|Create draft)/);
    expect(html).toContain('setup approval');
    const generation = html.match(/<section[^>]*aria-label="(?:Ask in this conversation|Describe a transaction)"[\s\S]*?<\/section>/)?.[0];
    expect(generation).toBeDefined(); expect(generation).not.toMatch(/name="(?:userId|model|tier|previousTier|explicitUserRequest|confirmed)"/);
  }
});
it('prepares named bounded question input only inside an owner-loaded saved conversation', async () => {
  mocks.released = true;
  const html = await markup(detail());
  expect(mocks.auth).toHaveBeenCalledWith('/ai');
  expect(html).toContain('name="conversationId" value="saved-id"');
  expect(html).toMatch(/<textarea(?=[^>]*name="question")(?=[^>]*maxLength="4000")(?=[^>]*required="")[^>]*>/);
  expect(html).not.toMatch(/<textarea[^>]*disabled/);
  expect(html).toContain('Advanced analysis and scenario projections are unavailable');
});
it.each([{ archivedAt: new Date(), revision: 0, reason: 'Archived. Restore' }, { archivedAt: null, revision: 100, reason: 'This conversation is full' }])('disables $reason questions even in a test-released view', async ({ archivedAt, revision, reason }) => {
  mocks.released = true; mocks.conversation.mockResolvedValue({ ok: true, value: { id: 'saved-id', archivedAt, revision } });
  const html = await markup(detail());
  expect(html).toContain(reason); expect(html).toMatch(/<textarea[^>]*disabled=""/);
});
it('prepares a draft-only description form without confirmation or owner fields', async () => {
  mocks.released = true;
  const html = await markup(TransactionProposalsPage());
  expect(mocks.money).toHaveBeenCalledWith('/money/proposals');
  expect(html).toMatch(/<textarea(?=[^>]*name="text")(?=[^>]*maxLength="4000")(?=[^>]*required="")[^>]*>/);
  expect(html).not.toMatch(/<textarea[^>]*disabled/); expect(html).toContain('Review and confirm the draft before anything is recorded');
  expect(html).not.toMatch(/name="(?:userId|confirmed|proposalId|model|tier)"/);
});
it('directs a test-released home view to saved conversations without an unbound question box', async () => {
  mocks.released = true;
  const html = await markup(AiPage());
  expect(html).toContain('Create or open a conversation below'); expect(html).not.toContain('<textarea');
  expect(html).not.toContain('Awaiting setup approval');
});
it('refuses unauthenticated assistant views and unavailable money context independently', async () => {
  mocks.auth.mockRejectedValue(new Error('login required')); mocks.money.mockRejectedValue(new Error('login required'));
  await expect(AiPage()).rejects.toThrow('login required'); await expect(detail()).rejects.toThrow('login required');
  await expect(TransactionProposalsPage()).rejects.toThrow('login required');
});
it('does not render a question form for an unavailable or foreign conversation', async () => {
  mocks.released = true; mocks.conversation.mockResolvedValue({ ok: false });
  await expect(detail()).rejects.toThrow('not found');
});
