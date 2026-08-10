import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PageHeader } from '../../../../_components/page-shell';
import { accountLedger } from '@/server/services';
import { amountTone, loadMoneyContext } from '../../_page-data';

export const metadata: Metadata = { title: 'Account ledger' };

/**
 * One account's ledger with a running balance.
 *
 * The running column is computed by the engine over rows in a total order
 * (`booked_on, created_at, id`) — a running balance over a partial order is a
 * plausible-looking wrong answer, so the ordering is the query's job and not the
 * renderer's.
 */
export default async function AccountLedgerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, format } = await loadMoneyContext(`/money/accounts/${id}`);

  const result = await accountLedger(ctx, id, { limit: 500 });
  if (!result.ok) notFound();

  const { account, lines } = result.value;

  return (
    <>
      <PageHeader
        title={account.name}
        description={`${account.kind.replace('_', ' ')} · ${account.currency}${
          account.institution ? ` · ${account.institution}` : ''
        }`}
        actions={
          <Link href="/money/accounts" className="text-sm text-ink-muted hover:text-ink">
            ← Accounts
          </Link>
        }
      />

      <section className="grid gap-3 sm:grid-cols-3">
        <Figure label="Opening balance" value={format.money(account.openingBalance)} />
        <Figure
          label="Current balance"
          value={format.money(account.balance)}
          tone={amountTone(account.balance.minor)}
        />
        <Figure
          label={`In ${format.base}`}
          value={format.metricMoney(account.baseBalance)}
          note={format.reason(account.baseBalance)}
        />
      </section>

      <p className="text-xs text-ink-faint">
        Opened {format.date(account.openingDate)}. The balance is the opening balance plus every
        entry below — nothing is stored, so an edit to any row corrects every figure after it.
      </p>

      {lines.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-ink-muted">
          No movements yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-ink-faint">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="px-3 py-2 font-medium">Category / counterpart</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.entryId} className="border-b border-border last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-faint">
                    {format.date(line.bookedOn)}
                  </td>
                  <td className="px-3 py-2">{line.description}</td>
                  <td className="px-3 py-2 text-xs text-ink-muted">
                    {line.kind === 'transfer'
                      ? `Transfer · ${line.counterAccountName ?? 'unknown account'}`
                      : (line.categoryName ?? '—')}
                  </td>
                  <td className={`tabular px-3 py-2 text-right ${amountTone(line.amount.minor)}`}>
                    {format.money(line.amount, { signDisplay: 'always' })}
                  </td>
                  <td className="tabular px-3 py-2 text-right text-ink-muted">
                    {format.money(line.balance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Figure({ label, value, tone = 'text-ink', note }: { label: string; value: string; tone?: string; note?: string }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <p className="text-xs text-ink-faint">{label}</p>
      <p className={`tabular mt-0.5 text-lg ${tone}`}>{value}</p>
      {note ? <p className="mt-0.5 text-xs text-ink-faint">{note}</p> : null}
    </div>
  );
}
