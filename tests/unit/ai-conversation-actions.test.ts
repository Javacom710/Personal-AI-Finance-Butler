import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import type * as React from 'react';
import type { ActionState } from '@app/(app)/money/form-state';
const ui = vi.hoisted(() => ({ state: undefined as ActionState | undefined }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof React>();
  return { ...actual, useActionState: (_action: unknown, initial: unknown) => [ui.state ?? initial, () => {}, false] };
});
import { renderToStaticMarkup } from 'react-dom/server';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), context: vi.fn(), create: vi.fn(), rename: vi.fn(), archive: vi.fn(), remove: vi.fn(), export: vi.fn() }));
vi.mock('@/server/auth/guards', () => ({ requireSession: mocks.auth }));
vi.mock('@/server/services', () => ({ createReadCtx: mocks.context, createConversation: mocks.create, renameConversation: mocks.rename, archiveConversation: mocks.archive, deleteConversation: mocks.remove, exportConversation: mocks.export }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
import { askFinanceQuestionAction, manageConversationAction } from '@app/(app)/ai/actions';
import { GET } from '@app/(app)/ai/conversations/[conversationId]/export/route';
import { ConversationManagement } from '@app/(app)/ai/management';
import { EMPTY_ACTION_STATE } from '@app/(app)/money/form-state';
const id = '00000000-0000-4000-8000-000000000001';
const ctx = { userId: 'owner' };
beforeEach(() => {
  ui.state = undefined; vi.clearAllMocks(); mocks.auth.mockResolvedValue({ userId: 'owner' }); mocks.context.mockResolvedValue({ ok: true, value: ctx });
  for (const fn of [mocks.create, mocks.rename, mocks.archive]) fn.mockResolvedValue({ ok: true, value: undefined });
  mocks.remove.mockImplementation(async (_ctx, _id, confirmed) => confirmed ? ({ ok: true, value: undefined }) : ({ ok: false, error: { code: 'validation_failed', fieldErrors: { confirmed: ['Confirm deletion.'] } } }));
});
function form(operation: string) { const f = new FormData(); f.set('operation', operation); f.set('conversationId', id); f.set('title', 'Review'); return f; }
describe('conversation actions', () => {
  it('keeps direct ask calls disabled without even loading a request context', async () => {
    expect((await askFinanceQuestionAction()).status).toBe('unavailable'); expect(mocks.context).not.toHaveBeenCalled();
  });
  it.each(['create', 'rename', 'archive', 'restore', 'delete'])('authenticates %s before a service can run', async operation => {
    mocks.auth.mockRejectedValueOnce(new Error('login required'));
    await expect(manageConversationAction(EMPTY_ACTION_STATE, form(operation))).rejects.toThrow('login required');
    expect(mocks.context).not.toHaveBeenCalled();
  });
  it('uses session context, validates deletion acknowledgement and never trusts a form user identifier', async () => {
    const f = form('delete'); f.set('userId', 'other');
    await manageConversationAction(EMPTY_ACTION_STATE, f); expect(mocks.remove).toHaveBeenLastCalledWith(ctx, id, false);
    f.set('confirmed', 'true'); await expect(manageConversationAction(EMPTY_ACTION_STATE, f)).rejects.toThrow('redirect:/ai'); expect(mocks.remove).toHaveBeenLastCalledWith(ctx, id, true);
    expect(mocks.context).toHaveBeenCalledWith('owner');
  });
  it.each(['create', 'rename', 'archive', 'restore'])('uses the ordinary owner-scoped %s service', async operation => {
    expect((await manageConversationAction(EMPTY_ACTION_STATE, form(operation))).status).toBe('ok');
    if (operation === 'create') expect(mocks.create).toHaveBeenCalledWith(ctx, 'Review');
    if (operation === 'rename') expect(mocks.rename).toHaveBeenCalledWith(ctx, id, 'Review');
    if (operation === 'archive' || operation === 'restore') expect(mocks.archive).toHaveBeenCalledWith(ctx, id, operation === 'archive');
  });
  it('rejects unknown operations and surfaces owner-scoped failures', async () => {
    expect((await manageConversationAction(EMPTY_ACTION_STATE, form('unknown'))).status).toBe('error');
    expect(mocks.create).not.toHaveBeenCalled();
    mocks.rename.mockResolvedValueOnce({ ok: false, error: { code: 'not_found', message: 'Conversation unavailable' } });
    expect((await manageConversationAction(EMPTY_ACTION_STATE, form('rename'))).status).toBe('error');
  });
  it('shows field-level title errors returned by the service', () => {
    ui.state = { status: 'error', message: 'Check the highlighted fields.', fieldErrors: { title: ['Enter a title of 1–120 characters.'] } };
    const html = renderToStaticMarkup(createElement(ConversationManagement, {}));
    expect(html).toContain('title: '); expect(html).toContain('Enter a title of 1–120 characters.');
  });
  it('requires explicit deletion in the rendered management form and escapes conversation titles', () => {
    const html = renderToStaticMarkup(createElement(ConversationManagement, { id, title: '<script>bad()</script>', archived: false }));
    expect(html).toMatch(/<input(?=[^>]*name="confirmed")(?=[^>]*required="")[^>]*>/);
    expect(html).not.toContain('<script>bad()</script>'); expect(html).toContain('&lt;script&gt;'); expect(html).toContain('Archive conversation');
  });
});
describe('private conversation export', () => {
  const request = new Request(`http://localhost/ai/conversations/${id}/export`);
  const params = { params: Promise.resolve({ conversationId: id }) };
  it('authenticates before accessing history', async () => {
    mocks.auth.mockRejectedValueOnce(new Error('login required'));
    await expect(GET(request, params)).rejects.toThrow('login required'); expect(mocks.export).not.toHaveBeenCalled();
  });
  it('exports exact strings using a private non-cacheable attachment', async () => {
    mocks.export.mockResolvedValueOnce({ ok: true, value: { conversation: { id }, messages: [{ amount: '987.6500' }] } });
    const response = await GET(request, params);
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-disposition')).toContain(`conversation-${id}.json`); expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await response.json()).messages[0].amount).toBe('987.6500'); expect(mocks.export).toHaveBeenCalledWith(ctx, id);
  });
  it('returns the same generic unavailable result for foreign or nonexistent history', async () => {
    mocks.export.mockResolvedValueOnce({ ok: false, error: { code: 'not_found' } });
    const response = await GET(request, params); expect(response.status).toBe(404); expect(await response.json()).toEqual({ error: 'Conversation unavailable.' });
  });
});
