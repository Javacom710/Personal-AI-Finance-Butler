import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';

import { PageHeader } from '../../../../_components/page-shell';
import { loadMoneyContext } from '../../../money/_page-data';
import {
  getInstrument,
  listInvestmentTransactions,
  lotsFor,
  portfolio,
} from '@/server/services';
import { Figure, NavTabs, PriceDot, TABLE, TD, TD_NUM, TH, TH_NUM } from '../../_components';

export const metadata: Metadata = { title: 'Holding' };

/**
 * One instrument in detail: its lots with holding periods, its ledger, and the
 * realised/unrealised split.
 *
 * The **lot table** is the reason this page exists. It is what makes a cost
 * basis explicable — every figure on the holdings row traces to a row here, and
 * every row here traces to a transaction.
 */
export default async function HoldingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, format } = await loadMoneyContext(`/investments/holdings/${id}`);

  const instrument = await getInstrument(ctx, id);
  if (!instrument.ok) notFound();

  const [result, lots, ledger] = await Promise.all([
    portfolio(ctx, { instrumentId: id, includeClosed: true }),
    lotsFor(ctx, id, { includeClosed: true }),
    listInvestmentTransactions(ctx, { instrumentId: id, limit: 100 }),
  ]);

  if (!result.ok) throw new Error(result.error.message);
  if (!ledger.ok) throw new Error(ledger.error.message);

  const holding = result.value.holdings[0];
  const summary = result.value.summary;

  return (
    <>
      <PageHeader
        title={`${instrument.value.symbol}`}
        description={`${instrument.value.name} · ${instrument.value.assetClass.replace(/_/g, ' ')} · ${instrument.value.currency}${
          instrument.value.exchange === null ? '' : ` · ${instrument.value.exchange}`
        }`}
        actions={<NavTabs current="/investments" />}
      />

      <section className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-surface px-4 py-3 sm:grid-cols-3 lg:grid-cols-6">
        <Figure
          label="Quantity"
          value={holding === undefined ? '0' : (Number(holding.quantity.units) / 1e8).toString()}
        />
        <Figure label="Invested" value={format.money(summary.investedCapital)} />
        <Figure
          label="Avg cost"
          value={
            holding?.avgCost == null ? '—' : (Number(holding.avgCost.units) / 1e8).toFixed(4)
          }
          hint="Derived from the surviving lots, never carried forward"
        />
        <Figure
          label="Market value"
          value={holding?.marketValue == null ? '—' : format.money(holding.marketValue)}
          hint={holding === undefined ? undefined : format.reason(holding.returnPct)}
        />
        <Figure
          label="Unrealised"
          value={holding?.unrealizedPnl == null ? '—' : format.money(holding.unrealizedPnl)}
          tone={
            holding?.unrealizedPnl == null
              ? undefined
              : holding.unrealizedPnl.minor < 0n
                ? 'negative'
                : 'positive'
          }
        />
        <Figure
          label="Realised"
          value={format.money(summary.realizedPnl)}
          tone={summary.realizedPnl.minor < 0n ? 'negative' : 'positive'}
        />
      </section>

      {holding === undefined ? null : (
        <p className="text-xs text-ink-faint">
          Price <PriceDot price={holding.price} /> · income {format.money(holding.incomeTotal)} gross,
          fees {format.money(holding.feesTotal)}, tax withheld {format.money(holding.taxesTotal)}.
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Tax lots</h2>
        {lots.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border-strong bg-surface-sunken px-6 py-8 text-center text-sm text-ink-muted">
            No lots — nothing has been acquired yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className={TABLE}>
              <thead className="bg-surface-sunken">
                <tr>
                  <th className={TH}>Acquired</th>
                  <th className={TH}>Opened</th>
                  <th className={TH_NUM}>Original</th>
                  <th className={TH_NUM}>Remaining</th>
                  <th className={TH_NUM}>Cost</th>
                  <th className={TH_NUM}>Remaining cost</th>
                  <th className={TH_NUM}>Held</th>
                </tr>
              </thead>
              <tbody>
                {lots.map((lot) => (
                  <tr key={lot.id} className={`border-t border-border ${lot.remainingQuantity.units === 0n ? 'text-ink-faint' : ''}`}>
                    <td className={`${TD} tabular`}>{format.dateShort(lot.acquiredOn)}</td>
                    <td className={`${TD} tabular`}>
                      {lot.openedOn === lot.acquiredOn ? (
                        <span className="text-ink-faint">same</span>
                      ) : (
                        <span title="Opened by a transfer in; the acquisition date was carried across">
                          {format.dateShort(lot.openedOn)}
                        </span>
                      )}
                    </td>
                    <td className={TD_NUM}>{(Number(lot.originalQuantity.units) / 1e8).toString()}</td>
                    <td className={TD_NUM}>{(Number(lot.remainingQuantity.units) / 1e8).toString()}</td>
                    <td className={TD_NUM}>{format.money(lot.costTotal)}</td>
                    <td className={TD_NUM}>{format.money(lot.remainingCost)}</td>
                    <td className={TD_NUM}>{lot.holdingDays}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-ink-faint">
          A fully consumed lot is retained at zero rather than deleted: capital deployed sums the
          cost of every lot ever opened, and the disposals that closed it still reference it. A lot
          opened by a transfer keeps its <em>original</em> acquisition date, so a holding period is
          not reset by moving shares between your own accounts.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Ledger</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className={TABLE}>
            <thead className="bg-surface-sunken">
              <tr>
                <th className={TH}>Date</th>
                <th className={TH}>Kind</th>
                <th className={TH}>Account</th>
                <th className={TH_NUM}>Quantity</th>
                <th className={TH_NUM}>Price</th>
                <th className={TH_NUM}>Cash</th>
              </tr>
            </thead>
            <tbody>
              {ledger.value.rows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className={`${TD} tabular`}>{format.dateShort(row.tradeDate)}</td>
                  <td className={TD}>{row.kind.replace(/_/g, ' ')}</td>
                  <td className={TD}>{row.accountName}</td>
                  <td className={TD_NUM}>
                    {row.quantity === null ? '—' : (Number(row.quantity.units) / 1e8).toString()}
                  </td>
                  <td className={TD_NUM}>
                    {row.price === null ? '—' : (Number(row.price.units) / 1e8).toString()}
                  </td>
                  <td className={TD_NUM}>{row.netAmount.minor === 0n ? '—' : format.money(row.netAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Link href="/investments/transactions" className="text-xs underline">
          Record a transaction
        </Link>
      </section>
    </>
  );
}
