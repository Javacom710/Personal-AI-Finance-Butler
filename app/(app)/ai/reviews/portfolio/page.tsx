import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../../_components/page-shell';
import { requireSession } from '@/server/auth/guards';
export const metadata: Metadata = { title: 'Portfolio analysis' };
export default async function PortfolioAnalysisPage() {
  await requireSession('/ai/reviews/portfolio');
  return <>
    <PageHeader title="Portfolio analysis" description="Review current holdings, performance metrics, allocation and valuation coverage." />
    <p>Portfolio analysis will be available after setup approval.</p>
    <button disabled className="rounded-md bg-accent px-3 py-2 text-accent-ink opacity-50">Analyze portfolio</button>
    <p>Facts and deterministic calculations will be separate from interpretation and recommendations. Missing prices, incomplete coverage and unavailable performance metrics stay visible.</p>
    <Link href="/ai" className="underline">Back to AI</Link>
  </>;
}
