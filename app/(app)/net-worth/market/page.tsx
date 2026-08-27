import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '../../../_components/page-shell';
import { netWorthComparison } from '@/server/services';
import {
  BasisComparison,
  BasisNotice,
  CoverageNotice,
  Headline,
  MarketStatusNotice,
  RestatementTable,
  SideTable,
  TradeDatedNotice,
} from '../_components';
import { loadNetWorthContext } from '../_page-data';

export const metadata: Metadata = { title: 'Net Worth at Market Value' };

/**
 * **Net Worth at Market Value** — the explicit alternate view
 * ([ADR-32](../../../../docs/DECISIONS.md#adr-32--the-default-valuation-basis-remains-cost-market-is-an-explicit-alternate-view)).
 *
 * Reached by asking for it, never shown unbidden, and **labelled in the
 * headline** so it cannot be mistaken for the cost figure the user has been
 * watching. Both bases are first-class; neither replaces the other.
 *
 * The page renders a `NetWorthResult` and a `Restatement`. It computes nothing:
 * no subtotal, no percentage, no currency conversion — a subtotal computed here
 * would be the second implementation
 * [FINANCIAL-DOMAIN.md §10.5](../../../../docs/FINANCIAL-DOMAIN.md#105-single-implementation-per-concept)
 * exists to forbid.
 */
export default async function NetWorthMarketPage() {
  const { ctx, format } = await loadNetWorthContext('/net-worth/market');

  const computed = await netWorthComparison(ctx);
  if (!computed.ok) throw new Error(computed.error.message);
  const { market: result, restatement, reconciliation } = computed.value;
  const status = result.market;

  // `unavailable` is narrow and deliberate: holdings exist and not one could be
  // priced. The headline is WITHHELD rather than shown as a smaller number that
  // looks like a valuation, and the cost figure is offered by name.
  const withheld = status?.status === 'unavailable';

  return (
    <>
      <PageHeader
        title="Net Worth at Market Value"
        description="Holdings valued at the price in force today. Cash, property and debts are unchanged."
        actions={
          <nav className="flex items-center gap-3 text-sm text-ink-muted">
            <Link href="/net-worth" className="hover:text-ink">
              At cost
            </Link>
            <Link href="/net-worth/history" className="hover:text-ink">
              History
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
          label="Net worth at market value"
          amount={withheld ? '—' : format.money(result.netWorth)}
          sublabel={`as of ${format.date(result.asOf)}`}
          tone={result.netWorth.minor < 0n ? 'negative' : 'neutral'}
        />
        <Headline label="Assets" amount={withheld ? '—' : format.money(result.assets)} />
        <Headline label="Liabilities" amount={format.money(result.liabilities)} />
      </div>

      <BasisComparison
        basis="market"
        restatement={restatement}
        status={status}
        format={format}
      />

      {status === null ? null : <MarketStatusNotice status={status} format={format} />}

      <BasisNotice basis="market" />

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
          basis="market"
          groups={result.groups}
          contributions={result.contributions}
          total={format.money(result.assets)}
          format={format}
        />
        <SideTable
          heading="Liabilities"
          side="liability"
          basis="market"
          groups={result.groups}
          contributions={result.contributions}
          total={format.money(result.liabilities)}
          format={format}
        />
      </div>

      <RestatementTable restatement={restatement} format={format} />

      <TradeDatedNotice />

      <p className="text-xs text-ink-faint">
        {reconciliation.balances
          ? `Reconciled: ${result.contributions.length} sources, checked by a second independent sum.`
          : `Reconciliation residual ${format.money(reconciliation.residual)} — this is a defect, not a rounding artefact.`}
      </p>
    </>
  );
}
