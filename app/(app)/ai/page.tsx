import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../_components/page-shell';
import { createReadCtx, listConversationPage } from '@/server/services';
import { ConversationManagement } from './management';
import { requireSession } from '@/server/auth/guards';

export const metadata: Metadata = { title: 'AI' };
export default async function AiPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const session = await requireSession('/ai');
  const ctx = await createReadCtx(session.userId);
  if (!ctx.ok) throw new Error('Conversation settings are unavailable.');
  const params = await searchParams ?? {};
  const archived = params.history === 'archived';
  const result = await listConversationPage(ctx.value, archived, params.page ?? 1);
  const historyLink = (page: number) => `/ai?history=${archived ? 'archived' : 'active'}&page=${page}`;
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
      <p className="text-sm text-ink-muted">You can manage conversation history while questions await setup approval. Creating a conversation does not send data to a model.</p>
      <ConversationManagement />
      <nav aria-label="Conversation history groups" className="flex gap-4 text-sm">
        <Link href="/ai" aria-current={!archived ? 'page' : undefined} className="underline">Active conversations</Link>
        <Link href="/ai?history=archived" aria-current={archived ? 'page' : undefined} className="underline">Archived conversations</Link>
      </nav>
      {!result.ok ? <p role="alert">Choose a positive whole-number history page. <Link href={historyLink(1)} className="underline">Open the first page</Link></p> : <>
        {!result.value.items.length && <p>{result.value.page === 1 ? `No ${archived ? 'archived' : 'active'} conversations.` : 'No conversations on this page.'}</p>}
        <ul>{result.value.items.map(c => <li key={c.id}><Link className="underline" href={`/ai/conversations/${c.id}`}>{c.title ?? 'Untitled conversation'}</Link></li>)}</ul>
        <nav aria-label="Conversation history pages" className="flex flex-wrap gap-4 text-sm">
          {result.value.page > 1 && <Link href={historyLink(result.value.page - 1)} className="underline">Newer conversations</Link>}
          <span>Page {result.value.page}</span>
          {result.value.hasMore && <Link href={historyLink(result.value.page + 1)} className="underline">Older conversations</Link>}
        </nav>
      </>}
    </section>
  </>;
}
