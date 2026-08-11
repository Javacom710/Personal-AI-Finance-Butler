import type { Metadata } from 'next';

import { PageHeader } from '../../../_components/page-shell';
import { Disclosure, InlineAction } from '../../money/_components';
import { loadMoneyContext } from '../../money/_page-data';
import { listAccounts, listInstruments, listInvestmentTransactions } from '@/server/services';
import { InvestmentTransactionForm } from '../_forms';
import { createInvestmentTransactionAction, deleteInvestmentTransactionAction } from '../actions';
import { NavTabs, TABLE, TD, TD_NUM, TH, TH_NUM } from '../_components';

export const metadata: Metadata = { title: 'Investment ledger' };

const KIND_LABELS: Record<string, string> = {
  buy: 'Buy',
  sell: 'Sell',
  mf_purchase: 'MF purchase',
  mf_redemption: 'MF redemption',
  dividend: 'Dividend',
  interest: 'Interest',
  fee: 'Fee',
  tax: 'Tax',
  split: 'Split',
  bonus: 'Bonus',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
};

/**
 * The investment ledger.
 *
 * This is the **only** truth in the investment domain: holdings, cost basis and
 * realised P&L are all replayed from these rows, and deleting one re-derives
 * the position rather than patching it.
 */
export default async function InvestmentTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ctx, format } = await loadMoneyContext('/investments/transactions');
  const params = await searchParams;
  const one = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  };

  const [accounts, instruments, page] = await Promise.all([
    listAccounts(ctx),
    listInstruments(ctx),
    listInvestmentTransactions(ctx, {
      ...(one('instrumentId') === undefined ? {} : { instrumentId: one('instrumentId')! }),
      ...(one('accountId') === undefined ? {} : { accountId: one('accountId')! }),
      ...(one('kind') === undefined ? {} : { kind: one('kind') as never }),
      limit: 100,
    }),
  ]);

  if (!page.ok) throw new Error(page.error.message);

  const accountOptions = accounts.map((a) => ({ id: a.id, label: a.name, currency: a.currency }));
  const instrumentOptions = instruments.map((i) => ({ id: i.id, label: i.symbol, currency: i.currency }));

  return (
    <>
      <PageHeader
        title="Investment ledger"
        description={`${page.value.total} row${page.value.total === 1 ? '' : 's'} · the only source of every holding figure`}
        actions={<NavTabs current="/investments/transactions" />}
      />

      {instrumentOptions.length === 0 || accountOptions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-strong bg-surface-sunken px-6 py-8 text-center text-sm text-ink-muted">
          Add an account and an instrument before recording a transaction.
        </p>
      ) : (
        <Disclosure summary="Record a transaction" defaultOpen={page.value.total === 0}>
          <InvestmentTransactionForm
            action={createInvestmentTransactionAction}
            accounts={accountOptions}
            instruments={instrumentOptions}
            today={ctx.today}
          />
        </Disclosure>
      )}

      {page.value.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-strong bg-surface-sunken px-6 py-8 text-center text-sm text-ink-muted">
          No investment transactions yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className={TABLE}>
            <thead className="bg-surface-sunken">
              <tr>
                <th className={TH}>Date</th>
                <th className={TH}>Kind</th>
                <th className={TH}>Instrument</th>
                <th className={TH}>Account</th>
                <th className={TH_NUM}>Quantity</th>
                <th className={TH_NUM}>Price</th>
                <th className={TH_NUM}>Fees</th>
                <th className={TH_NUM}>Taxes</th>
                <th className={TH_NUM}>Cash</th>
                <th className={TH_NUM} />
              </tr>
            </thead>
            <tbody>
              {page.value.rows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className={`${TD} tabular`}>{format.dateShort(row.tradeDate)}</td>
                  <td className={TD}>{KIND_LABELS[row.kind] ?? row.kind}</td>
                  <td className={TD}>
                    {row.instrumentSymbol ?? <span className="text-ink-faint">Account level</span>}
                    {row.ratioNum !== null ? (
                      <span className="ml-2 text-xs text-ink-faint">
                        {row.ratioNum}:{row.ratioDen}
                      </span>
                    ) : null}
                  </td>
                  <td className={TD}>{row.accountName}</td>
                  <td className={TD_NUM}>
                    {row.quantity === null ? '—' : (Number(row.quantity.units) / 1e8).toString()}
                  </td>
                  <td className={TD_NUM}>
                    {row.price === null ? '—' : (Number(row.price.units) / 1e8).toString()}
                  </td>
                  <td className={TD_NUM}>{row.fees.minor === 0n ? '—' : format.money(row.fees)}</td>
                  <td className={TD_NUM}>{row.taxes.minor === 0n ? '—' : format.money(row.taxes)}</td>
                  <td
                    className={`${TD_NUM} ${row.netAmount.minor < 0n ? 'text-negative' : row.netAmount.minor > 0n ? 'text-positive' : 'text-ink-muted'}`}
                    title={
                      row.currency === row.accountCurrency
                        ? undefined
                        : `${format.money(row.netAmountInstrument)} in ${row.currency}`
                    }
                  >
                    {row.netAmount.minor === 0n ? '—' : format.money(row.netAmount)}
                  </td>
                  <td className={TD_NUM}>
                    <InlineAction
                      action={deleteInvestmentTransactionAction}
                      values={{ id: row.id }}
                      label="Delete"
                      variant="danger"
                      confirm="Delete this row and re-derive the position from the remaining history?"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-ink-faint">
        A row with no cash effect — a split, a bonus, either leg of a transfer — shows{' '}
        <span className="tabular">—</span> rather than a zero, because no cash moved rather than an
        amount of zero having moved. Where an instrument is priced in another currency, the cash
        column is the account&rsquo;s currency and the instrument figure is on hover.
      </p>
    </>
  );
}
