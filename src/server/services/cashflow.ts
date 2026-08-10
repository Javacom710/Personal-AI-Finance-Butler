import 'server-only';

/**
 * Period cash flow and its breakdowns (FINANCIAL-DOMAIN.md §8).
 *
 * The arithmetic is entirely in `domain/calc/cashflow.ts`; this service fetches
 * `transaction_entries` for a period and hands them over. That is deliberate
 * rather than pushing `SUM()` into SQL: **income, expenses, savings and every
 * category breakdown are then provably the same sum over the same array**, and
 * a category total that disagreed with the headline expense figure would be
 * arithmetically impossible rather than merely unlikely.
 *
 * A period holds a few hundred rows for a personal ledger. If that stops being
 * true the escape hatch is a materialised roll-up keyed by
 * `money_ledger_version` — derived, invalidatable and rebuildable — never a
 * stored total (ARCHITECTURE.md §6).
 */

import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';

import type { IsoDate } from '../../lib/date';
import { elapsedInPeriod, periodsBetween, type DateRange, type PeriodKind } from '../../lib/date/periods';
import { Money, type Money as MoneyValue } from '../../lib/decimal/money';
import {
  cashflow,
  comparePeriods,
  emptyCashflow,
  totalsByGroup,
  totalOverAllKinds,
  type CashflowComparison,
  type CashflowEntry,
  type CashflowSummary,
  type GroupedEntry,
} from '../domain/calc/cashflow';
import { categoryPath, rollup, type CategoryNode } from '../domain/calc/categories';
import type { TransactionKind } from '../domain/ledger/entries';
import { categories, transactionEntries, transactions, transactionTags, tags } from '../db/schema';
import type { ReadCtx } from './_ctx';

export type GroupBy = 'category' | 'tag' | 'account';

interface EntryRow {
  kind: TransactionKind;
  baseAmount: string;
  categoryId: string | null;
  accountId: string;
}

/**
 * Every entry booked in `[from, to]`, reduced to what cash-flow analysis needs.
 *
 * No `kind` filter here: the engine routes by kind, and fetching all three lets
 * `totalOverAllKinds` verify that same-currency transfers really do cancel
 * (FINANCIAL-DOMAIN.md §12, case 28) rather than that being an assumption.
 */
async function entriesInRange(ctx: ReadCtx, range: DateRange, extra: SQL[] = []): Promise<EntryRow[]> {
  return ctx.db
    .select({
      kind: transactions.kind,
      baseAmount: transactionEntries.baseAmount,
      categoryId: transactions.categoryId,
      accountId: transactionEntries.accountId,
    })
    .from(transactionEntries)
    .innerJoin(transactions, eq(transactions.id, transactionEntries.transactionId))
    .where(
      and(
        eq(transactions.userId, ctx.userId),
        sql`${transactions.bookedOn} >= ${range.from}`,
        sql`${transactions.bookedOn} <= ${range.to}`,
        ...extra,
      ),
    );
}

function toCashflowEntries(ctx: ReadCtx, rows: readonly EntryRow[]): CashflowEntry[] {
  return rows.map((row) => ({
    kind: row.kind,
    baseAmount: Money.fromDbString(row.baseAmount, ctx.base),
  }));
}

export async function periodSummary(ctx: ReadCtx, range: DateRange): Promise<CashflowSummary> {
  const rows = await entriesInRange(ctx, range);
  return rows.length === 0 ? emptyCashflow(ctx.base) : cashflow(toCashflowEntries(ctx, rows), ctx.base);
}

/**
 * The safety-net figure: `Σ base_amount` over **every** entry, unfiltered.
 *
 * Equals `netCashFlow + fxEffect` because a same-currency transfer's legs
 * cancel. Exposed so `verify:integrity` and the tests can assert it rather than
 * trusting the `kind` filter.
 */
export async function unfilteredTotal(ctx: ReadCtx, range: DateRange): Promise<MoneyValue> {
  const rows = await entriesInRange(ctx, range);
  return totalOverAllKinds(toCashflowEntries(ctx, rows), ctx.base);
}

export async function compareWithPrevious(
  ctx: ReadCtx,
  current: DateRange,
  previous: DateRange,
): Promise<CashflowComparison> {
  return comparePeriods(await periodSummary(ctx, current), await periodSummary(ctx, previous));
}

export interface BreakdownRow {
  readonly key: string | null;
  readonly label: string;
  readonly total: MoneyValue;
  readonly entryCount: number;
}

/**
 * Totals by category, tag or account for **one** kind.
 *
 * `kind` is required, and for tags that is load-bearing: tags are allowed on
 * transfers (FINANCIAL-DOMAIN.md §5), so a tag report without the filter would
 * count both legs of every tagged transfer as spending — a silent double count
 * of exactly the sort the entry-based ledger exists to prevent.
 *
 * Category totals **roll up**: `Food` includes `Groceries` and `Dining`.
 */
