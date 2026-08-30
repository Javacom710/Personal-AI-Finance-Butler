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
import { Money, sum as moneySum, type CurrencyCode, type Money as MoneyValue } from '../../lib/decimal/money';
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
import { categoryPath, foldToRoots, type CategoryNode } from '../domain/calc/categories';
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

/**
 * Which set of rows a category breakdown returns. Both partition the total.
 *
 * - `'rollup'` — one row per **top-level** category, its children folded in.
 *   `Food` is one row worth ₹600; `Food › Dining` does not appear separately.
 * - `'detail'` — one row per category with spending **of its own**. `Food`
 *   appears only if something was booked directly to it, and then carries only
 *   that amount, not its children's.
 *
 * Ignored for `tag` and `account`, which have no hierarchy.
 */
export type BreakdownDepth = 'rollup' | 'detail';

/**
 * Whether `Σ rows[].total === total`.
 *
 * - `'partition'` — the rows partition the total exactly. Safe to sum, safe to
 *   render as parts of a whole.
 * - `'overlapping'` — one transaction can appear under several rows, and rows
 *   with no key are absent entirely. **The rows do not sum to `total` and must
 *   never be presented as if they did.** Tag breakdowns are this: a transaction
 *   carrying both `#travel` and `#work` contributes its full amount to each, and
 *   an untagged transaction contributes to neither.
 */
export type BreakdownAdditivity = 'partition' | 'overlapping';

export interface BreakdownRow {
  readonly key: string | null;
  readonly label: string;
  readonly total: MoneyValue;
  readonly entryCount: number;
  /** The parent category, when this row is a child. `null` at top level and for tag/account rows. */
  readonly parentKey: string | null;
  /** True when `total` includes descendants' spending as well as this row's own. */
  readonly isRollup: boolean;
  /** How many descendant categories were folded into `total`. `0` unless `isRollup`. */
  readonly childCount: number;
}

/**
 * A breakdown, and the contract for reading it
 * ([ADR-37](../../../docs/DECISIONS.md#adr-37--a-breakdown-declares-whether-its-rows-partition-its-total)).
 *
 * **This is a structure, not an array, on purpose.** The old signature returned
 * `BreakdownRow[]` containing *both* `Food` (rolled up) and `Food › Dining`
 * (its child), each with a total. Summing that array double-counted every
 * parent/child pair, and nothing in the type said so — the project's own golden
 * test worked around it by filtering on the `›` in the label. That was finding
 * **F-3**, and it mattered most for the AI tool layer, where the row set would
 * have reached a model with no way to tell which rows were safe to add.
 *
 * Now: `total` is the authoritative figure, computed by the engine over the same
 * entries as `periodSummary`, and every row set either partitions it or says it
 * does not. There is no shape in which summing every row silently double-counts.
 */
export interface Breakdown {
  readonly groupBy: GroupBy;
  readonly kind: Extract<TransactionKind, 'income' | 'expense'>;
  readonly depth: BreakdownDepth;
  readonly additivity: BreakdownAdditivity;
  /**
   * The period total for `kind`, in base currency — the answer to "how much did
   * I spend", already computed. A consumer never has to add the rows to get it,
   * which is the point: the engine calculates, the caller reports.
   */
  readonly total: MoneyValue;
  readonly rows: readonly BreakdownRow[];
}

/**
 * `Σ rows[].total` — exported so the property can be asserted rather than
 * assumed, by tests and by a Phase 7 tool projection alike.
 */
export function sumRows(rows: readonly BreakdownRow[], base: CurrencyCode): MoneyValue {
  return moneySum(
    rows.map((r) => r.total),
    base,
  );
}

/**
 * Totals by category, tag or account for **one** kind.
 *
 * `kind` is required, and for tags that is load-bearing: tags are allowed on
 * transfers (FINANCIAL-DOMAIN.md §5), so a tag report without the filter would
 * count both legs of every tagged transfer as spending — a silent double count
 * of exactly the sort the entry-based ledger exists to prevent.
 *
 * See {@link Breakdown} for what the returned rows do and do not guarantee.
 */
