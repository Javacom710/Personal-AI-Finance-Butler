import type { Metadata } from 'next';

import { EmptyState, PageHeader } from '../../_components/page-shell';
import { requireSession } from '@/server/auth/guards';

export const metadata: Metadata = { title: 'Investments' };

export default async function InvestmentsPage() {
  await requireSession('/investments');

  return (
    <>
      <PageHeader
        title="Investments"
        description="Instruments, the investment ledger, holdings, performance and allocation."
      />

      <EmptyState title="No holdings yet" arriving="Phase 4 — Investment Engine">
        <p>
          Holdings are derived from the investment ledger by a FIFO lot engine, never typed in.
          Cost basis, realised P&amp;L and lot history need no prices at all, which is why they are
          built before market data.
        </p>
        <p className="mt-3">
          Between Phase 4 and Phase 6 holdings are valued <strong>at cost</strong>. Market value,
          unrealised P&amp;L, XIRR and time-weighted return will report as unavailable with the
          reason <span className="tabular">no_price</span> — not as zero.
        </p>
      </EmptyState>
    </>
  );
}
