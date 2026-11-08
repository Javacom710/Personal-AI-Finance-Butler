import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ released: false, auth: vi.fn(), context: vi.fn(), compose: vi.fn(), draft: vi.fn(), ask: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/server/ai-feature-release', () => ({ isTier1GenerationReleased: () => mocks.released }));
vi.mock('@/server/auth/guards', () => ({ requireSession: mocks.auth }));
vi.mock('@/server/ai-tier1-features', () => ({ composeTier1Features: mocks.compose }));
vi.mock('@/server/services', () => ({ createReadCtx: mocks.context, createConversation: vi.fn(), renameConversation: vi.fn(), archiveConversation: vi.fn(), deleteConversation: vi.fn(), applyTransactionProposal: vi.fn(), rejectTransactionProposal: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
import { askFinanceQuestionAction } from '@app/(app)/ai/actions';
import { draftTransactionAction } from '@app/(app)/money/proposals/actions';
import { EMPTY_ACTION_STATE } from '@app/(app)/money/form-state';

const ctx = { userId: 'authenticated-owner' };
const form = () => { const f = new FormData(); f.set('userId', 'foreign-owner'); f.set('conversationId', 'untrusted-form-id'); f.set('question', 'My balance?'); f.set('text', 'Dinner'); f.set('explicitUserRequest', 'true'); return f; };
beforeEach(() => {
  vi.clearAllMocks(); mocks.released = false;
  mocks.auth.mockResolvedValue({ userId: ctx.userId }); mocks.context.mockResolvedValue({ ok: true, value: ctx });
  mocks.compose.mockReturnValue({ draftTransaction: mocks.draft, askConversation: mocks.ask });
  mocks.draft.mockResolvedValue({ ok: true, value: { id: 'trusted-draft' } });
  mocks.ask.mockResolvedValue({ ok: true, value: { conversationId: 'trusted-conversation' } });
});
const run = (feature: 'ask' | 'draft') => feature === 'ask' ? askFinanceQuestionAction(EMPTY_ACTION_STATE, form()) : draftTransactionAction(EMPTY_ACTION_STATE, form());

it.each(['ask', 'draft'] as const)('%s authenticates before checking the hold or constructing context', async feature => {
  mocks.auth.mockRejectedValueOnce(new Error('login required'));
  await expect(run(feature)).rejects.toThrow('login required');
  expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.compose).not.toHaveBeenCalled();
});
it.each(['ask', 'draft'] as const)('%s retains the release hold before context, generation or navigation', async feature => {
  expect((await run(feature)).status).toBe(feature === 'ask' ? 'unavailable' : 'error');
  expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.compose).not.toHaveBeenCalled();
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
it('prepares saved-question wiring with session ownership and a trusted result redirect', async () => {
  mocks.released = true;
  await expect(run('ask')).rejects.toThrow('redirect:/ai/conversations/trusted-conversation');
  expect(mocks.auth).toHaveBeenCalledWith('/ai'); expect(mocks.context).toHaveBeenCalledWith(ctx.userId);
  expect(mocks.compose).toHaveBeenCalledWith(ctx);
  expect(mocks.ask).toHaveBeenCalledWith('untrusted-form-id', 'My balance?');
  expect(mocks.revalidate).toHaveBeenCalledWith('/ai', 'layout'); expect(mocks.draft).not.toHaveBeenCalled();
});
it('prepares draft-only wiring and redirects to the existing draft review list', async () => {
  mocks.released = true;
  await expect(run('draft')).rejects.toThrow('redirect:/money/proposals');
  expect(mocks.auth).toHaveBeenCalledWith('/money/proposals'); expect(mocks.context).toHaveBeenCalledWith(ctx.userId);
  expect(mocks.compose).toHaveBeenCalledWith(ctx); expect(mocks.draft).toHaveBeenCalledWith('Dinner');
  expect(mocks.revalidate).toHaveBeenCalledExactlyOnceWith('/money/proposals');
});
it.each(['ask', 'draft'] as const)('%s stops when session context is unavailable', async feature => {
  mocks.released = true; mocks.context.mockResolvedValueOnce({ ok: false, error: { code: 'not_found', message: 'Settings unavailable.' } });
  expect(await run(feature)).toMatchObject({ status: 'error', message: 'Settings unavailable.' });
  expect(mocks.compose).not.toHaveBeenCalled(); expect(mocks.revalidate).not.toHaveBeenCalled();
});
it('returns domain errors from a refused question without saving or navigating', async () => {
  mocks.released = true;
  mocks.ask.mockResolvedValueOnce({ ok: false, error: { code: 'validation_failed', fieldErrors: { question: ['Try a narrower question.'] } } });
  expect(await run('ask')).toMatchObject({ status: 'error', fieldErrors: { question: ['Try a narrower question.'] } });
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