export async function breakdown(
  ctx: ReadCtx,
  range: DateRange,
  groupBy: GroupBy,
  kind: Extract<TransactionKind, 'income' | 'expense'>,
): Promise<BreakdownRow[]> {
  if (groupBy === 'tag') return tagBreakdown(ctx, range, kind);

  const rows = await entriesInRange(ctx, range);
  const grouped: GroupedEntry[] = rows.map((row) => ({
    kind: row.kind,
    baseAmount: Money.fromDbString(row.baseAmount, ctx.base),
    groupKey: groupBy === 'category' ? row.categoryId : row.accountId,
  }));

  const totals = totalsByGroup(grouped, kind, ctx.base);

  if (groupBy === 'account') {
    const labels = await accountLabels(ctx);
    return totals.map((t) => ({
      key: t.groupKey,
      label: t.groupKey ? (labels.get(t.groupKey) ?? 'Unknown account') : 'Unknown account',
      total: t.total,
      entryCount: t.entryCount,
    }));
  }

  // Category rollup: a parent's total includes its children's, which is what
  // makes "how much did I spend on food?" answerable without summing rows.
  const nodes = await categoryNodes(ctx);
  const direct = new Map(totals.filter((t) => t.groupKey !== null).map((t) => [t.groupKey!, t.total]));
  const rolled = rollup(nodes, direct, ctx.base);

  const out: BreakdownRow[] = nodes
    .filter((node) => node.kind === kind)
    .map((node) => ({
      key: node.id,
      label: categoryPath(nodes, node.id),
      total: rolled.get(node.id) ?? Money.zero(ctx.base),
      entryCount: totals.find((t) => t.groupKey === node.id)?.entryCount ?? 0,
    }))
    .filter((row) => row.total.minor !== 0n);

  const uncategorised = totals.find((t) => t.groupKey === null);
  if (uncategorised) {
    out.push({
      key: null,
      label: 'Uncategorised',
      total: uncategorised.total,
      entryCount: uncategorised.entryCount,
    });
  }

  return out.sort((a, b) => (a.total.minor === b.total.minor ? 0 : a.total.minor > b.total.minor ? -1 : 1));
}

async function tagBreakdown(
  ctx: ReadCtx,
  range: DateRange,
  kind: Extract<TransactionKind, 'income' | 'expense'>,
): Promise<BreakdownRow[]> {
  const rows = await ctx.db
    .select({
      kind: transactions.kind,
      baseAmount: transactionEntries.baseAmount,
      tagId: tags.id,
      tagName: tags.name,
    })
    .from(transactionEntries)
    .innerJoin(transactions, eq(transactions.id, transactionEntries.transactionId))
    .innerJoin(transactionTags, eq(transactionTags.transactionId, transactions.id))
    .innerJoin(tags, eq(tags.id, transactionTags.tagId))
    .where(
      and(
        eq(transactions.userId, ctx.userId),
        // The filter that stops a tagged transfer being counted as spending.
        eq(transactions.kind, kind),
        sql`${transactions.bookedOn} >= ${range.from}`,
        sql`${transactions.bookedOn} <= ${range.to}`,
      ),
    );

  const labels = new Map(rows.map((r) => [r.tagId, r.tagName]));
  const totals = totalsByGroup(
    rows.map((r) => ({
      kind: r.kind,
      baseAmount: Money.fromDbString(r.baseAmount, ctx.base),
      groupKey: r.tagId,
    })),
    kind,
    ctx.base,
  );

  return totals.map((t) => ({
    key: t.groupKey,
    label: t.groupKey ? (labels.get(t.groupKey) ?? 'Unknown tag') : 'Untagged',
    total: t.total,
    entryCount: t.entryCount,
  }));
}

async function categoryNodes(ctx: ReadCtx): Promise<CategoryNode[]> {
  const rows = await ctx.db
    .select({
      id: categories.id,
      parentId: categories.parentId,
      name: categories.name,
      kind: categories.kind,
      isArchived: categories.isArchived,
      sortOrder: categories.sortOrder,
    })
    .from(categories)
    .where(eq(categories.userId, ctx.userId));
  return rows;
}

async function accountLabels(ctx: ReadCtx): Promise<Map<string, string>> {
  const rows = await ctx.db.execute<{ id: string; name: string }>(
    sql`select id, name from accounts where user_id = ${ctx.userId}`,
  );
  return new Map(rows.rows.map((r) => [r.id, r.name]));
}

export interface PeriodSeriesPoint {
  readonly range: DateRange;
  readonly summary: CashflowSummary;
}

/**
 * One summary per period across a span — the income/expense comparison bars on
 * the Overview, and the monthly table on the money page.
 */
export async function series(
  ctx: ReadCtx,
  span: DateRange,
  kind: PeriodKind,
): Promise<PeriodSeriesPoint[]> {
  const ranges = periodsBetween(span, kind, ctx.fiscalYearStartMonth);
  const points: PeriodSeriesPoint[] = [];
  for (const range of ranges) {
    points.push({ range, summary: await periodSummary(ctx, range) });
  }
  return points;
}

/**
 * Spending in one category subtree over a period, in base currency.
 *
 * This is the figure a budget compares against, and it is deliberately the same
 * code path as the breakdown above — a budget whose "actual" came from a second
 * query would eventually disagree with the category report on the same screen.
 */
export async function categorySpend(
  ctx: ReadCtx,
  range: DateRange,
  categoryIds: readonly string[],
): Promise<MoneyValue> {
  if (categoryIds.length === 0) return Money.zero(ctx.base);

  const rows = await entriesInRange(ctx, range, [inArray(transactions.categoryId, [...categoryIds])]);
  const summary = cashflow(toCashflowEntries(ctx, rows), ctx.base);
  return summary.expenses;
}

export interface PeriodProgress {
  readonly daysElapsed: number;
  readonly daysTotal: number;
}

export function progressThrough(range: DateRange, asOf: IsoDate): PeriodProgress {
  return elapsedInPeriod(range, asOf);
}
