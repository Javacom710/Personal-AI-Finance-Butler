import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader, ProportionBar } from '../../../_components/page-shell';
import { addMonths, endOfMonth, type IsoDate } from '@/lib/date';
import { netWorthSeries } from '@/server/services';
import { BasisNotice } from '../_components';
import { loadNetWorthContext } from '../_page-data';

export const metadata: Metadata = { title: 'Net worth history' };

/** Twelve month-ends, oldest first, ending with today. */
function monthEnds(today: IsoDate, count: number): IsoDate[] {
  const points: IsoDate[] = [];
  for (let back = count - 1; back >= 1; back -= 1) {
    points.push(endOfMonth(addMonths(today, -back)));
  }
  points.push(today);
  return points;
}

/**
 * The month-end series.
 *
 * **One fetch, one fold per point** — not one computation per point
 * ([ADR-24](../../../../docs/DECISIONS.md)). Nothing is stored, so a correction
 * to a transaction dated last March leaves every point from March onward right
 * on the next load, with no snapshot to invalidate.
 */
export default async function NetWorthHistoryPage() {
  const { ctx, format } = await loadNetWorthContext('/net-worth/history');

  const points = await netWorthSeries(ctx, monthEnds(ctx.today, 12));
  const magnitudes = points.map((p) =>
    p.result.netWorth.minor < 0n ? -p.result.netWorth.minor : p.result.netWorth.minor,
  );
  const peak = magnitudes.reduce((a, b) => (a > b ? a : b), 0n);

  return (
    <>
      <PageHeader
        title="Net worth at cost — history"
        description="Month-end figures, each derived from the ledger as it stood on that date."
        actions={
          <Link href="/net-worth" className="text-sm text-ink-muted hover:text-ink">
            ← Net worth
          </Link>
        }
      />

      <BasisNotice />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-ink-faint">
              <th className="py-2 font-medium">Month end</th>
              <th className="py-2 text-right font-medium">Assets</th>
              <th className="py-2 text-right font-medium">Liabilities</th>
              <th className="py-2 text-right font-medium">Net worth</th>
              <th className="py-2 pl-4 font-medium">Relative</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {points.map((point, index) => {
              const previous = index === 0 ? null : points[index - 1]!.result.netWorth.minor;
              const current = point.result.netWorth.minor;
              const magnitude = current < 0n ? -current : current;
              return (
                <tr key={point.asOf}>
                  <td className="py-1.5">{format.date(point.asOf)}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {format.money(point.result.assets)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {format.money(point.result.liabilities)}
                  </td>
                  <td
                    className={`py-1.5 text-right tabular-nums ${
                      current < 0n ? 'text-negative' : 'text-ink'
                    }`}
                  >
                    {format.money(point.result.netWorth)}
                    {previous === null ? null : (
                      <span className="ml-2 text-xs text-ink-faint">
                        {current > previous ? '▲' : current < previous ? '▼' : '—'}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pl-4">
                    {/*
                      Decoration only: the exact figure is printed beside it, and
                      the bar is scaled against the largest magnitude in view.
                    */}
                    <ProportionBar
                      fraction={peak === 0n ? 0 : Number(magnitude) / Number(peak)}
                      label={`${format.money(point.result.netWorth)} on ${point.asOf}`}
                      tone={current < 0n ? 'negative' : 'accent'}
                      className="w-32"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-ink-faint">
        Each row is computed from the accounts, lots, valuations and balances that existed on that
        date — never from a stored snapshot. Editing a past transaction corrects every row above it
        on the next load.
      </p>
    </>
  );
}
