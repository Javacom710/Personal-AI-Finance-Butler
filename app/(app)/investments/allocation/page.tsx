import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader, ProportionBar } from '../../../_components/page-shell';
import { loadMoneyContext } from '../../money/_page-data';
import { assetAllocation, type AllocationDimension } from '@/server/services';
import { NavTabs, TABLE, TD, TD_NUM, TH, TH_NUM } from '../_components';

export const metadata: Metadata = { title: 'Allocation' };

const DIMENSIONS: readonly [AllocationDimension, string][] = [
  ['asset_class', 'Asset class'],
  ['instrument', 'Instrument'],
  ['account', 'Account'],
  ['currency', 'Currency'],
  ['country', 'Country'],
];

export default async function AllocationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ctx, format } = await loadMoneyContext('/investments/allocation');
  const params = await searchParams;
  const requested = typeof params['by'] === 'string' ? params['by'] : 'asset_class';
  const dimension: AllocationDimension = DIMENSIONS.some(([key]) => key === requested)
    ? (requested as AllocationDimension)
    : 'asset_class';

  const allocation = await assetAllocation(ctx, dimension);

  return (
    <>
      <PageHeader
        title="Allocation"
        description="Weights are over priced market value. Anything unpriced is named, not folded in."
        actions={<NavTabs current="/investments/allocation" />}
      />

      <nav className="flex flex-wrap gap-2 text-sm">
        {DIMENSIONS.map(([key, label]) => (
          <Link
            key={key}
            href={`/investments/allocation?by=${key}`}
            aria-current={key === dimension ? 'page' : undefined}
            className={
              key === dimension
                ? 'rounded-md border border-border-strong bg-surface-sunken px-2.5 py-1 font-medium'
                : 'rounded-md border border-border px-2.5 py-1 text-ink-muted hover:text-ink'
            }
          >
            {label}
          </Link>
        ))}
      </nav>

      {allocation.slices.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-strong bg-surface-sunken px-6 py-8 text-center text-sm text-ink-muted">
          Nothing is priced yet, so there is no allocation to show. Record a price on the{' '}
          <Link href="/investments/instruments" className="underline">
            instruments page
          </Link>
          .
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className={TABLE}>
            <thead className="bg-surface-sunken">
              <tr>
                <th className={TH}>Slice</th>
                <th className={TH}>Share</th>
                <th className={TH_NUM}>Weight</th>
                <th className={TH_NUM}>Value</th>
                <th className={TH_NUM}>Cost</th>
                <th className={TH_NUM}>Unrealised</th>
                <th className={TH_NUM}>Holdings</th>
              </tr>
            </thead>
            <tbody>
              {allocation.slices.map((slice) => (
                <tr key={slice.key} className="border-t border-border">
                  <td className={`${TD} font-medium`}>{slice.label}</td>
                  <td className={`${TD} w-1/3`}>
                    <ProportionBar
                      fraction={Number(slice.weightPct.value?.value ?? 0n) / 1e10}
                      label={`${slice.label}: ${format.metricPercent(slice.weightPct, 1)} of priced value`}
                    />
                  </td>
                  <td className={TD_NUM}>{format.metricPercent(slice.weightPct, 1)}</td>
                  <td className={TD_NUM}>{format.money(slice.marketValue)}</td>
                  <td className={TD_NUM}>{format.money(slice.costBasis)}</td>
                  <td
                    className={`${TD_NUM} ${slice.unrealizedPnl.minor < 0n ? 'text-negative' : 'text-positive'}`}
                  >
                    {format.money(slice.unrealizedPnl)}
                  </td>
                  <td className={TD_NUM}>{slice.holdingCount}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-border-strong bg-surface-sunken">
              <tr>
                <td className={TD} colSpan={3}>
                  <span className="text-xs font-medium">Priced total</span>
                </td>
                <td className={TD_NUM}>{format.money(allocation.total)}</td>
                <td className={TD_NUM} colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {allocation.unpricedCount > 0 ? (
        <p className="rounded-md border border-border bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
          {allocation.unpricedCount} holding{allocation.unpricedCount === 1 ? '' : 's'} could not be
          priced and appear{allocation.unpricedCount === 1 ? 's' : ''} in no slice above. Their cost
          basis is {format.money(allocation.unpricedValue)} — shown here so the weights are read as a
          share of what <em>is</em> priced, not of the whole portfolio.
        </p>
      ) : null}
    </>
  );
}
