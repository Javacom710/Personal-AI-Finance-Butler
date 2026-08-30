import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '../../_components/page-shell';
import { periodContaining, previousPeriod } from '@/lib/date/periods';
import {
  breakdown,
  compareWithPrevious,
  listAccounts,
  listBudgetStatuses,
  listCategories,
  listTransactions,
  periodSummary,
  upcomingCommitments,
} from '@/server/services';
import { QuickAdd } from './_components';
import { createTransactionAction, createTransferAction } from './actions';
import { amountTone, loadMoneyContext } from './_page-data';

export const metadata: Metadata = { title: 'Money' };

/**
 * The money hub.
 *
 * Every figure here traces to records the user can open, and every one of them
 * comes from the same engine functions the AI tools will call in Phase 7 — there
 * is no second implementation for the screen to disagree with.
 */
export default async function MoneyPage() {
  const { ctx, format } = await loadMoneyContext('/money');

  const period = periodContaining(ctx.today, 'monthly', ctx.fiscalYearStartMonth);
  const prior = previousPeriod(period, 'monthly', ctx.fiscalYearStartMonth);

  const [accounts, current, comparison, topExpenses, recent, budgets, upcoming, categories] =
    await Promise.all([
      listAccounts(ctx),
      periodSummary(ctx, period),
      compareWithPrevious(ctx, period, prior),
      breakdown(ctx, period, 'category', 'expense'),
      listTransactions(ctx, { limit: 8 }),
      listBudgetStatuses(ctx),
      upcomingCommitments(ctx, 14),
      listCategories(ctx),
    ]);

  if (accounts.length === 0) {
    return (
      <>
        <PageHeader title="Money" description="Accounts, transactions, budgets and recurring commitments." />
        <div className="rounded-lg border border-dashed border-border-strong bg-surface-sunken px-6 py-10 text-center">
          <h2 className="text-sm font-medium">Add an account to begin</h2>
          <p className="mx-auto mt-2 max-w-prose text-sm text-ink-muted">
            An account&apos;s balance is never stored: it is its opening balance plus every ledger
            entry, computed on read. Correcting a transaction dated last March therefore makes every
            balance from March onward right on the next page load.
          </p>
          <Link
            href="/money/accounts"
            className="mt-4 inline-block rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
          >
            Add your first account
          </Link>
        </div>
      </>
    );
  }

  const accountOptions = accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency }));
  const categoryOptions = categories.map((c) => ({ id: c.id, label: c.path, kind: c.kind }));

  return (
    <>
      <PageHeader
        title="Money"
        description={`${format.date(period.from)} – ${format.date(period.to)}`}
        actions={
          <nav className="flex flex-wrap gap-2 text-sm">
            {[
              ['Accounts', '/money/accounts'],
              ['Transactions', '/money/transactions'],
              ['Categories', '/money/categories'],
              ['Budgets', '/money/budgets'],
              ['Recurring', '/money/recurring'],
            ].map(([label, href]) => (
              <Link
                key={href}
                href={href!}
                className="rounded-md border border-border px-2.5 py-1 text-ink-muted hover:text-ink"
              >
                {label}
              </Link>
            ))}
          </nav>
        }
      />

      <section aria-label="This period" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Income" value={format.money(current.income)} tone="text-positive" />
        <Figure label="Expenses" value={format.money(current.expenses)} tone="text-negative" />
        <Figure
          label="Savings"
          value={format.money(current.savings)}
          tone={amountTone(current.savings.minor)}
          note={`${format.money(comparison.savings.absolute, { signDisplay: 'always' })} vs last month`}
        />
        <Figure
          label="Savings rate"
          value={format.metricPercent(current.savingsRate)}
          note={format.reason(current.savingsRate) ?? 'of income kept'}
        />
      </section>

      {current.fxEffect.minor !== 0n ? (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          Realised exchange effect this period: {format.money(current.fxEffect)}. It comes from
          cross-currency transfers and is counted as neither income nor spending.
        </p>
      ) : null}

      <QuickAdd
        entryAction={createTransactionAction}
        transferAction={createTransferAction}
        accounts={accountOptions}
        categories={categoryOptions}
        today={ctx.today}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Accounts</h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs text-ink-faint">
                <tr>
                  <th className="px-3 py-2 font-medium">Account</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      <Link href={`/money/accounts/${account.id}`} className="hover:underline">
                        {account.name}
                      </Link>
                      {account.institution ? (
                        <span className="ml-1 text-xs text-ink-faint">{account.institution}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-xs capitalize text-ink-muted">
                      {account.kind.replace('_', ' ')}
                    </td>
                    <td className={`tabular px-3 py-2 text-right ${amountTone(account.balance.minor)}`}>
                      {format.money(account.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
            Where the money went
          </h2>
          {topExpenses.rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-ink-muted">
              No spending recorded this period.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {topExpenses.rows.slice(0, 6).map((row) => (
                <li key={row.key ?? 'none'} className="flex items-baseline justify-between px-3 py-2 text-sm">
                  <span>{row.label}</span>
                  <span className="tabular text-ink">{format.money(row.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {upcoming.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
            Due in the next 14 days
          </h2>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {upcoming.map((occurrence) => (
              <li key={occurrence.id} className="flex items-baseline justify-between px-3 py-2 text-sm">
                <span>
                  {occurrence.ruleName}
                  <span className="ml-2 text-xs text-ink-faint">{format.date(occurrence.dueOn)}</span>
                </span>
                <span className="tabular">{occurrence.amountText}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {budgets.ok && budgets.value.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Budgets</h2>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {budgets.value.map((budget) => (
              <li key={budget.id} className="flex items-baseline justify-between px-3 py-2 text-sm">
                <span>{budget.categoryLabel}</span>
                <span className={`tabular ${budget.status.isOverBudget ? 'text-negative' : 'text-ink-muted'}`}>
                  {format.money(budget.status.actual)} / {format.money(budget.status.budgeted)}
                  <span className="ml-2 text-xs">
                    {format.metricPercent(budget.status.utilization, 0)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Recent</h2>
          <Link href="/money/transactions" className="text-xs text-ink-muted hover:text-ink">
            All transactions →
          </Link>
        </div>
        {recent.ok && recent.value.rows.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <tbody>
                {recent.value.rows.map((txn) => (
                  <tr key={txn.id} className="border-b border-border last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-faint">
                      {format.dateShort(txn.bookedOn)}
                    </td>
                    <td className="px-3 py-2">{txn.description}</td>
                    <td className="px-3 py-2 text-xs text-ink-muted">
                      {txn.kind === 'transfer' ? 'Transfer' : (txn.categoryName ?? '—')}
                    </td>
                    <td
                      className={`tabular px-3 py-2 text-right ${
                        txn.kind === 'transfer' ? 'text-ink-muted' : amountTone(txn.entries[0]?.amount.minor ?? 0n)
                      }`}
                    >
                      {format.money(txn.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-ink-muted">
            Nothing recorded yet.
          </p>
        )}
      </section>
    </>
  );
}

function Figure({
  label,
  value,
  tone = 'text-ink',
  note,
}: {
  label: string;
  value: string;
  tone?: string;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <p className="text-xs text-ink-faint">{label}</p>
      <p className={`tabular mt-0.5 text-lg ${tone}`}>{value}</p>
      {note ? <p className="mt-0.5 text-xs text-ink-faint">{note}</p> : null}
    </div>
  );
}
