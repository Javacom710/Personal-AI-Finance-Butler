import type { Metadata } from 'next';

import { EmptyState, PageHeader } from '../../_components/page-shell';
import { requireSession } from '@/server/auth/guards';

export const metadata: Metadata = { title: 'Net Worth' };

export default async function NetWorthPage() {
  await requireSession('/net-worth');

  return (
    <>
      <PageHeader
        title="Net Worth"
        description="Assets, liabilities, the net figure, and why it changed."
      />

      <EmptyState title="Nothing to total yet" arriving="Phase 5 — Net Worth">
        <p>
          Assets and liabilities, historical net worth, and a change-attribution waterfall that
          explains a movement as savings, investment gains, new contributions, revaluation, liability
          change and FX.
        </p>
        <p className="mt-3">
          The guard that matters here is single counting: an investment held inside a brokerage
          account must never be totalled both as an account balance and as a holding. Every source
          contributes once, asserted in code rather than assumed.
        </p>
      </EmptyState>
    </>
  );
}
