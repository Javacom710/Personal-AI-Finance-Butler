import type { Metadata } from 'next';

import { PageHeader } from '../../../_components/page-shell';
import { InlineAction } from '../../money/_components';
import { loadMoneyContext } from '../../money/_page-data';
import { portfolio, realizedDisposals } from '@/server/services';
import { rebuildPositionsAction } from '../actions';
import { NavTabs, TABLE, TD, TD_NUM, TH, TH_NUM } from '../_components';

export const metadata: Metadata = { title: 'Performance' };

/**
 * Performance — the metrics table and realised-P&L history.
 *
 * XIRR is the headline: it is the only figure that handles both the size and
 * the timing of every flow. `totalReturnPct` sits beside it, labelled *on
 * capital deployed*, because that denominator accumulates across round trips and
 * a reader who assumes otherwise will misread it.
 *
 * TWR reports `insufficient_price_history` for every equity and ETF until
 * Phase 6 populates `instrument_prices`. That is the documented launch
 * behaviour, shown as its reason rather than as a figure from partial data.
 */
export default async function PerformancePage() {
  const { ctx, format } = await loadMoneyContext('/investments/performance');

  const [result, disposals] = await Promise.all([portfolio(ctx), realizedDisposals(ctx, { limit: 50 })]);
  if (!result.ok) throw new Error(result.error.message);
  const { summary } = result.value;

  const metrics: readonly [string, string, string | undefined][] = [
    ['Invested capital', format.money(summary.investedCapital), 'Σ cost basis over open positions — capital currently at risk'],
    ['Capital deployed', format.money(summary.costDeployed), 'Σ cost of every lot ever opened, including closed ones'],
    ['Market value', summary.unrealizedPnl === null ? '—' : format.money(summary.marketValue), 'Priced holdings only'],
    [
      'Unrealised P&L',
      summary.unrealizedPnl === null ? '—' : format.money(summary.unrealizedPnl),
      summary.unrealizedPnl === null ? 'No holding could be priced' : 'Market value − invested capital',
    ],
    ['Realised P&L', format.money(summary.realizedPnl), 'Σ base realised P&L across every disposal'],
    ['Dividends', format.money(summary.dividends), 'Gross declared, before withholding'],
    ['Interest', format.money(summary.interest), 'Gross declared'],
    ['Fees', format.money(summary.fees), 'Portfolio-level charges and income collection fees. Trade fees are inside cost basis and realised P&L, never here.'],
    ['Taxes', format.money(summary.taxes), 'Withholding on income, plus standalone tax rows'],
    [
      'Total return',
      summary.totalReturn === null ? '—' : format.money(summary.totalReturn),
      'unrealised + realised + income − fees − taxes',
    ],
    [
      'Total return %',
      format.metricPercent(summary.totalReturnPct, 2),
      format.reason(summary.totalReturnPct) ?? 'On capital deployed. Not annualised.',
    ],
    [
      'Unrealised return %',
      format.metricPercent(summary.unrealizedReturnPct, 2),
      format.reason(summary.unrealizedReturnPct) ?? 'On capital currently at risk',
    ],
    ['XIRR', format.metricPercent(summary.xirr, 2), format.reason(summary.xirr) ?? 'Money-weighted, actual/365'],
    [
      'Time-weighted return',
      format.metricPercent(summary.twr, 2),
      format.reason(summary.twr) ?? 'Chain-linked, annualised over a year or more',
    ],
    ['Coverage', format.percent(summary.coverage, 1), 'Share of cost basis that could be priced'],
  ];

  return (
    <>
      <PageHeader
        title="Performance"
        description={`As of ${format.date(summary.asOf)}`}
        actions={<NavTabs current="/investments/performance" />}
      />

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Metrics</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <tbody>
              {metrics.map(([label, value, hint]) => (
                <tr key={label} className="border-b border-border last:border-0">
                  <td className={`${TD} w-1/3`}>{label}</td>
                  <td className={`${TD_NUM} w-1/6 font-medium`}>{value}</td>
                  <td className={`${TD} text-xs text-ink-faint`}>{hint}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Realised disposals</h2>
        {disposals.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border-strong bg-surface-sunken px-6 py-8 text-center text-sm text-ink-muted">
            Nothing has been sold yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className={TABLE}>
              <thead className="bg-surface-sunken">
                <tr>
                  <th className={TH}>Closed</th>
                  <th className={TH}>Instrument</th>
                  <th className={TH_NUM}>Quantity</th>
                  <th className={TH_NUM}>Proceeds</th>
                  <th className={TH_NUM}>Cost</th>
                  <th className={TH_NUM}>Realised</th>
                  <th className={TH_NUM}>Price part</th>
                  <th className={TH_NUM}>FX part</th>
                  <th className={TH_NUM}>Held</th>
                </tr>
              </thead>
              <tbody>
                {disposals.map((d) => (
                  <tr key={d.id} className="border-t border-border">
                    <td className={`${TD} tabular`}>{format.dateShort(d.closedOn)}</td>
                    <td className={TD}>{d.instrumentSymbol}</td>
                    <td className={TD_NUM}>{(Number(d.quantity.units) / 1e8).toString()}</td>
                    <td className={TD_NUM}>{format.money(d.proceeds)}</td>
                    <td className={TD_NUM}>{format.money(d.costConsumed)}</td>
                    <td className={`${TD_NUM} ${d.realizedPnl.minor < 0n ? 'text-negative' : 'text-positive'}`}>
                      {format.money(d.realizedPnl)}
                    </td>
                    <td className={TD_NUM}>{format.money(d.basePriceComponent)}</td>
                    <td className={TD_NUM}>{format.money(d.baseFxComponent)}</td>
                    <td className={TD_NUM} title="Days from the original acquisition, carried across any transfer">
                      {d.holdingDays}d
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-ink-faint">
          The price and FX parts are in {format.base} and sum to the base-currency realised figure by
          construction: the FX component is stored and the price component is derived as the
          difference, so the two cannot fail to add up.
        </p>
      </section>

      <section className="space-y-2 rounded-lg border border-border bg-surface px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Derived state</h2>
        <p className="text-xs text-ink-muted">
          Lots, disposals and positions are a rebuildable cache of a ledger replay, not records. They
          are re-derived inside the transaction of every mutation, so they cannot drift — this button
          exists for reassurance and after a restore, not because anything is expected to be stale.
        </p>
        <InlineAction action={rebuildPositionsAction} values={{}} label="Rebuild from the ledger" />
      </section>
    </>
  );
}
