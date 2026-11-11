import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader, ProportionBar } from '../_components/page-shell';
import { addDays } from '@/lib/date';
import { periodContaining } from '@/lib/date/periods';
import {
  assetAllocation,
  listAccounts,
  listBudgetStatuses,
  listInstruments,
  netWorthChange,
  netWorthReconciliation,
  periodSummary,
  portfolio,
  upcomingCommitments,
} from '@/server/services';
import { attentionItems, isOverviewEmpty } from './_overview';
import { amountTone, loadMoneyContext } from './money/_page-data';

export const metadata: Metadata = { title: 'Overview' };

/** How far ahead "upcoming commitments" looks — the same window the Money page uses. */
const UPCOMING_DAYS = 14;

/**
 * The Overview: where the user stands, on one screen (`CLAUDE.md <overview>`).
 *
 * **This page computes nothing.** Every figure is a field of a result the Money,
 * Investments and Net Worth pages already render, from the same services the AI
 * tools call, so the Overview cannot disagree with them
 * ([FINANCIAL-DOMAIN.md §10.5](../../docs/FINANCIAL-DOMAIN.md#105-single-implementation-per-concept)).
 * The "Needs attention" list is a set of deterministic flags read off those
 * results, not an AI judgement.
 */
export default async function OverviewPage() {
  const { ctx, format } = await loadMoneyContext('/');

  const [accounts, instruments, netWorth] = await Promise.all([
    listAccounts(ctx),
    listInstruments(ctx),
    netWorthReconciliation(ctx),
  ]);
  if (!netWorth.ok) throw new Error(netWorth.error.message);

  // Empty only when NOTHING is recorded. Manual assets, liabilities and inactive
  // accounts are not in the two active lists but do reach net worth, so the
  // net-worth sources decide alongside them.
  const nothingRecorded =
    accounts.length === 0 &&
    instruments.length === 0 &&
    isOverviewEmpty(netWorth.value.result.contributions.length, netWorth.value.result.excluded.length);

  if (nothingRecorded) {
    return (
      <>
        <PageHeader title="Overview" description="Where you stand right now, on one screen." />
        <div className="rounded-lg border border-dashed border-border-strong bg-surface-sunken px-6 py-10 text-center">
          <h2 className="text-sm font-medium">Nothing recorded yet</h2>
          <p className="mx-auto mt-2 max-w-prose text-sm text-ink-muted">
            This screen fills in from your own records: net worth, cash, investments, this
            month&apos;s cash flow and what falls due next. It shows no sample figures, because a
            placeholder number on a financial dashboard is indistinguishable from a real one.
          </p>
          <div className="mt-4 flex justify-center gap-3 text-sm">
            <Link href="/money/accounts" className="rounded-md bg-accent px-3 py-1.5 font-medium text-accent-ink">
              Add an account
            </Link>
            <Link href="/investments/instruments" className="rounded-md border border-border px-3 py-1.5 text-ink-muted hover:text-ink">
              Add an investment
            </Link>
          </div>
        </div>
      </>
    );
  }

  const period = periodContaining(ctx.today, 'monthly', ctx.fiscalYearStartMonth);
  const monthAgo = addDays(ctx.today, -30);

  const [change, month, invested, allocation, upcoming, budgets] = await Promise.all([
    netWorthChange(ctx, monthAgo, ctx.today),
    periodSummary(ctx, period),
    portfolio(ctx),
    assetAllocation(ctx, 'asset_class'),
    upcomingCommitments(ctx, UPCOMING_DAYS),
    listBudgetStatuses(ctx),
  ]);

  if (!invested.ok) throw new Error(invested.error.message);

  const { result, reconciliation } = netWorth.value;
  const { summary } = invested.value;
  const delta = change.ok ? change.value.delta : null;
  const cash = result.groups.find((g) => g.group === 'cash');
  const investmentsAtCost = result.groups.find((g) => g.group === 'investments');
  const priced = summary.unrealizedPnl !== null;
  const hasHoldings = instruments.length > 0;

  // Returns are shown only when every holding is priced. With an unpriced
  // holding the engine's unrealised figure nets priced value against the cost of
  // ALL holdings, so the return would read as a loss that has not happened.
  const fullyPriced = priced && summary.unpricedInstruments.length === 0;

  const attention = attentionItems({
    reconciliationResidual: reconciliation.balances ? null : format.money(reconciliation.residual),
    overspend:
      month.savings.minor < 0n
        ? { expenses: format.money(month.expenses), income: format.money(month.income) }
        : null,
    overBudget: (budgets.ok ? budgets.value : [])
      .filter((b) => b.status.isOverBudget)
      .map((b) => ({
        label: b.categoryLabel,
        actual: format.money(b.status.actual),
        budgeted: format.money(b.status.budgeted),
      })),
    unpriced: summary.unpricedInstruments,
    stale: summary.staleInstruments,
    excludedFromNetWorth: result.excluded.length,
  });

  return (
    <>
      <PageHeader title="Overview" description={`As of ${format.date(ctx.today)}`} />

      <section aria-label="Position" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure
          label="Net worth at cost"
          value={format.money(result.netWorth)}
          tone={amountTone(result.netWorth.minor)}
          note={
            delta === null
              ? undefined
              : `${format.money(delta, { signDisplay: 'always' })} in 30 days`
          }
          href="/net-worth"
        />
        <Figure
          label="Liquid cash"
          value={cash ? format.money(cash.total) : '—'}
          note="Cash and bank accounts"
          href="/money/accounts"
        />
        <Figure
          label="Investments at cost"
          value={investmentsAtCost ? format.money(investmentsAtCost.total) : '—'}
          note={hasHoldings ? 'Market value below' : undefined}
          href="/investments"
        />
        <Figure
          label="Liabilities"
          value={format.money(result.liabilities)}
          href="/net-worth/liabilities"
        />
      </section>

      <section aria-label="This month" className="space-y-3">
        <SectionHeading href="/money" link="Money →">
          This month · {format.dateShort(period.from)} – {format.dateShort(period.to)}
        </SectionHeading>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Figure label="Income" value={format.money(month.income)} tone="text-positive" />
          <Figure label="Expenses" value={format.money(month.expenses)} tone="text-negative" />
          <Figure label="Savings" value={format.money(month.savings)} tone={amountTone(month.savings.minor)} />
          <Figure
            label="Savings rate"
            value={format.metricPercent(month.savingsRate)}
            note={format.reason(month.savingsRate) ?? 'of income kept'}
          />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {hasHoldings ? (
          <section aria-label="Portfolio" className="space-y-3">
            <SectionHeading href="/investments/allocation" link="Allocation →">
              Portfolio
            </SectionHeading>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Figure
                label="Market value"
                value={priced ? format.money(summary.marketValue) : '—'}
                note={priced ? `${format.percent(summary.coverage, 0)} priced` : 'No holding could be priced'}
              />
              <Figure
                label="Total return"
                value={fullyPriced ? format.metricPercent(summary.totalReturnPct, 2) : '—'}
                note={fullyPriced ? (format.reason(summary.totalReturnPct) ?? 'On capital deployed') : 'Needs every holding priced'}
              />
              <Figure
                label="XIRR"
                value={fullyPriced ? format.metricPercent(summary.xirr, 2) : '—'}
                note={fullyPriced ? (format.reason(summary.xirr) ?? 'Money-weighted') : 'Needs every holding priced'}
              />
            </div>
            {allocation.slices.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-ink-muted">
                Allocation appears once a holding is priced.
              </p>
            ) : (
              <ul className="space-y-2 rounded-lg border border-border px-3 py-3">
                {allocation.slices.map((slice) => (
                  <li key={slice.key} className="grid grid-cols-[7rem_1fr_3.5rem] items-center gap-3 text-sm">
                    <Link href="/investments/allocation" className="truncate hover:underline">
                      {slice.label}
                    </Link>
                    <ProportionBar
                      fraction={Number(slice.weightPct.value?.value ?? 0n) / 1e10}
                      label={`${slice.label}: ${format.metricPercent(slice.weightPct, 1)} of priced value`}
                    />
                    <span className="tabular text-right text-ink-muted">
                      {format.metricPercent(slice.weightPct, 0)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        <section aria-label="Upcoming commitments" className="space-y-3">
          <SectionHeading href="/money/recurring" link="Recurring →">
            Due in the next {UPCOMING_DAYS} days
          </SectionHeading>
          {upcoming.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-ink-muted">
              Nothing falls due.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {upcoming.map((occurrence) => (
                <li key={occurrence.id} className="flex items-baseline justify-between px-3 py-2 text-sm">
                  <span>
                    {occurrence.ruleName}
                    <span className="ml-2 text-xs text-ink-faint">{format.dateShort(occurrence.dueOn)}</span>
                  </span>
                  <span className="tabular">{occurrence.amountText}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section aria-label="Needs attention" className="space-y-3">
        <SectionHeading>Needs attention</SectionHeading>
        {attention.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing: budgets are within limits, prices are current and net worth reconciles.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {attention.map((item) => (
              <li key={item.text} className="px-3 py-2 text-sm">
                <Link
                  href={item.href}
                  className={`hover:underline ${item.tone === 'negative' ? 'text-negative' : 'text-ink'}`}
                >
                  {item.text}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function SectionHeading({
  children,
  href,
  link,
}: {
  children: React.ReactNode;
  href?: string;
  link?: string;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{children}</h2>
      {href && link ? (
        <Link href={href} className="text-xs text-ink-muted hover:text-ink">
          {link}
        </Link>
      ) : null}
    </div>
  );
}

function Figure({
  label,
  value,
  tone = 'text-ink',
  note,
  href,
}: {
  label: string;
  value: string;
  tone?: string;
  note?: string | undefined;
  href?: string;
}) {
  const body = (
    <>
      <p className="text-xs text-ink-faint">{label}</p>
      <p className={`tabular mt-0.5 text-lg ${tone}`}>{value}</p>
      {note ? <p className="mt-0.5 text-xs text-ink-faint">{note}</p> : null}
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-lg border border-border px-3 py-2.5 hover:border-border-strong">
      {body}
    </Link>
  ) : (
    <div className="rounded-lg border border-border px-3 py-2.5">{body}</div>
  );
}
