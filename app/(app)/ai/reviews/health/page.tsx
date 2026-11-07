import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../../_components/page-shell';
import { requireSession } from '@/server/auth/guards';
export const metadata: Metadata = { title: 'Financial-health analysis' };
export default async function FinancialHealthPage() {
  await requireSession('/ai/reviews/health');
  return <>
    <PageHeader title="Financial-health analysis" description="Review cash flow, balances, budgets, liabilities and scheduled commitments together." />
    <p>Financial-health analysis will be available after setup approval.</p>
    <button disabled className="rounded-md bg-accent px-3 py-2 text-accent-ink opacity-50">Review financial health</button>
    <p>Facts and deterministic calculations will be separate from interpretation and recommendations. Missing metrics remain unavailable; scheduled commitments are distinguished from recorded transactions.</p>
    <Link href="/ai" className="underline">Back to AI</Link>
  </>;
}
