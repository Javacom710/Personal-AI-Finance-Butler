import Link from 'next/link';

import type { Formatter } from '@/server/services';
import type {
  Contribution,
  ExcludedComponent,
  GroupSubtotal,
  MarketValuation,
  Restatement,
  ValuationBasis,
} from '@/server/services';
import {
  EXCLUSION_REASONS,
  RESTATEMENT_LABELS,
  groupLabels,
  sourceHref,
} from './_page-data';

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
 * The basis banner — a ROADMAP gate, not a nicety.
 *
 * The basis is **in the label**, never implied: an unqualified "Net worth" would
 * read as whichever figure the reader expected ([ADR-23](../../../docs/DECISIONS.md)).
 * Both bases are first-class and neither replaces the other — they answer *what
 * did I put in* versus *what is it worth now*
 * ([ADR-32](../../../docs/DECISIONS.md)).
 */
export function BasisNotice({ basis }: { basis: ValuationBasis }) {
  if (basis === 'market') {
    return (
      <p className="rounded-md border border-border bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
        <strong className="font-medium text-ink">Valued at market.</strong> Investments contribute
        units held × the price in force on this date × the exchange rate on this date. Cash, property
        and debts are unchanged — a balance is a recorded fact and a valuation is not a price.{' '}
        <Link href="/net-worth" className="underline hover:text-ink">
          Net Worth at Cost
        </Link>{' '}
        remains the default view.
      </p>
    );
  }
  return (
    <p className="rounded-md border border-border bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
      <strong className="font-medium text-ink">Valued at cost.</strong> Investments contribute what
      they were bought for, not what they are worth today. This figure moves only when you do
      something — earn, spend, buy, sell, revalue or repay.
    </p>
  );
}

/**
 * The reciprocal line between the two bases, and the way to the other one.
 *
 * **One line, both figures and the difference. Not a second headline** — two
 * headline numbers is no headline at all, and forces the reader to decide which
 * one is their net worth ([MARKET-VALUE-NET-WORTH-DESIGN.md §15](../../../docs/MARKET-VALUE-NET-WORTH-DESIGN.md#15-ui--the-minimum)).
 *
 * The difference is labelled a **restatement**, never a gain: the portfolio did
 * not change between "at cost" and "at market", only the question did.
 */
export function BasisComparison({
  basis,
  restatement,
  status,
  format,
}: {
  basis: ValuationBasis;
  restatement: Restatement;
  status: MarketValuation | null;
  format: Formatter;
}) {
  const other = basis === 'cost' ? 'market' : 'cost';
  const unavailable = status?.status === 'unavailable';

  if (basis === 'cost' && unavailable) {
    return (
      <p className="text-sm text-ink-muted">
        No holding could be priced, so there is no market-value figure to compare against.{' '}
        <Link href="/net-worth/market" className="underline hover:text-ink">
          See why
        </Link>
        .
      </p>
    );
  }

  const amount = other === 'market' ? restatement.market : restatement.cost;
  const difference = restatement.difference;
  const sign = difference.minor > 0n ? '+' : '';

  return (
    <p className="text-sm text-ink-muted">
      {other === 'market' ? 'At market value' : 'At cost'}{' '}
      <span className="tabular-nums text-ink">{format.money(amount)}</span> ·{' '}
      <span
        className="tabular-nums"
        title="A restatement at one instant — not a gain, and not a movement over time (ADR-31)"
      >
        difference {sign}
        {format.money(difference)}
      </span>{' '}
      {basis === 'cost' ? (
        <Link href="/net-worth/market" className="underline hover:text-ink">
          view at market value →
        </Link>
      ) : (
        <Link href="/net-worth" className="underline hover:text-ink">
          back to Net Worth at Cost →
        </Link>
      )}
    </p>
  );
}

/**
 * Valuation completeness — **rendered only when it says something**.
 *
 * A status badge that is always present is furniture; one that appears when
 * coverage slips or a price is old is a fact. `complete` with nothing stale
 * therefore renders nothing at all.
 */
