import Link from 'next/link';

import type { Formatter } from '@/server/services';
import type { HoldingView, PriceResult } from '@/server/services';

/**
 * The investment area's presentational pieces.
 *
 * Server components: they render figures the engine already computed and do no
 * arithmetic of their own. The one thing they must get right is **not rendering
 * a `null` as a zero** — `—` with the reason on hover, per FINANCIAL-DOMAIN.md
 * §10.3, because "we cannot say" and "it did not change" are different financial
 * statements.
 */

export const TABLE = 'w-full min-w-[48rem] text-sm';
export const TH = 'px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-ink-faint';
export const TH_NUM = `${TH} text-right`;
export const TD = 'px-3 py-2 align-middle';
export const TD_NUM = `${TD} text-right tabular`;

export function NavTabs({ current }: { current: string }) {
  const tabs = [
    ['Overview', '/investments'],
    ['Holdings', '/investments/holdings'],
    ['Transactions', '/investments/transactions'],
    ['Allocation', '/investments/allocation'],
    ['Performance', '/investments/performance'],
    ['Instruments', '/investments/instruments'],
  ] as const;

  return (
    <nav className="flex flex-wrap gap-2 text-sm">
      {tabs.map(([label, href]) => (
        <Link
          key={href}
          href={href}
          aria-current={href === current ? 'page' : undefined}
          className={
            href === current
              ? 'rounded-md bg-accent px-2.5 py-1 font-medium text-accent-ink'
              : 'rounded-md border border-border px-2.5 py-1 text-ink-muted hover:text-ink'
          }
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * A price's provenance, as a dot plus a title.
 *
 * A stale price is **used** and marked, never withheld: refusing to value a
 * holding because the market was closed for a long weekend would blank the
 * portfolio for no gain in accuracy.
 */
export function PriceDot({ price }: { price: PriceResult }) {
  const [tone, title] =
    price.status === 'missing'
      ? ['bg-ink-faint', `No price — ${price.reason.replace(/_/g, ' ')}`]
      : price.status === 'stale'
        ? ['bg-warning', `Stale — ${Math.round(price.ageHours)}h old, from ${price.source}`]
        : price.status === 'cached'
          ? ['bg-positive', `Cached — ${Math.round(price.ageHours)}h old, from ${price.source}`]
          : ['bg-positive', `Live, from ${price.source}`];

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block size-1.5 rounded-full ${tone}`} title={title} aria-hidden="true" />
      <span className="sr-only">{title}</span>
    </span>
  );
}

/**
 * The coverage note.
 *
 * A portfolio value that silently omits two holdings is a worse answer than one
 * that says so (FINANCIAL-DOMAIN.md §10.4), so this renders whenever anything
 * was left out — and renders nothing when nothing was.
 */
export function CoverageNote({
  coveragePct,
  unpriced,
  stale,
}: {
  coveragePct: string;
  unpriced: readonly { readonly symbol: string }[];
  stale: readonly { readonly symbol: string }[];
}) {
  if (unpriced.length === 0 && stale.length === 0) return null;

  return (
    <p className="rounded-md border border-border bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
      {unpriced.length > 0 ? (
        <>
          <strong className="font-medium text-ink">{coveragePct} of cost basis priced.</strong>{' '}
          {unpriced.length} holding{unpriced.length === 1 ? '' : 's'} unpriced and excluded from every
          total — {unpriced.map((i) => i.symbol).join(', ')}.{' '}
        </>
      ) : null}
      {stale.length > 0 ? <>Stale prices, used and marked: {stale.map((i) => i.symbol).join(', ')}.</> : null}
    </p>
  );
}

/** One holdings row. Unpriced holdings sort to the bottom and are marked, never zeroed. */
export function HoldingRow({ holding, format }: { holding: HoldingView; format: Formatter }) {
  return (
    <tr className="border-t border-border">
      <td className={TD}>
        <Link href={`/investments/holdings/${holding.instrument.id}`} className="font-medium hover:underline">
          {holding.instrument.symbol}
        </Link>
        <span className="ml-2 text-xs text-ink-faint">{holding.instrument.name}</span>
      </td>
      <td className={TD}>
        <span className="text-xs text-ink-muted">{holding.instrument.assetClass.replace(/_/g, ' ')}</span>
      </td>
      <td className={TD}>
        <span className="text-xs text-ink-muted">{holding.accountName}</span>
      </td>
      <td className={TD_NUM}>{holding.quantity.units === 0n ? '—' : formatQty(holding)}</td>
      <td
        className={TD_NUM}
        title="cost_basis ÷ quantity, derived from the surviving lots — never a stored average"
      >
        {holding.avgCost === null ? '—' : formatUnitPrice(holding.avgCost)}
      </td>
      <td className={TD_NUM}>{format.money(holding.invested)}</td>
      <td className={TD_NUM}>
        <PriceDot price={holding.price} />
      </td>
      <td className={TD_NUM}>
        {holding.marketValue === null ? (
          <span title="No price available">—</span>
        ) : (
          format.money(holding.marketValue)
        )}
      </td>
      <td className={TD_NUM}>
        {holding.unrealizedPnl === null ? (
          <span title="No price available">—</span>
        ) : (
          <span className={holding.unrealizedPnl.minor < 0n ? 'text-negative' : 'text-positive'}>
            {format.money(holding.unrealizedPnl)}
          </span>
        )}
      </td>
      <td className={TD_NUM} title={format.reason(holding.returnPct)}>
        {format.metricPercent(holding.returnPct, 2)}
      </td>
      <td className={TD_NUM} title={format.reason(holding.weightPct)}>
        {format.metricPercent(holding.weightPct, 1)}
      </td>
    </tr>
  );
}

function formatQty(holding: HoldingView): string {
  // Trailing zeros beyond what the holding actually uses are noise: 100 units is
  // "100", not "100.00000000".
  return (Number(holding.quantity.units) / 1e8).toString();
}

/**
 * A per-unit figure at four decimals.
 *
 * Not `formatMoney`: an average cost is a `UnitPrice` at scale 8, and rendering
 * it through the money formatter would print the *total* it was derived from —
 * or truncate it to the currency's minor units, which is the truncation
 * `UnitPrice` exists to prevent.
 */
function formatUnitPrice(price: { readonly units: bigint }): string {
  return (Number(price.units) / 1e8).toFixed(4);
}

/** A labelled figure. Used for the header strip, where density matters most. */
export function Figure({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
  tone?: 'positive' | 'negative' | undefined;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs text-ink-faint">{label}</div>
      <div
        className={`text-base font-semibold tabular ${
          tone === 'positive' ? 'text-positive' : tone === 'negative' ? 'text-negative' : ''
        }`}
        title={hint}
      >
        {value}
      </div>
    </div>
  );
}
