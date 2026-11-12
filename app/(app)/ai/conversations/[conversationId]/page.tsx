import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '@/server/auth/guards';
import { conversationMessages, createReadCtx, getConversation } from '@/server/services';
import { PageHeader } from '../../../../_components/page-shell';
import { AssistantAnswer } from '../../answer';
import { ConversationManagement } from '../../management';
import { QuestionForm } from '../../question-form';
import { isTier1GenerationReleased } from '@/server/ai-feature-release';
import { classifyEscalation } from '@/server/ai/orchestrator/escalation';

export default async function ConversationPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const session = await requireSession('/ai');
  const ctx = await createReadCtx(session.userId);
  if (!ctx.ok) throw new Error('Conversation settings are unavailable.');
  const { conversationId } = await params;
  const conversation = await getConversation(ctx.value, conversationId);
  if (!conversation.ok) notFound();
  const messages = await conversationMessages(ctx.value, conversationId);
  if (!messages.ok) notFound();
  const c = conversation.value;
  const released = isTier1GenerationReleased();
  const blockedReason = c.archivedAt ? 'Archived. Restore this conversation to continue.' : c.revision >= 100 ? 'This conversation is full. Start a new conversation.' : undefined;
  return <>
    <PageHeader title={c.title ?? 'Conversation'} actions={<Link href="/ai">All conversations</Link>} />
    <Link className="underline" href={`/ai/conversations/${c.id}/export`}>Export this conversation (JSON)</Link>
    <ConversationManagement id={c.id} title={c.title ?? ''} archived={!!c.archivedAt} />
    <section aria-label="Conversation history" className="space-y-5">
      {!messages.value.length && <p>No saved messages.</p>}
      {messages.value.map(m => <div key={m.id}>
        <p className="text-xs text-ink-muted">{new Intl.DateTimeFormat(ctx.value.locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: ctx.value.timezone }).format(m.createdAt)}</p>
        {'text' in m.content ? <section><h2 className="font-semibold">Your question</h2><p className="whitespace-pre-wrap">{m.content.text}</p>
          {classifyEscalation(m.content.text).modelChoiceIgnored && <p className="mt-2 text-sm text-ink-muted">Requests to choose a model or tier do not control routing. The application selects the serving model.</p>}
        </section> : <AssistantAnswer answer={m.content.answer} />}
      </div>)}
    </section>
    <QuestionForm conversationId={c.id} released={released} blockedReason={blockedReason} />
  </>;
}
