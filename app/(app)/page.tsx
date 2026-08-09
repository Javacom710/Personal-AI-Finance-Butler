import { EmptyState, PageHeader } from '../_components/page-shell';
import { requireSession } from '@/server/auth/guards';

export default async function OverviewPage() {
  await requireSession('/');

  return (
    <>
      <PageHeader
        title="Overview"
        description="Where you stand right now, on one screen."
      />

      <EmptyState title="No financial data yet" arriving="Money arrives in Phase 3">
        <p>
          This screen will show net worth with its period change, then liquid cash, total
          investments, total liabilities and savings rate — followed by this period&apos;s income,
          expenses and top spending categories, portfolio value and allocation, and the recurring
          commitments falling due in the next fortnight.
        </p>
        <p className="mt-3">
          It is empty rather than illustrative on purpose. A placeholder figure on a financial
          dashboard is indistinguishable from a real one at a glance.
        </p>
      </EmptyState>
    </>
  );
}
