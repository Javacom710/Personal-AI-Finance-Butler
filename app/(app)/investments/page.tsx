import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader, ProportionBar } from '../../_components/page-shell';
import { loadMoneyContext } from '../money/_page-data';
import {
  assetAllocation,
  listInstruments,
  portfolio,
  portfolioConcentration,
} from '@/server/services';
import { CoverageNote, Figure, HoldingRow, NavTabs, TABLE, TD, TD_NUM, TH, TH_NUM } from './_components';

export const metadata: Metadata = { title: 'Investments' };

/**
 * The investment overview.
 *
 * Every figure comes from `src/server/domain/` — the same functions the AI tools
 * will call in Phase 7, which is why an AI answer cannot disagree with this
 * screen (FINANCIAL-DOMAIN.md §10.5). This page performs no arithmetic.
 */
export default async function InvestmentsPage() {
  const { ctx, format } = await loadMoneyContext('/investments');

  const [result, instruments] = await Promise.all([portfolio(ctx), listInstruments(ctx)]);

  if (!result.ok) throw new Error(result.error.message);
  const { summary, holdings } = result.value;

  if (instruments.length === 0) {
    return (
      <>
        <PageHeader
          title="Investments"
          description="Holdings are derived from the ledger by a FIFO lot engine, never typed in."
          actions={<NavTabs current="/investments" />}
        />
        <div className="rounded-lg border border-dashed border-border-strong bg-surface-sunken px-6 py-10 text-center">
          <h2 className="text-sm font-medium">Add an instrument to begin</h2>
          <p className="mx-auto mt-2 max-w-prose text-sm text-ink-muted">
            An instrument describes <em>what</em> is held; a transaction records <em>how much</em>.
            Cost basis, realised P&amp;L and lot history follow from the ledger alone and need no
            prices, which is why they exist before market data does.
          </p>
          <Link
            href="/investments/instruments"
            className="mt-4 inline-block rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
          >
            Add your first instrument
          </Link>
        </div>
      </>
    );
  }

  const [byClass, concentration] = await Promise.all([
    assetAllocation(ctx, 'asset_class'),
    portfolioConcentration(ctx),
  ]);

  const open = holdings.filter((h) => h.quantity.units !== 0n);
  // Unpriced holdings sort to the bottom with an explicit marker, rather than
  // sorting as if they were worth nothing.
  const ordered = [...open].sort((a, b) => {
    if (a.baseMarketValue === null && b.baseMarketValue === null) return 0;
    if (a.baseMarketValue === null) return 1;
    if (b.baseMarketValue === null) return -1;
    return a.baseMarketValue.minor > b.baseMarketValue.minor ? -1 : 1;
  });

  return (
    <>
      <PageHeader
        title="Investments"
        description={`As of ${format.date(summary.asOf)} · ${open.length} holding${open.length === 1 ? '' : 's'}`}
        actions={<NavTabs current="/investments" />}
      />

      <section className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-surface px-4 py-3 sm:grid-cols-3 lg:grid-cols-6">
        <Figure
          label="Market value"
          value={summary.unrealizedPnl === null ? '—' : format.money(summary.marketValue)}
          hint={summary.unrealizedPnl === null ? 'No holding could be priced' : undefined}
        />
        <Figure label="Invested" value={format.money(summary.investedCapital)} hint="Capital currently at risk" />
        <Figure
          label="Unrealised"
          value={summary.unrealizedPnl === null ? '—' : format.money(summary.unrealizedPnl)}
          tone={
            summary.unrealizedPnl === null
              ? undefined
              : summary.unrealizedPnl.minor < 0n
                ? 'negative'
                : 'positive'
          }
        />
        <Figure
          label="Realised"
          value={format.money(summary.realizedPnl)}
          tone={summary.realizedPnl.minor < 0n ? 'negative' : 'positive'}
        />
        <Figure
          label="XIRR"
          value={format.metricPercent(summary.xirr, 2)}
          hint={format.reason(summary.xirr) ?? 'Money-weighted, actual/365'}
        />
        <Figure
          label="Total return"
          value={format.metricPercent(summary.totalReturnPct, 2)}
          hint={format.reason(summary.totalReturnPct) ?? 'On capital deployed'}
        />
      </section>

      <CoverageNote
        coveragePct={format.percent(summary.coverage, 1)}
        unpriced={summary.unpricedInstruments}
        stale={summary.staleInstruments}
      />

      {ordered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-strong bg-surface-sunken px-6 py-8 text-center text-sm text-ink-muted">
          No open holdings. Record a purchase on the{' '}
          <Link href="/investments/transactions" className="underline">
            transactions page
          </Link>
          .
        </p>
      ) : (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Holdings</h2>
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
                {ordered.map((holding) => (
                  <HoldingRow key={`${holding.accountId}:${holding.instrument.id}`} holding={holding} format={format} />
                ))}
              </tbody>
              <tfoot className="border-t border-border-strong bg-surface-sunken">
                <tr>
                  <td className={TD} colSpan={5}>
                    <span className="text-xs font-medium">Priced total</span>
                  </td>
                  <td className={TD_NUM}>{format.money(summary.investedCapital)}</td>
                  <td className={TD_NUM} />
                  <td className={TD_NUM}>{format.money(summary.marketValue)}</td>
                  <td className={TD_NUM}>
                    {summary.unrealizedPnl === null ? '—' : format.money(summary.unrealizedPnl)}
                  </td>
                  <td className={TD_NUM} colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">By asset class</h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <tbody>
                {byClass.slices.length === 0 ? (
                  <tr>
                    <td className={`${TD} text-ink-muted`}>Nothing priced yet.</td>
                  </tr>
                ) : (
                  byClass.slices.map((slice) => (
                    <tr key={slice.key} className="border-b border-border last:border-0">
                      <td className={TD}>{slice.label}</td>
                      <td className={`${TD} w-1/2`}>
                        <ProportionBar
                          fraction={Number(slice.weightPct.value?.value ?? 0n) / 1e10}
                          label={`${slice.label}: ${format.metricPercent(slice.weightPct, 1)} of priced value`}
                        />
                      </td>
                      <td className={TD_NUM}>{format.metricPercent(slice.weightPct, 1)}</td>
                      <td className={TD_NUM}>{format.money(slice.marketValue)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {byClass.unpricedCount > 0 ? (
            <p className="text-xs text-ink-faint">
              {byClass.unpricedCount} unpriced holding{byClass.unpricedCount === 1 ? '' : 's'} worth{' '}
              {format.money(byClass.unpricedValue)} at cost appear in no slice.
            </p>
          ) : null}
        </div>

        <div className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Concentration</h2>
          <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
            <Figure label="Largest holding" value={format.metricPercent(concentration.top1, 1)} />
            <Figure label="Top 3" value={format.metricPercent(concentration.top3, 1)} />
            <Figure label="Above 10%" value={`${concentration.above10Pct} of ${concentration.holdingCount}`} />
            <Figure
              label="HHI"
              value={format.metricPercent(concentration.hhi, 3)}
              hint="Herfindahl–Hirschman index over instrument weights. 100% is a single holding."
            />
          </dl>
          <p className="text-xs text-ink-faint">
            Computed deterministically from the priced holdings, not by a model — the AI&rsquo;s job
            is to explain a concentration figure, never to produce one.
          </p>
        </div>
      </section>
    </>
  );
}
