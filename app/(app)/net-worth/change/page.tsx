import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '../../../_components/page-shell';
import { addMonths, isIsoDate, isoDate, type IsoDate } from '@/lib/date';
import { netWorthChange } from '@/server/services';
import { BasisNotice, Headline, Row } from '../_components';
import { BRIDGE_LABELS, loadNetWorthContext } from '../_page-data';

export const metadata: Metadata = { title: 'What changed' };

/**
 * The change bridge — *"why did net worth move?"*
 *
 * Every line corresponds to one term of the composition, which is what makes the
 * identity close rather than approximately balance. `Unexplained` is always
 * shown: **a bridge that silently balances is a bridge that is hiding an error**
 * ([FINANCIAL-DOMAIN.md §9.3](../../../../docs/FINANCIAL-DOMAIN.md#93-calculation)).
 */
export default async function NetWorthChangePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { ctx, format } = await loadNetWorthContext('/net-worth/change');
  const params = await searchParams;

  const to: IsoDate = params.to && isIsoDate(params.to) ? isoDate(params.to) : ctx.today;
  const from: IsoDate =
    params.from && isIsoDate(params.from) ? isoDate(params.from) : addMonths(to, -6);

  const computed = await netWorthChange(ctx, from, to);
  if (!computed.ok) throw new Error(computed.error.message);
  const bridge = computed.value;

  const residual = bridge.unexplained.minor;

  return (
    <>
      <PageHeader
        title="What changed"
        description={`${format.date(from)} → ${format.date(to)}`}
        actions={
          <Link href="/net-worth" className="text-sm text-ink-muted hover:text-ink">
            ← Net worth
          </Link>
        }
      />

      <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
        <Headline label="Opening" amount={format.money(bridge.opening)} />
        <Headline
          label="Change"
          amount={format.money(bridge.delta)}
          tone={bridge.delta.minor < 0n ? 'negative' : bridge.delta.minor > 0n ? 'positive' : 'neutral'}
        />
        <Headline label="Closing" amount={format.money(bridge.closing)} />
      </div>

      <BasisNotice />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[26rem] text-sm">
          <tbody>
            <Row label="Opening net worth at cost" value={format.money(bridge.opening)} />

            {bridge.lines.map((line) => (
              <Row
                key={line.key}
                indent
                muted={line.notMeasured}
                label={
                  line.notMeasured ? (
                    <>
                      {BRIDGE_LABELS[line.key] ?? line.key}
                      <span className="ml-2 text-xs text-ink-faint">not measured — at cost</span>
                    </>
                  ) : (
                    (BRIDGE_LABELS[line.key] ?? line.key)
                  )
                }
                // A line that is structurally zero renders as an em dash, never
                // as ₹0 — "we did not measure this" and "this did not move" are
                // different financial statements.
                value={line.notMeasured ? '—' : format.money(line.amount)}
              />
            ))}

            <tr className="border-t border-border">
              <td className="py-1 pl-4 text-ink-muted">Explained</td>
              <td className="py-1 text-right tabular-nums text-ink-muted">
                {format.money(bridge.explained)}
              </td>
            </tr>

            <Row
              label={
                <span className={residual === 0n ? 'text-ink-muted' : 'font-medium text-negative'}>
                  Unexplained
                </span>
              }
              indent
              title={
                residual === 0n
                  ? 'The bridge closes exactly.'
                  : 'A non-zero residual is a defect in the attribution, not a rounding artefact.'
              }
              value={format.money(bridge.unexplained)}
            />

            <tr className="border-t border-border-strong font-medium">
              <td className="py-2">Closing net worth at cost</td>
              <td className="py-2 text-right tabular-nums">{format.money(bridge.closing)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-xs text-ink-faint">
        {residual === 0n
          ? bridge.singleCurrency
            ? 'The bridge closes exactly. Every component is in the base currency, so no FX term can hide a residual.'
            : 'The bridge closes. Components in other currencies are revalued on the FX line.'
          : 'The residual above is a defect: every movement should be attributable to one of the lines.'}{' '}
        A purchase appears on no line — it converts cash into basis and moves net worth by zero.
      </p>
    </>
  );
}
