import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '../../_components/page-shell';
import { addDays } from '@/lib/date';
import { netWorthChange, netWorthReconciliation } from '@/server/services';
import { BasisNotice, CoverageNotice, Headline, SideTable, TradeDatedNotice } from './_components';
import { loadNetWorthContext } from './_page-data';

export const metadata: Metadata = { title: 'Net Worth at Cost' };

/**
 * **Net Worth at Cost** — the current figure, both sides of the sheet, and what
 * each is made of.
 *
 * The page renders a `NetWorthResult`. It computes nothing: no subtotal, no
 * percentage, no currency conversion.
 */
export default async function NetWorthPage() {
  const { ctx, format } = await loadNetWorthContext('/net-worth');

  const computed = await netWorthReconciliation(ctx);
  if (!computed.ok) throw new Error(computed.error.message);
  const { result, reconciliation } = computed.value;

  // A 30-day comparison, for the delta beside the headline. The bridge is the
  // page that explains it; here it is one number.
  const monthAgo = addDays(ctx.today, -30);
  const change = await netWorthChange(ctx, monthAgo, ctx.today);
  const delta = change.ok ? change.value.delta : null;

  return (
    <>
      <PageHeader
        title="Net Worth at Cost"
        description="Every source counted exactly once, as of today."
        actions={
          <nav className="flex items-center gap-3 text-sm text-ink-muted">
            <Link href="/net-worth/history" className="hover:text-ink">
              History
            </Link>
            <Link href="/net-worth/change" className="hover:text-ink">
              What changed
            </Link>
            <Link href="/net-worth/assets" className="hover:text-ink">
              Assets
            </Link>
            <Link href="/net-worth/liabilities" className="hover:text-ink">
              Liabilities
            </Link>
          </nav>
        }
      />

      <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
        <Headline
          label="Net worth at cost"
          amount={format.money(result.netWorth)}
          sublabel={`as of ${format.date(result.asOf)}`}
          tone={result.netWorth.minor < 0n ? 'negative' : 'neutral'}
        />
        <Headline label="Assets" amount={format.money(result.assets)} />
        <Headline label="Liabilities" amount={format.money(result.liabilities)} />
        {delta === null ? null : (
          <Headline
            label="Last 30 days"
            amount={format.money(delta)}
            sublabel={`since ${format.dateShort(monthAgo)}`}
            tone={delta.minor < 0n ? 'negative' : delta.minor > 0n ? 'positive' : 'neutral'}
          />
        )}
      </div>

      <BasisNotice />

      <CoverageNotice
        excluded={result.excluded}
        assetCoverage={format.percent(result.assetCoverage)}
        liabilityCoverage={format.percent(result.liabilityCoverage)}
        format={format}
      />

      <div className="grid gap-8 lg:grid-cols-2">
        <SideTable
          heading="Assets"
          side="asset"
          groups={result.groups}
          contributions={result.contributions}
          total={format.money(result.assets)}
          format={format}
        />
        <SideTable
          heading="Liabilities"
          side="liability"
          groups={result.groups}
          contributions={result.contributions}
          total={format.money(result.liabilities)}
          format={format}
        />
      </div>

      <TradeDatedNotice />

      {/*
        The reconciliation is recomputed by a second, independent path and
        asserted equal exactly (I-22). Showing that it balanced is the point: a
        total that agrees with itself by construction proves nothing.
      */}
      <p className="text-xs text-ink-faint">
        {reconciliation.balances
          ? `Reconciled: ${result.contributions.length} sources, checked by a second independent sum.`
          : `Reconciliation residual ${format.money(reconciliation.residual)} — this is a defect, not a rounding artefact.`}
      </p>
    </>
  );
}
