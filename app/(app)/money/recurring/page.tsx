import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '../../../_components/page-shell';
import { addDays } from '@/lib/date';
import { listAccounts, listCategories, listOccurrences, listRules } from '@/server/services';
import { Disclosure, InlineAction } from '../_components';
import { RecurringRuleForm } from '../_forms';
import {
  createRecurringRuleAction,
  deleteRecurringRuleAction,
  postOccurrenceAction,
  refreshRecurringAction,
  skipOccurrenceAction,
} from '../actions';
import { loadMoneyContext } from '../_page-data';

export const metadata: Metadata = { title: 'Recurring' };

/**
 * Recurring rules and their forward calendar.
 *
 * Posting is idempotent by construction: `UNIQUE (rule_id, due_on)` makes
 * scheduling an occurrence a no-op the second time, and a compare-and-swap on
 * `status` means two runners cannot both post the same one (ADR-15). Pressing
 * Post twice therefore produces one transaction, not two.
 */
export default async function RecurringPage() {
  const { ctx, format } = await loadMoneyContext('/money/recurring');

  const [rules, pending, recentlyPosted, accounts, categories] = await Promise.all([
    listRules(ctx, { includeInactive: true }),
    listOccurrences(ctx, { status: 'pending', to: addDays(ctx.today, 60) }),
    listOccurrences(ctx, { status: 'posted', from: addDays(ctx.today, -30), limit: 20 }),
    listAccounts(ctx),
    listCategories(ctx),
  ]);

  const due = pending.filter((o) => o.dueOn <= ctx.today);
  const upcoming = pending.filter((o) => o.dueOn > ctx.today);

  return (
    <>
      <PageHeader
        title="Recurring"
        description="Salary, rent, EMIs, subscriptions. Nothing here can post twice for the same date."
        actions={
          <div className="flex items-center gap-3">
            <InlineAction action={refreshRecurringAction} label="Refresh schedule" values={{}} />
            <Link href="/money" className="text-sm text-ink-muted hover:text-ink">
              ← Money
            </Link>
          </div>
        }
      />

      <Disclosure summary="Add a recurring rule" defaultOpen={rules.length === 0}>
        <RecurringRuleForm
          action={createRecurringRuleAction}
          accounts={accounts.map((a) => ({ id: a.id, label: a.name, currency: a.currency }))}
          categories={categories.map((c) => ({ id: c.id, label: c.path, kind: c.kind }))}
          today={ctx.today}
        />
      </Disclosure>

      {due.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Due now</h2>
          <ul className="divide-y divide-border rounded-lg border border-warning/40">
            {due.map((occurrence) => (
              <li key={occurrence.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>
                  {occurrence.ruleName}
                  <span className="ml-2 text-xs text-ink-faint">{format.date(occurrence.dueOn)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular text-ink-muted">{occurrence.amountText}</span>
                  <InlineAction
                    action={postOccurrenceAction}
                    label="Post"
                    variant="primary"
                    values={{ id: occurrence.id }}
                  />
                  <InlineAction action={skipOccurrenceAction} label="Skip" values={{ id: occurrence.id }} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Rules</h2>
        {rules.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-ink-muted">
            No recurring rules yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs text-ink-faint">
                <tr>
                  <th className="px-3 py-2 font-medium">Rule</th>
                  <th className="px-3 py-2 font-medium">Kind</th>
                  <th className="px-3 py-2 font-medium">Schedule</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Next due</th>
                  <th className="px-3 py-2 font-medium">Posting</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      {rule.name}
                      {!rule.isActive ? <span className="ml-2 text-xs text-ink-faint">(inactive)</span> : null}
                    </td>
                    <td className="px-3 py-2 text-xs capitalize text-ink-muted">{rule.kind}</td>
                    <td className="px-3 py-2 text-xs text-ink-muted">{rule.rruleDescription}</td>
                    <td className="tabular px-3 py-2 text-right">{rule.template.amount}</td>
                    <td className="px-3 py-2 text-xs text-ink-muted">
                      {rule.nextDueOn ? format.date(rule.nextDueOn) : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-muted">
                      {rule.autoPost ? 'automatic' : 'confirm each'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <InlineAction
                        action={deleteRecurringRuleAction}
                        label="Delete"
                        variant="danger"
                        values={{ id: rule.id }}
                        confirm={`Delete ${rule.name}? Transactions it has already posted are kept.`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {upcoming.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
            Next 60 days
          </h2>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {upcoming.map((occurrence) => (
              <li key={occurrence.id} className="flex items-baseline justify-between px-3 py-1.5 text-sm">
                <span className="text-ink-muted">
                  {format.date(occurrence.dueOn)} · {occurrence.ruleName}
                </span>
                <span className="tabular text-xs text-ink-faint">{occurrence.amountText}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {recentlyPosted.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
            Posted in the last 30 days
          </h2>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {recentlyPosted.map((occurrence) => (
              <li key={occurrence.id} className="flex items-baseline justify-between px-3 py-1.5 text-sm">
                <span className="text-ink-muted">
                  {format.date(occurrence.dueOn)} · {occurrence.ruleName}
                </span>
                <span className="text-xs text-ink-faint">
                  {occurrence.transactionId ? 'posted' : 'posted (transaction removed)'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
