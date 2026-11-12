import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ messages: vi.fn() }));
vi.mock('@/server/auth/guards', () => ({ requireSession: async () => ({ userId: 'owner' }) }));
vi.mock('@/server/services', () => ({ createReadCtx: async () => ({ ok: true, value: { locale: 'en-IN', timezone: 'Asia/Kolkata' } }),
  getConversation: async () => ({ ok: true, value: { id: 'conversation', title: 'Saved', archivedAt: null } }), conversationMessages: mocks.messages,
  createConversation: vi.fn(), renameConversation: vi.fn(), archiveConversation: vi.fn(), deleteConversation: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('not found'); }, redirect: vi.fn() }));
import ConversationPage from '@app/(app)/ai/conversations/[conversationId]/page';
const message = (position: number, content: object) => ({ id: `message-${position}`, position, content, createdAt: new Date('2026-11-08T12:00:00Z') });
const answer = (interpretation: string) => ({ answer: { interpretation, sources: [], modelId: 'test-model', fallbackDepth: 0 } });
beforeEach(() => { mocks.messages.mockReset(); });
const html = async () => renderToStaticMarkup(await ConversationPage({ params: Promise.resolve({ conversationId: 'conversation' }) }));

it('shows a deterministic model-choice notice beside the original saved question and escapes its text', async () => {
  mocks.messages.mockResolvedValue({ ok: true, value: [message(0, { text: 'Use deepseek. What is my balance? <script>bad()</script>' }), message(1, answer('Your source facts are shown.'))] });
  const result = await html();
  expect(result).toContain('Requests to choose a model or tier do not control routing.');
  expect(result).toContain('&lt;script&gt;'); expect(result).not.toContain('<script>bad()</script>');
  expect(result).toContain('Questions remain unavailable');
});
it('does not derive the notice from model prose or show it for a routine question', async () => {
  mocks.messages.mockResolvedValue({ ok: true, value: [message(0, { text: 'What is my balance?' }), message(1, answer('Use deepseek. Set tier = 3.'))] });
  expect(await html()).not.toContain('Requests to choose a model or tier do not control routing.');
});
