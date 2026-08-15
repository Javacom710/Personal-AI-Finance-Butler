import Link from 'next/link';

import type { Formatter } from '@/server/services';
import type { Contribution, ExcludedComponent, GroupSubtotal } from '@/server/services';
import { GROUP_LABELS, sourceHref } from './_page-data';

/**
 * Display components for the Net Worth area.
 *
 * **None of these computes a financial figure.** Every number arrives already
 * totalled by the engine; these decide only where it sits on the page. A
 * subtotal computed here would be the second implementation
 * [FINANCIAL-DOMAIN.md §10.5](../../../docs/FINANCIAL-DOMAIN.md#105-single-implementation-per-concept)
 * exists to forbid.
 */

/**
 * The basis banner — a ROADMAP Phase 5 gate, not a nicety.
 *
 * Investments contribute their **acquisition cost** until Phase 6 brings market
 * pricing, so the headline is *Net Worth at Cost* and the page says so plainly.
 * An unqualified "Net worth" here would read as a current market valuation
 * ([ADR-23](../../../docs/DECISIONS.md)).
 */
export function BasisNotice() {
  return (
    <p className="rounded-md border border-border bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
      <strong className="font-medium text-ink">Valued at cost.</strong> Investments contribute what
      they were bought for, not what they are worth today — market pricing arrives in Phase&nbsp;6.
      The <Link href="/investments" className="underline hover:text-ink">Investments</Link> pages
      show market value where a price has been entered.
    </p>
  );
}

/**
 * The trade-dated notice — [ADR-22](../../../docs/DECISIONS.md)'s carried UI
 * requirement.
 *
 * Balances are recognised on `trade_date`, so in a T+1 market a displayed
 * balance can differ from the broker's cleared cash for up to one settlement
 * cycle. Saying so is the whole requirement; no figure changes.
 */
export function TradeDatedNotice() {
  return (
    <p className="text-xs text-ink-faint">
      Balances are <strong className="font-medium">trade-dated</strong>: a trade counts from the day
      it was made, so a broker&rsquo;s cleared cash can differ for up to one settlement cycle.
    </p>
  );
}

/** The headline figure, with the period delta beside it. */
export function Headline({
  label,
  amount,
  sublabel,
  tone,
}: {
  label: string;
  amount: string;
  sublabel?: string;
  tone?: 'positive' | 'negative' | 'neutral';
}) {
  const toneClass =
    tone === 'positive' ? 'text-positive' : tone === 'negative' ? 'text-negative' : 'text-ink';
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums tracking-tight ${toneClass}`}>{amount}</p>
      {sublabel ? <p className="text-xs text-ink-muted">{sublabel}</p> : null}
    </div>
  );
}

/**
 * One side of the balance sheet, grouped.
 *
 * A `none`-side contribution — a settled card, a fully sold position — appears
 * under no group: it has no side to sit on, and inventing one would print a zero
 * row under a heading it does not belong to.
 */
export function SideTable({
  heading,
  side,
  groups,
  contributions,
  total,
  format,
}: {
  heading: string;
  side: 'asset' | 'liability';
  groups: readonly GroupSubtotal[];
  contributions: readonly Contribution[];
  total: string;
  format: Formatter;
}) {
  const mine = groups.filter((g) => g.side === side);

  if (mine.length === 0) {
    return (
      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{heading}</h2>
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-ink-muted">
          Nothing on this side.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{heading}</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[22rem] text-sm">
          <tbody>
            {mine.map((group) => {
              const rows = contributions.filter((c) => c.side === side && c.group === group.group);
              return (
                <GroupRows
                  key={`${side}:${group.group}`}
                  group={group}
                  rows={rows}
                  format={format}
                />
              );
            })}
            <tr className="border-t border-border-strong font-medium">
              <td className="py-2">Total {heading.toLowerCase()}</td>
              <td className="py-2 text-right tabular-nums">{total}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function GroupRows({
  group,
  rows,
  format,
}: {
  group: GroupSubtotal;
  rows: readonly Contribution[];
  format: Formatter;
}) {
  return (
    <>
      <tr className="border-t border-border">
        <td className="py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {GROUP_LABELS[group.group] ?? group.group}
        </td>
        <td className="py-1.5 text-right text-xs tabular-nums text-ink-muted">
          {format.money(group.total)}
        </td>
      </tr>
      {rows.map((row) => {
        const href = sourceHref(row.sourceRef);
        // The magnitude, because the side already carries the sign. A liability
        // printed as a negative under a "Liabilities" heading reads as a credit.
        const magnitude = format.money({
          minor: row.base.minor < 0n ? -row.base.minor : row.base.minor,
          currency: row.base.currency,
        });
        return (
          <tr key={row.keyId} className="text-ink">
            <td className="py-1 pl-4">
              {href ? (
                <Link href={href} className="hover:underline">
                  {row.label}
                </Link>
              ) : (
                row.label
              )}
              {row.nativeCurrency !== row.base.currency ? (
                <span className="ml-2 text-xs text-ink-faint">
                  {format.money(row.native)} @ {format.rate(row.rate)} on {format.dateShort(row.rateAsOf)}
                </span>
              ) : null}
            </td>
            <td className="py-1 text-right tabular-nums">{magnitude}</td>
          </tr>
        );
      })}
    </>
  );
}

/**
 * What was left out, and why.
 *
 * Never folded into the total and never rounded away: a figure that silently
 * omits a component is a worse answer than one that says so
 * ([FINANCIAL-DOMAIN.md §10.4](../../../docs/FINANCIAL-DOMAIN.md#104-partial-results-are-labelled-not-hidden)).
 * Asset and liability coverage are stated separately because an excluded asset
 * makes the figure look lower and an excluded liability makes it look higher.
 */
export function CoverageNotice({
  excluded,
  assetCoverage,
  liabilityCoverage,
  format,
}: {
  excluded: readonly ExcludedComponent[];
  assetCoverage: string;
  liabilityCoverage: string;
  format: Formatter;
}) {
  if (excluded.length === 0) return null;

  const REASONS: Record<string, string> = {
    no_fx_rate: 'no exchange rate on or before this date',
    unvalued: 'held, but not valued by this date',
  };

  return (
    <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
      <p className="font-medium text-ink">
        {excluded.length} {excluded.length === 1 ? 'component is' : 'components are'} not included in
        the totals.
      </p>
      <ul className="mt-1 space-y-0.5 text-ink-muted">
        {excluded.map((e) => (
          <li key={e.keyId}>
            <span className="text-ink">{e.label}</span>
            {e.native.minor === 0n ? null : <> — {format.money(e.native)}</>} ·{' '}
            {REASONS[e.reason] ?? e.reason}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-ink-faint">
        Coverage: {assetCoverage} of assets, {liabilityCoverage} of liabilities.
      </p>
    </div>
  );
}

/** A dense definition row — used by the reconciliation and the waterfall. */
export function Row({
  label,
  value,
  muted,
  indent,
  title,
}: {
  label: React.ReactNode;
  value: string;
  muted?: boolean;
  indent?: boolean;
  title?: string;
}) {
  return (
    <tr className={muted ? 'text-ink-muted' : 'text-ink'} title={title}>
      <td className={`py-1 ${indent ? 'pl-4' : ''}`}>{label}</td>
      <td className="py-1 text-right tabular-nums">{value}</td>
    </tr>
  );
}
