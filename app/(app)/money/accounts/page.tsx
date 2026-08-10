import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '../../../_components/page-shell';
import { listAccounts, listCurrencies } from '@/server/services';
import { Disclosure, InlineAction } from '../_components';
import { AccountForm } from '../_forms';
import { createAccountAction, deleteAccountAction, setAccountActiveAction } from '../actions';
import { amountTone, loadMoneyContext } from '../_page-data';

export const metadata: Metadata = { title: 'Accounts' };

export default async function AccountsPage() {
  const { ctx, format } = await loadMoneyContext('/money/accounts');
  const [accounts, currencies] = await Promise.all([
    listAccounts(ctx, { includeInactive: true }),
    listCurrencies(ctx),
  ]);

  const active = accounts.filter((a) => a.isActive);
  const closed = accounts.filter((a) => !a.isActive);

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Balances are derived from the ledger on every read — there is no stored balance column."
        actions={
          <Link href="/money" className="text-sm text-ink-muted hover:text-ink">
            ← Money
          </Link>
        }
      />

      <Disclosure summary="Add an account" defaultOpen={accounts.length === 0}>
        <AccountForm
          action={createAccountAction}
          currencies={currencies.map((c) => c.code)}
          baseCurrency={ctx.base}
          today={ctx.today}
        />
      </Disclosure>

      <AccountTable accounts={active} format={format} heading="Open" />

      {closed.length > 0 ? (
        <>
          <AccountTable accounts={closed} format={format} heading="Closed" />
          <p className="text-xs text-ink-faint">
            Closing an account does not zero it. Its history stays in past totals, and a non-zero
            balance on a closed account is flagged above.
          </p>
        </>
      ) : null}
    </>
  );
}

function AccountTable({
  accounts,
  format,
  heading,
}: {
  accounts: Awaited<ReturnType<typeof listAccounts>>;
  format: Awaited<ReturnType<typeof loadMoneyContext>>['format'];
  heading: string;
}) {
  if (accounts.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{heading}</h2>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-ink-faint">
            <tr>
              <th className="px-3 py-2 font-medium">Account</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Currency</th>
              <th className="px-3 py-2 text-right font-medium">Balance</th>
              <th className="px-3 py-2 text-right font-medium">Available credit</th>
              <th className="px-3 py-2 font-medium">Last activity</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2">
                  <Link href={`/money/accounts/${account.id}`} className="hover:underline">
                    {account.name}
                  </Link>
                  {!account.isActive && account.balance.minor !== 0n ? (
                    <span className="ml-2 rounded-full border border-warning/50 px-1.5 py-0.5 text-[0.625rem] text-warning">
                      closed with a balance
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-xs capitalize text-ink-muted">
                  {account.kind.replace('_', ' ')}
                </td>
                <td className="px-3 py-2 text-xs text-ink-muted">{account.currency}</td>
                <td className={`tabular px-3 py-2 text-right ${amountTone(account.balance.minor)}`}>
                  {format.money(account.balance)}
                </td>
                <td className="tabular px-3 py-2 text-right text-xs text-ink-muted">
                  {account.availableCredit ? format.money(account.availableCredit) : '—'}
                </td>
                <td className="px-3 py-2 text-xs text-ink-muted">
                  {account.lastActivityOn ? format.date(account.lastActivityOn) : '—'}
                </td>
                <td className="space-x-2 px-3 py-2 text-right">
                  <InlineAction
                    action={setAccountActiveAction}
                    label={account.isActive ? 'Close' : 'Reopen'}
                    values={{ id: account.id, isActive: account.isActive ? 'false' : 'true' }}
                  />
                  {account.entryCount === 0 ? (
                    <InlineAction
                      action={deleteAccountAction}
                      label="Delete"
                      variant="danger"
                      values={{ id: account.id }}
                      confirm={`Delete ${account.name}? It has no ledger entries, so nothing is lost.`}
                    />
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
