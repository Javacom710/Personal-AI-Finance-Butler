import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../../_components/page-shell';
import { requireSession } from '@/server/auth/guards';
export const metadata: Metadata = { title: 'Cross-domain financial analysis' };
export default async function CrossDomainPage() {
  await requireSession('/ai/reviews/cross-domain');
  return <>
    <PageHeader title="Cross-domain financial analysis" description="Review cash flow, balances, investments, net worth and commitments together." />
    <p>Cross-domain analysis will be available after setup approval.</p>
    <button disabled className="rounded-md bg-accent px-3 py-2 text-accent-ink opacity-50">Review across finances</button>
    <p>Cost and market net worth stay distinctly labeled. Facts and deterministic calculations will be separate from interpretation and recommendations. Unsupported ratios and scenarios remain unavailable.</p>
    <Link href="/ai" className="underline">Back to AI</Link>
  </>;
}
