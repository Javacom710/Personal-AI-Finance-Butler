import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader, ProportionBar } from '../../../_components/page-shell';
import { listBudgetStatuses, listCategories, listCurrencies } from '@/server/services';
import { Disclosure, InlineAction } from '../_components';
import { BudgetForm } from '../_forms';
import { createBudgetAction, deleteBudgetAction } from '../actions';
import { loadMoneyContext } from '../_page-data';

export const metadata: Metadata = { title: 'Budgets' };

/**
 * Budgets.
 *
 * Only spending counts: transfers and income never do. Over budget is a state,
 * not an error — nothing is blocked, the row is simply coloured.
 */
export default async function BudgetsPage() {
  const { ctx, format } = await loadMoneyContext('/money/budgets');

  const [statuses, categories, currencies] = await Promise.all([
    listBudgetStatuses(ctx, { includeInactive: true }),
    listCategories(ctx, { kind: 'expense' }),
    listCurrencies(ctx),
  ]);

  return (
    <>
      <PageHeader
        title="Budgets"
        description="Spending against a category and a period. Transfers and income are never counted."
        actions={
          <Link href="/money" className="text-sm text-ink-muted hover:text-ink">
            ← Money
          </Link>
        }
      />

      <Disclosure summary="Add a budget">
        <BudgetForm
          action={createBudgetAction}
          categories={categories.map((c) => ({ id: c.id, label: c.path }))}
          currencies={currencies.map((c) => c.code)}
          baseCurrency={ctx.base}
          today={ctx.today}
        />
      </Disclosure>

      {!statuses.ok ? (
        <p className="rounded-md border border-negative/40 bg-negative/10 px-3 py-2 text-sm text-negative">
          {statuses.error.message}
        </p>
      ) : statuses.value.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-ink-muted">
          No budgets yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-ink-faint">
              <tr>
                <th className="px-3 py-2 font-medium">Category</th>
                <th className="px-3 py-2 font-medium">Period</th>
                <th className="px-3 py-2 text-right font-medium">Budget</th>
                <th className="px-3 py-2 text-right font-medium">Actual</th>
                <th className="px-3 py-2 text-right font-medium">Remaining</th>
                <th className="px-3 py-2 font-medium">Used</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {statuses.value.map((budget) => {
                const used = budget.status.utilization;
                const percent = used.value === null ? 0 : Number(used.value.value) / 1e8;
                const ahead = budget.status.pace.value !== null && budget.status.pace.value.value > 0n;

                return (
                  <tr key={budget.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      {budget.categoryLabel}
                      {!budget.isActive ? (
                        <span className="ml-2 text-xs text-ink-faint">(inactive)</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-muted">
                      {budget.period}
                      <span className="block text-ink-faint">
                        {format.dateShort(budget.range.from)} – {format.dateShort(budget.range.to)}
                      </span>
                    </td>
                    <td className="tabular px-3 py-2 text-right">
                      {format.money(budget.status.budgeted)}
                      {budget.conversionRate ? (
                        <span className="block text-[0.625rem] text-ink-faint">
                          {format.money(budget.amount)} @ {format.rate(budget.conversionRate)}
                        </span>
                      ) : null}
                    </td>
                    <td className="tabular px-3 py-2 text-right">{format.money(budget.status.actual)}</td>
                    <td
                      className={`tabular px-3 py-2 text-right ${
                        budget.status.isOverBudget ? 'text-negative' : 'text-ink-muted'
                      }`}
                    >
                      {format.money(budget.status.remaining)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {/* Was an inline `style={{ width }}`, which the CSP in
                            proxy.ts blocks — the bar rendered at zero width in
                            every browser, with a console violation and no other
                            symptom. `ProportionBar` uses static classes. */}
                        <ProportionBar
                          fraction={percent}
                          label={`${format.metricPercent(used, 0)} of budget used`}
                          tone={budget.status.isOverBudget ? 'negative' : 'accent'}
                          className="w-24"
                        />
                        <span className="tabular text-xs text-ink-muted">
                          {format.metricPercent(used, 0)}
                        </span>
                      </div>
                      <span className="text-[0.625rem] text-ink-faint">
                        {budget.status.daysElapsed}/{budget.status.daysTotal} days
                        {ahead ? ' · ahead of pace' : ''}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <InlineAction
                        action={deleteBudgetAction}
                        label="Remove"
                        variant="danger"
                        values={{ id: budget.id }}
                        confirm={`Remove the ${budget.period} budget for ${budget.categoryLabel}?`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
