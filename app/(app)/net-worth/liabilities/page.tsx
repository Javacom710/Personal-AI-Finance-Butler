import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '../../../_components/page-shell';
import { Disclosure, InlineAction } from '../../money/_components';
import { getLiability, listAccounts, listCurrencies, listLiabilities } from '@/server/services';
import { CloseLiabilityForm, LiabilityForm, RecordBalanceForm } from '../_forms';
import {
  closeLiabilityAction,
  createLiabilityAction,
  deleteLiabilityAction,
  recordBalanceAction,
} from '../actions';
import { loadNetWorthContext } from '../_page-data';

export const metadata: Metadata = { title: 'Liabilities' };

const KIND_LABELS: Record<string, string> = {
  home_loan: 'Home loan',
  auto_loan: 'Auto loan',
  personal_loan: 'Personal loan',
  student_loan: 'Student loan',
  credit_card: 'Credit card',
  other: 'Other',
};

/**
 * Liabilities — two shapes, and only one of them carries money.
 *
 * A **transacted** liability is linked to a credit-card or loan account and
 * contributes **nothing** to net worth: the account contributes, by sign. That
 * is the double-count guard (I-8), and it is why this page shows such a row with
 * no outstanding figure of its own rather than repeating the account's.
 */
export default async function LiabilitiesPage() {
  const { ctx, format } = await loadNetWorthContext('/net-worth/liabilities');

  const [liabilities, currencies, accounts] = await Promise.all([
    listLiabilities(ctx, { includeClosed: true }),
    listCurrencies(ctx),
    listAccounts(ctx, { includeInactive: true }),
  ]);

  // Only a credit card or a loan account may back a liability (I-27): linking a
  // bank account would leave the debt counted nowhere while the account counted
  // as an asset.
  const claimed = new Set(liabilities.map((l) => l.linkedAccountId).filter(Boolean));
  const linkable = accounts
    .filter((a) => (a.kind === 'credit_card' || a.kind === 'loan') && !claimed.has(a.id))
    .map((a) => ({ id: a.id, label: `${a.name} (${a.kind === 'credit_card' ? 'card' : 'loan'})` }));

  const open = liabilities.filter((l) => l.isActive);
  const closed = liabilities.filter((l) => !l.isActive);
  const detail = await Promise.all(open.map((l) => getLiability(ctx, l.id)));

  return (
    <>
      <PageHeader
        title="Liabilities"
        description="Loans tracked by statement balance, and cards tracked through their account."
        actions={
          <Link href="/net-worth" className="text-sm text-ink-muted hover:text-ink">
            ← Net worth
          </Link>
        }
      />

      <Disclosure summary="Add a liability" defaultOpen={liabilities.length === 0}>
        <LiabilityForm
          action={createLiabilityAction}
          currencies={currencies.map((c) => c.code)}
          baseCurrency={ctx.base}
          today={ctx.today}
          linkableAccounts={linkable}
        />
      </Disclosure>

      {open.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-ink-muted">
          No liabilities yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {open.map((liability, index) => {
            const loaded = detail[index];
            const balances = loaded?.ok ? loaded.value.balances : [];
            return (
              <li key={liability.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <span className="font-medium">{liability.name}</span>
                    <span className="ml-2 text-xs text-ink-faint">
                      {KIND_LABELS[liability.kind] ?? liability.kind} · {liability.currency}
                    </span>
                  </div>
                  <div className="text-right">
                    {liability.shape === 'transacted' ? (
                      <span className="text-xs text-ink-muted">
                        counted through{' '}
                        <Link
                          href={`/money/accounts/${liability.linkedAccountId}`}
                          className="underline hover:text-ink"
                        >
                          {liability.linkedAccountName}
                        </Link>
                      </span>
                    ) : (
                      <>
                        <span className="tabular-nums">
                          {liability.outstanding === null ? '—' : format.money(liability.outstanding)}
                        </span>
                        {liability.outstandingOn ? (
                          <span className="ml-2 text-xs text-ink-faint">
                            as of {format.dateShort(liability.outstandingOn)}
                          </span>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>

                {liability.interestRate || liability.emiAmount ? (
                  <p className="mt-1 text-xs text-ink-faint">
                    {liability.interestRate ? `${format.percent(liability.interestRate)} · ` : ''}
                    {liability.emiAmount ? `EMI ${format.money(liability.emiAmount)}` : ''} — recorded
                    for reference; no schedule is computed from either.
                  </p>
                ) : null}

                {balances.length > 1 ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-ink-muted">
                      {balances.length} recorded balances
                    </summary>
                    <table className="mt-2 w-full text-xs">
                      <tbody className="divide-y divide-border">
                        {balances.map((b) => (
                          <tr key={b.id}>
                            <td className="py-1">{format.date(b.asOf)}</td>
                            <td className="py-1 text-right tabular-nums">
                              {format.money(b.outstanding)}
                            </td>
                            <td className="py-1 pl-3 text-ink-faint">{b.source}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                ) : null}

                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  {liability.shape === 'scheduled' ? (
                    <Disclosure summary="Record a balance">
                      <RecordBalanceForm
                        action={recordBalanceAction}
                        liabilityId={liability.id}
                        today={ctx.today}
                      />
                    </Disclosure>
                  ) : (
                    <p className="text-xs text-ink-faint">
                      Repayments are recorded against the linked account, not here — a balance on
                      this row would be ignored, and a figure nothing reads is a second source of
                      truth waiting to drift.
                    </p>
                  )}
                  <Disclosure summary="Close">
                    <CloseLiabilityForm
                      action={closeLiabilityAction}
                      liabilityId={liability.id}
                      today={ctx.today}
                    />
                  </Disclosure>
                </div>

                {liability.balanceCount <= 1 ? (
                  <div className="mt-2">
                    <InlineAction
                      action={deleteLiabilityAction}
                      values={{ liabilityId: liability.id }}
                      label="Delete"
                      confirm={`Delete ${liability.name}?`}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {closed.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Closed</h2>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {closed.map((liability) => (
              <li
                key={liability.id}
                className="flex items-baseline justify-between px-3 py-2 text-sm"
              >
                <span>{liability.name}</span>
                <span className="text-xs text-ink-faint">
                  {KIND_LABELS[liability.kind] ?? liability.kind}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-faint">
            Closing writes a zero balance on the closing date, and that zero is what stops the debt
            counting. Every earlier figure still carries it.
          </p>
        </section>
      ) : null}
    </>
  );
}
