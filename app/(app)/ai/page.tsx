import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../_components/page-shell';
import { createReadCtx, listConversations } from '@/server/services';
import { ConversationManagement } from './management';
import { requireSession } from '@/server/auth/guards';

export const metadata: Metadata = { title: 'AI' };
export default async function AiPage() {
  const session = await requireSession('/ai');
  const ctx = await createReadCtx(session.userId);
  if (!ctx.ok) throw new Error('Conversation settings are unavailable.');
  const [active, archived] = await Promise.all([listConversations(ctx.value), listConversations(ctx.value, true)]);
  return <>
    <PageHeader title="Financial assistant" description="Ask about your finances using read-only financial tools." />
    <section className="space-y-3 rounded-lg border border-border p-4">
      <h2 className="font-semibold">Awaiting setup approval</h2>
      <p>The assistant will be available after the model lineup is reviewed and approved. No questions or financial data are being sent to a model here.</p>
      <label className="block">Your question<textarea disabled placeholder="Where did most of my money go last month?" className="mt-1 w-full rounded-md border border-border bg-surface p-3" /></label>
      <button disabled className="rounded-md bg-accent px-3 py-2 text-accent-ink opacity-50">Ask about my finances</button>
      <p className="text-sm text-ink-muted">The assistant only reads. Its explanations will be shown separately from source facts and deterministic calculations. Missing metrics remain unavailable. Scenario projections are unavailable.</p>
      <Link href="/money" className="inline-block underline">Open Money for manual entry</Link>
    </section>
    <section className="space-y-4" aria-label="Saved conversations">
      <h2 className="font-semibold">Saved conversations</h2>
      <p className="text-sm text-ink-muted">You can manage conversation history while questions await setup approval. The most recent 50 conversations in each group are shown. Creating a conversation does not send data to a model.</p>
      <ConversationManagement />
      {!active.length && <p>No active conversations.</p>}
      <ul>{active.map(c => <li key={c.id}><Link className="underline" href={`/ai/conversations/${c.id}`}>{c.title ?? 'Untitled conversation'}</Link></li>)}</ul>
      {!!archived.length && <details><summary>Archived conversations</summary><ul>{archived.map(c => <li key={c.id}><Link className="underline" href={`/ai/conversations/${c.id}`}>{c.title ?? 'Untitled conversation'}</Link></li>)}</ul></details>}
    </section>
  </>;
}
