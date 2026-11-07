import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), page: vi.fn(), drafts: vi.fn() }));
vi.mock('@/server/auth/guards', () => ({ requireSession: mocks.auth }));
vi.mock('@/server/services', () => ({ listAccounts: async () => [], listCategories: async () => [], listTransactionProposalPage: mocks.page, draftDocumentTransactionProposals: mocks.drafts }));
vi.mock('@app/(app)/money/_page-data', () => ({ loadMoneyContext: async () => ({ ctx: {}, format: {} }) }));
import DocumentDraftPage from '@app/(app)/ai/documents/page';
import { generateDocumentDraftsAction } from '@app/(app)/ai/documents/actions';
import TransactionProposalsPage from '@app/(app)/money/proposals/page';
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ userId: 'owner' }); mocks.page.mockResolvedValue({ ok: true, value: { items: [], page: 2, hasMore: true } }); });
it('keeps image controls and the independently authenticated direct action disabled without staging or a model', async () => {
  const html = renderToStaticMarkup(await DocumentDraftPage()); expect(html).toMatch(/<input[^>]*disabled=""/); expect(html).toMatch(/<button[^>]*disabled=""/);
  expect(html).toContain('unconfirmed proposal'); expect(html).toContain('Native PDFs and investment trades are unavailable');
  expect((await generateDocumentDraftsAction()).status).toBe('unavailable'); expect(mocks.auth).toHaveBeenCalledWith('/ai/documents'); expect(mocks.drafts).not.toHaveBeenCalled();
});
it('authenticates the page and direct action independently', async () => {
  mocks.auth.mockRejectedValue(new Error('login required'));
  await expect(DocumentDraftPage()).rejects.toThrow('login required'); await expect(generateDocumentDraftsAction()).rejects.toThrow('login required');
});
it('preserves older/newer review navigation beyond the first fifty drafts', async () => {
  const html = renderToStaticMarkup(await TransactionProposalsPage({ searchParams: Promise.resolve({ page: '2' }) }));
  expect(mocks.page).toHaveBeenCalledWith({}, '2'); expect(html).toContain('/money/proposals?page=1'); expect(html).toContain('/money/proposals?page=3');
  expect(html).toContain('/ai/documents');
});
it('offers a first-page correction when the draft page input is rejected', async () => {
  mocks.page.mockResolvedValue({ ok: false, error: { code: 'validation_failed' } });
  const html = renderToStaticMarkup(await TransactionProposalsPage({ searchParams: Promise.resolve({ page: ['1', '2'] }) }));
  expect(html).toContain('role="alert"'); expect(html).toContain('Open the first page');
});
