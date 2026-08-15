import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '../../../_components/page-shell';
import { Disclosure, InlineAction } from '../../money/_components';
import { getManualAsset, listCurrencies, listManualAssets } from '@/server/services';
import { AssetForm, DisposeForm, RevalueForm } from '../_forms';
import { createAssetAction, deleteAssetAction, disposeAssetAction, revalueAssetAction } from '../actions';
import { loadNetWorthContext } from '../_page-data';

export const metadata: Metadata = { title: 'Manual assets' };

const KIND_LABELS: Record<string, string> = {
  property: 'Property',
  vehicle: 'Vehicle',
  gold_physical: 'Physical gold',
  collectible: 'Collectible',
  receivable: 'Receivable',
  other: 'Other',
};

/**
 * Manual assets — anything of value that is not an account balance and not an
 * instrument.
 *
 * **A valuation is a time series, not a field.** Revaluing inserts a row; the
 * value in force at a date is the most recent one on or before it, which is what
 * keeps last year's net worth unchanged when this year's estimate is updated.
 */
export default async function ManualAssetsPage() {
  const { ctx, format } = await loadNetWorthContext('/net-worth/assets');

  const [assets, currencies] = await Promise.all([
    listManualAssets(ctx, { includeDisposed: true }),
    listCurrencies(ctx),
  ]);

  const held = assets.filter((a) => a.disposedOn === null || a.disposedOn > ctx.today);
  const disposed = assets.filter((a) => a.disposedOn !== null && a.disposedOn <= ctx.today);

  const detail = await Promise.all(held.map((a) => getManualAsset(ctx, a.id)));

  return (
    <>
      <PageHeader
        title="Manual assets"
        description="Property, vehicles, physical gold, collectibles, receivables — valued by you, dated by you."
        actions={
          <Link href="/net-worth" className="text-sm text-ink-muted hover:text-ink">
            ← Net worth
          </Link>
        }
      />

      <Disclosure summary="Add an asset" defaultOpen={assets.length === 0}>
        <AssetForm
          action={createAssetAction}
          currencies={currencies.map((c) => c.code)}
          baseCurrency={ctx.base}
          today={ctx.today}
        />
      </Disclosure>

      {held.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-ink-muted">
          No manual assets yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {held.map((asset, index) => {
            const loaded = detail[index];
            const valuations = loaded?.ok ? loaded.value.valuations : [];
            return (
              <li key={asset.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <span className="font-medium">{asset.name}</span>
                    <span className="ml-2 text-xs text-ink-faint">
                      {KIND_LABELS[asset.kind] ?? asset.kind} · {asset.currency}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="tabular-nums">
                      {asset.currentValue === null ? '—' : format.money(asset.currentValue)}
                    </span>
                    {asset.currentValueOn ? (
                      <span className="ml-2 text-xs text-ink-faint">
                        as of {format.dateShort(asset.currentValueOn)}
                      </span>
                    ) : (
                      <span className="ml-2 text-xs text-warning">not yet valued</span>
                    )}
                  </div>
                </div>

                {valuations.length > 1 ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-ink-muted">
                      {valuations.length} valuations
                    </summary>
                    <table className="mt-2 w-full text-xs">
                      <tbody className="divide-y divide-border">
                        {valuations.map((v) => (
                          <tr key={v.id}>
                            <td className="py-1">{format.date(v.asOf)}</td>
                            <td className="py-1 text-right tabular-nums">{format.money(v.value)}</td>
                            <td className="py-1 pl-3 text-ink-faint">{v.note ?? ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                ) : null}

                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <Disclosure summary="Record a new valuation">
                    <RevalueForm action={revalueAssetAction} assetId={asset.id} today={ctx.today} />
                  </Disclosure>
                  <Disclosure summary="Dispose">
                    <DisposeForm action={disposeAssetAction} assetId={asset.id} today={ctx.today} />
                  </Disclosure>
                </div>

                {asset.valuationCount <= 1 ? (
                  <div className="mt-2">
                    <InlineAction
                      action={deleteAssetAction}
                      values={{ assetId: asset.id }}
                      label="Delete"
                      confirm={`Delete ${asset.name}?`}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {disposed.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Disposed</h2>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {disposed.map((asset) => (
              <li key={asset.id} className="flex items-baseline justify-between px-3 py-2 text-sm">
                <span>{asset.name}</span>
                <span className="text-xs text-ink-faint">
                  disposed {format.date(asset.disposedOn!)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-faint">
            A disposed asset stops counting from its disposal date and stays in every earlier
            figure. The date is what the calculation reads — never a flag.
          </p>
        </section>
      ) : null}
    </>
  );
}
