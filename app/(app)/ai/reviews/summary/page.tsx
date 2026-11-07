import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../../_components/page-shell';
import { requireSession } from '@/server/auth/guards';
export const metadata: Metadata = { title: 'Period summaries' };
export default async function PeriodSummaryPage() {
  await requireSession('/ai/reviews/summary');
  return <>
    <PageHeader title="Period summaries" description="Summarize recorded monthly income, expenses, savings and changes from the previous month." />
    <p>Period summaries will be available after setup approval. Quarterly and yearly summaries are unavailable.</p>
    <label className="block">Calendar month<input type="month" disabled className="ml-2 rounded-md border border-border p-2" /></label>
    <button disabled className="rounded-md bg-accent px-3 py-2 text-accent-ink opacity-50">Summarize month</button>
    <p>Facts and deterministic calculations will be separate from interpretation and recommendations. Missing metrics remain unavailable.</p>
    <Link href="/ai" className="underline">Back to AI</Link>
  </>;
}
