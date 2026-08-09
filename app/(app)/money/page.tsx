import type { Metadata } from 'next';

import { EmptyState, PageHeader } from '../../_components/page-shell';
import { requireSession } from '@/server/auth/guards';

export const metadata: Metadata = { title: 'Money' };

export default async function MoneyPage() {
  await requireSession('/money');

  return (
    <>
      <PageHeader
        title="Money"
        description="Accounts, transactions, categories, budgets and recurring commitments."
      />

      <EmptyState title="No accounts yet" arriving="Phase 3 — Financial Core">
        <p>
          Accounts, the transaction ledger, transfers, categories, budgets and recurring rules are
          built in Phase 3, on top of the exact-money primitives and the schema this phase
          established.
        </p>
        <p className="mt-3">
          Balances will never be a stored column: an account balance is its opening balance plus
          every ledger entry, computed on read, so correcting a transaction dated last March makes
          every balance from March onward right on the next page load.
        </p>
      </EmptyState>
    </>
  );
}