export async function breakdown(
  ctx: ReadCtx,
  range: DateRange,
  groupBy: GroupBy,
  kind: Extract<TransactionKind, 'income' | 'expense'>,
  depth: BreakdownDepth = 'rollup',
): Promise<Breakdown> {
  const entries = await entriesInRange(ctx, range);
  // The authoritative figure, over the same rows every other branch reduces.
  // Deriving it here rather than from the row set is what makes `total` true
  // even when the rows deliberately do not sum to it.
  const summary =
    entries.length === 0 ? emptyCashflow(ctx.base) : cashflow(toCashflowEntries(ctx, entries), ctx.base);
  const total = kind === 'expense' ? summary.expenses : summary.income;

  if (groupBy === 'tag') {
    return {
      groupBy,
      kind,
      depth,
      // Not a partition, and the type says so rather than a comment saying so.
      additivity: 'overlapping',
      total,
      rows: await tagBreakdown(ctx, range, kind),
    };
  }

  const grouped: GroupedEntry[] = entries.map((row) => ({
    kind: row.kind,
    baseAmount: Money.fromDbString(row.baseAmount, ctx.base),
    groupKey: groupBy === 'category' ? row.categoryId : row.accountId,
  }));

  const totals = totalsByGroup(grouped, kind, ctx.base);
  const uncategorised = totals.find((t) => t.groupKey === null);

  const flat = (rows: BreakdownRow[]): Breakdown => ({
    groupBy,
    kind,
    depth,
    additivity: 'partition',
    total,
    rows: sortByTotal(rows),
  });

  if (groupBy === 'account') {
    const labels = await accountLabels(ctx);
    return flat(
      totals.map((t) => ({
        key: t.groupKey,
        label: t.groupKey ? (labels.get(t.groupKey) ?? 'Unknown account') : 'Unknown account',
        total: t.total,
        entryCount: t.entryCount,
        parentKey: null,
        isRollup: false,
        childCount: 0,
      })),
    );
  }

  const nodes = await categoryNodes(ctx);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const direct = new Map(totals.filter((t) => t.groupKey !== null).map((t) => [t.groupKey!, t.total]));
  const counts = new Map(totals.filter((t) => t.groupKey !== null).map((t) => [t.groupKey!, t.entryCount]));

  const rows: BreakdownRow[] =
    depth === 'detail'
      ? // One row per category with spending of its own, carrying only that
        // spending. A parent with direct entries appears beside its children
        // and is not a rollup, so the rows still partition the total.
        [...direct].map(([id, amount]) => ({
          key: id,
          label: categoryPath(nodes, id),
          total: amount,
          entryCount: counts.get(id) ?? 0,
          parentKey: byId.get(id)?.parentId ?? null,
          isRollup: false,
          childCount: 0,
        }))
      : // One row per top-level category, children folded in. Each amount is
        // counted once, at exactly one root.
        foldToRoots(nodes, direct, ctx.base).map((fold) => {
          // Descendants only. `foldedIds` contains the root itself *only when
          // the root had direct spending of its own*, so counting it as
          // `length - 1` would undercount a parent whose children were the only
          // things spent on — the commonest shape there is.
          const children = fold.foldedIds.filter((id) => id !== fold.rootId).length;
          return {
            key: fold.rootId,
            label: categoryPath(nodes, fold.rootId),
            total: fold.total,
            entryCount: fold.foldedIds.reduce((n, id) => n + (counts.get(id) ?? 0), 0),
            parentKey: null,
            isRollup: children > 0,
            childCount: children,
          };
        });

  if (uncategorised) {
    rows.push({
      key: null,
      label: 'Uncategorised',
      total: uncategorised.total,
      entryCount: uncategorised.entryCount,
      parentKey: null,
      isRollup: false,
      childCount: 0,
    });
  }

  return flat(rows.filter((row) => row.total.minor !== 0n));
}

const sortByTotal = (rows: readonly BreakdownRow[]): BreakdownRow[] =>
  [...rows].sort((a, b) => (a.total.minor === b.total.minor ? 0 : a.total.minor > b.total.minor ? -1 : 1));

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
    parentKey: null,
    isRollup: false,
    childCount: 0,
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