export function MarketStatusNotice({
  status,
  format,
}: {
  status: MarketValuation;
  format: Formatter;
}) {
  const showStatus = status.status !== 'complete';
  const showStale = status.staleness.count > 0;
  const showCarried = status.maxCarriedDays > 0;
  if (!showStatus && !showStale && !showCarried) return null;

  return (
    <div className="space-y-1 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
      {status.status === 'unavailable' ? (
        <p className="text-ink">
          <strong className="font-medium">Market value unavailable.</strong> Holdings exist, but not
          one of them could be priced, so no market-value figure is shown.{' '}
          <Link href="/net-worth" className="underline">
            Net Worth at Cost
          </Link>{' '}
          is unaffected.
        </p>
      ) : null}

      {status.status === 'partial' ? (
        <p className="text-ink">
          <strong className="font-medium">Partial.</strong> {format.percent(status.investmentCoverage)}{' '}
          of holdings by cost could be priced; {format.money(status.excludedInvestmentCost)} of cost
          basis was set aside for want of a price. That is what the comparison could not value —
          <span className="italic"> not</span> a loss.
        </p>
      ) : null}

      {showStale ? (
        <p className="text-ink-muted">
          Priced as of {format.date(status.staleness.oldestTradingDate!)} —{' '}
          {status.staleness.count} holding{status.staleness.count === 1 ? '' : 's'} valued from a
          session at least three behind. The price is used, and this is the note saying so.
        </p>
      ) : null}

      {showCarried && !showStale ? (
        <p className="text-ink-muted">
          The latest close for at least one holding is {status.maxCarriedDays} day
          {status.maxCarriedDays === 1 ? '' : 's'} before this date — carried back, never
          interpolated.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The cost-to-market restatement — three computed lines, none a residual.
 *
 * On the **drill-down**, never the summary: it answers *"why do these two
 * figures for the same instant differ?"*, which is a second question and not the
 * headline. The removed-unpriced row is labelled so it cannot be read as a
 * holding that fell ([ADR-31](../../../docs/DECISIONS.md)).
 */
export function RestatementTable({
  restatement,
  format,
}: {
  restatement: Restatement;
  format: Formatter;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
        From cost to market value
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[22rem] text-sm">
          <tbody>
            <Row label="Net Worth at Cost" value={format.money(restatement.cost)} />
            {restatement.lines.map((line) => (
              <Row
                key={line.key}
                indent
                muted
                label={RESTATEMENT_LABELS[line.key] ?? line.key}
                value={format.money(line.amount)}
                title={
                  line.key === 'removed_unpriced'
                    ? 'Cost set aside because no price exists — not a loss'
                    : undefined
                }
              />
            ))}
            <tr className="border-t border-border-strong font-medium">
              <td className="py-2">Net Worth at Market Value</td>
              <td className="py-2 text-right tabular-nums">{format.money(restatement.market)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-faint">
        {restatement.closes
          ? 'Every line is computed; none is a residual. The restatement closes exactly.'
          : `Restatement residual ${format.money(restatement.residual)} — this is a defect, not a rounding artefact.`}
      </p>
    </section>
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
  basis = 'cost',
}: {
  heading: string;
  side: 'asset' | 'liability';
  groups: readonly GroupSubtotal[];
  contributions: readonly Contribution[];
  total: string;
  format: Formatter;
  basis?: ValuationBasis;
}) {
  const labels = groupLabels(basis);
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
                  labels={labels}
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
  labels,
}: {
  group: GroupSubtotal;
  rows: readonly Contribution[];
  format: Formatter;
  labels: Record<string, string>;
}) {
  return (
    <>
      <tr className="border-t border-border">
        <td className="py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {labels[group.group] ?? group.group}
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
              {row.price === undefined ? null : (
                <span className="ml-2 text-xs text-ink-faint">
                  {/*
                    The whole answer to "why is it ₹72,000?" — units, price, the
                    session it came from and who published it. Every field is
                    already on the contribution; nothing is recomputed here.
                  */}
                  {trimZeros(row.price.quantity.units, 8)} × {trimZeros(row.price.unitPrice.units, 8)},
                  priced {format.dateShort(row.price.tradingDate)} from {row.price.source}
                  {row.price.freshness === 'stale' ? ' · stale' : ''}
                  {row.price.carriedDays > 0 ? ` · carried back ${row.price.carriedDays}d` : ''}
                </span>
              )}
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
            {EXCLUSION_REASONS[e.reason] ?? e.reason}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-ink-faint">
        Coverage: {assetCoverage} of assets, {liabilityCoverage} of liabilities.
      </p>
    </div>
  );
}

/**
 * A scaled integer as its exact decimal string, with trailing zeros trimmed.
 *
 * **No `Number()`**: `1629.80004883` at scale 8 is 162980004883 minor units, and
 * the double that would hold it is not the value the provider published
 * (invariant **I-49**). Presentation trims zeros; it never rounds a figure that
 * has not already been rounded by the engine.
 */
function trimZeros(units: bigint, scale: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale).replace(/0+$/u, '');
  return `${negative ? '-' : ''}${whole}${fraction === '' ? '' : `.${fraction}`}`;
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
