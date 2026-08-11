import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '../../../_components/page-shell';
import { loadMoneyContext } from '../../money/_page-data';
import { portfolio } from '@/server/services';
import { CoverageNote, HoldingRow, NavTabs, TABLE, TD, TD_NUM, TH, TH_NUM } from '../_components';

export const metadata: Metadata = { title: 'Holdings' };

/**
 * The holdings table, including positions sold down to zero.
 *
 * A closed position is retained so its realised P&L is not lost (edge case 18);
 * it is excluded from the overview and from allocation, and shown here greyed so
 * the history remains reachable.
 */
export default async function HoldingsPage() {
  const { ctx, format } = await loadMoneyContext('/investments/holdings');
  const result = await portfolio(ctx, { includeClosed: true });
  if (!result.ok) throw new Error(result.error.message);

  const { summary, holdings } = result.value;
  const open = holdings.filter((h) => h.quantity.units !== 0n);
  const closed = holdings.filter((h) => h.quantity.units === 0n);

  return (
    <>
      <PageHeader
        title="Holdings"
        description="Derived from the ledger by a FIFO lot engine. Never typed in, never patched."
        actions={<NavTabs current="/investments/holdings" />}
      />

      <CoverageNote
        coveragePct={format.percent(summary.coverage, 1)}
        unpriced={summary.unpricedInstruments}
        stale={summary.staleInstruments}
      />

      {open.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-strong bg-surface-sunken px-6 py-8 text-center text-sm text-ink-muted">
          No open holdings. Record a purchase on the{' '}
          <Link href="/investments/transactions" className="underline">
            transactions page
          </Link>
          .
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className={TABLE}>
            <thead className="bg-surface-sunken">
              <tr>
                <th className={TH}>Instrument</th>
                <th className={TH}>Class</th>
                <th className={TH}>Account</th>
                <th className={TH_NUM}>Quantity</th>
                <th className={TH_NUM}>Avg cost</th>
                <th className={TH_NUM}>Invested</th>
                <th className={TH_NUM}>Price</th>
                <th className={TH_NUM}>Value</th>
                <th className={TH_NUM}>Unrealised</th>
                <th className={TH_NUM}>Return</th>
                <th className={TH_NUM}>Weight</th>
              </tr>
            </thead>
            <tbody>
              {open.map((holding) => (
                <HoldingRow key={`${holding.accountId}:${holding.instrument.id}`} holding={holding} format={format} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {closed.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Closed positions</h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-sunken">
                <tr>
                  <th className={TH}>Instrument</th>
                  <th className={TH}>Account</th>
                  <th className={TH_NUM}>Realised P&amp;L</th>
                  <th className={TH_NUM}>Income</th>
                </tr>
              </thead>
              <tbody>
                {closed.map((holding) => (
                  <tr key={`${holding.accountId}:${holding.instrument.id}`} className="border-t border-border">
                    <td className={TD}>
                      <Link href={`/investments/holdings/${holding.instrument.id}`} className="hover:underline">
                        {holding.instrument.symbol}
                      </Link>
                    </td>
                    <td className={TD}>{holding.accountName}</td>
                    <td
                      className={`${TD_NUM} ${holding.realizedPnl.minor < 0n ? 'text-negative' : 'text-positive'}`}
                    >
                      {format.money(holding.realizedPnl)}
                    </td>
                    <td className={TD_NUM}>{format.money(holding.incomeTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-ink-faint">
            A position sold to zero keeps its row so its realised P&amp;L and income survive. It is
            counted in no allocation and in no market value.
          </p>
        </section>
      ) : null}
    </>
  );
}
