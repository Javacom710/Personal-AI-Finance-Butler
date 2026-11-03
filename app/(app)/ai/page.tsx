import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../_components/page-shell';
import { requireSession } from '@/server/auth/guards';

export const metadata: Metadata = { title: 'AI' };
export default async function AiPage() {
  await requireSession('/ai');
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
  </>;
}
