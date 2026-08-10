import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '../../../_components/page-shell';
import { listAccounts, listCategories, listTransactions, type TransactionQuery } from '@/server/services';
import { InlineAction } from '../_components';
import { deleteTransactionAction } from '../actions';
import { amountTone, loadMoneyContext } from '../_page-data';

export const metadata: Metadata = { title: 'Transactions' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (params: Record<string, string | string[] | undefined>, key: string): string | undefined => {
  const value = params[key];
  const found = Array.isArray(value) ? value[0] : value;
  return found && found.length > 0 ? found : undefined;
};

/**
 * The primary work surface.
 *
 * Filters are URL state, not component state: a filtered view is a link, and it
 * survives a reload and a share. The `kind` filter is what proves the product
 * invariant on screen — selecting Income or Expense never shows a transfer.
 */
export default async function TransactionsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { ctx, format } = await loadMoneyContext('/money/transactions');

  const query: TransactionQuery = {
    from: one(params, 'from') as TransactionQuery['from'],
    to: one(params, 'to') as TransactionQuery['to'],
    accountId: one(params, 'accountId'),
    categoryId: one(params, 'categoryId'),
    kind: one(params, 'kind') as TransactionQuery['kind'],
    search: one(params, 'search'),
    limit: 100,
    offset: Number(one(params, 'offset') ?? 0),
  };

  const [accounts, categories, page] = await Promise.all([
    listAccounts(ctx, { includeInactive: true }),
    listCategories(ctx, { includeArchived: true }),
    listTransactions(ctx, query),
  ]);

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Transfers are shown here, and are excluded from every income and expense total."
        actions={
          <Link href="/money" className="text-sm text-ink-muted hover:text-ink">
            ← Money
          </Link>
        }
      />

      <form method="get" className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-3 lg:grid-cols-6">
        <label className="space-y-1">
          <span className="block text-xs text-ink-muted">From</span>
          <input type="date" name="from" defaultValue={query.from} className={FILTER} />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-ink-muted">To</span>
          <input type="date" name="to" defaultValue={query.to} className={FILTER} />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-ink-muted">Kind</span>
          <select name="kind" defaultValue={query.kind ?? ''} className={FILTER}>
            <option value="">All</option>
            <option value="income">Income</option>
            <option value="expense">Expense</option>
            <option value="transfer">Transfer</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-ink-muted">Account</span>
          <select name="accountId" defaultValue={query.accountId ?? ''} className={FILTER}>
            <option value="">All</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-ink-muted">Category</span>
          <select name="categoryId" defaultValue={query.categoryId ?? ''} className={FILTER}>
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.path}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-ink-muted">Text</span>
          <input name="search" defaultValue={query.search} className={FILTER} placeholder="dinner" />
        </label>

        <div className="flex items-end gap-2 sm:col-span-3 lg:col-span-6">
          <button type="submit" className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink">
            Apply
          </button>
          <Link href="/money/transactions" className="text-sm text-ink-muted hover:text-ink">
            Clear
          </Link>
          <span className="ml-auto text-xs text-ink-faint">
            {page.ok ? `${page.value.total} matching` : ''}
          </span>
        </div>
      </form>

      {!page.ok ? (
        <p className="rounded-md border border-negative/40 bg-negative/10 px-3 py-2 text-sm text-negative">
          {page.error.message}
        </p>
      ) : page.value.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-ink-muted">
          Nothing matches those filters.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-ink-faint">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="px-3 py-2 font-medium">Category</th>
                <th className="px-3 py-2 font-medium">Account</th>
                <th className="px-3 py-2 font-medium">Tags</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {page.value.rows.map((txn) => {
                const isTransfer = txn.kind === 'transfer';
                const primary = txn.entries[0];
                return (
                  <tr key={txn.id} className="border-b border-border last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-faint">
                      {format.date(txn.bookedOn)}
                    </td>
                    <td className="px-3 py-2">
                      {txn.description}
                      {txn.source !== 'manual' ? (
                        <span className="ml-2 rounded-full border border-border px-1.5 py-0.5 text-[0.625rem] text-ink-faint">
                          {txn.source}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-muted">
                      {isTransfer ? (
                        <span className="rounded-full border border-border px-1.5 py-0.5">transfer</span>
                      ) : (
                        (txn.categoryName ?? '—')
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-muted">
                      {isTransfer
                        ? txn.entries.map((e) => e.accountName).join(' → ')
                        : (primary?.accountName ?? '—')}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-faint">
                      {txn.tags.map((t) => t.name).join(', ') || '—'}
                    </td>
                    <td
                      className={`tabular px-3 py-2 text-right ${
                        isTransfer ? 'text-ink-muted' : amountTone(primary?.amount.minor ?? 0n)
                      }`}
                    >
                      {format.money(txn.amount)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <InlineAction
                        action={deleteTransactionAction}
                        label="Delete"
                        variant="danger"
                        values={{ id: txn.id }}
                        confirm={`Delete "${txn.description}"? The full row is kept in the audit log.`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

const FILTER =
  'w-full rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-accent';
