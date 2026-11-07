import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../../_components/page-shell';
import { requireSession } from '@/server/auth/guards';
export const metadata: Metadata = { title: 'Monthly financial review' };
export default async function MonthlyReviewPage() {
  await requireSession('/ai/reviews/monthly');
  return <>
    <PageHeader title="Monthly financial review" description="Review income, spending, savings, budgets and changes from the previous month." />
    <p>Monthly reviews will be available after setup approval.</p>
    <label className="block">Calendar month<input type="month" disabled className="ml-2 rounded-md border border-border p-2" /></label>
    <button disabled className="rounded-md bg-accent px-3 py-2 text-accent-ink opacity-50">Generate monthly review</button>
    <p>Reviews separate facts, deterministic calculations, interpretation and recommendations. Missing metrics remain unavailable. Reviews do not change financial records.</p>
    <Link href="/ai" className="underline">Back to AI</Link>
  </>;
}
