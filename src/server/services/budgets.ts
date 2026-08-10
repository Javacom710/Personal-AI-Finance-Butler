import 'server-only';

/**
 * Budgets (FINANCIAL-DOMAIN.md §6).
 *
 * A budget is a category, a period kind and an amount. Its **actual** is the
 * spending in that category's subtree over the period, taken from the same code
 * path as the category breakdown — so the budget page and the spending page can
 * never show two different figures for the same category.
 *
 * Multi-currency: the budget amount is converted to base at the **period start**
 * rate and compared against actuals already summed in base. The conversion is
 * returned so the UI can show it rather than presenting a converted figure as
 * though it were the number the user typed.
 */

import { and, asc, eq } from 'drizzle-orm';

import { isoDate, type IsoDate } from '../../lib/date';
import { periodContaining, type DateRange, type PeriodKind } from '../../lib/date/periods';
import { currency, Money, toDbString, type CurrencyCode } from '../../lib/decimal/money';
import type { Rate } from '../../lib/decimal/rate';
import { conflict, err, insufficientData, notFound, ok, validationFailed, type DomainError, type Result } from '../../lib/result';
import { createBudgetSchema, updateBudgetSchema } from '../../lib/schemas/money';
import { budgetStatus, type BudgetStatus } from '../domain/calc/budget';
import { categoryPath, type CategoryNode } from '../domain/calc/categories';
import { budgets, categories } from '../db/schema';
import type { ReadCtx, WriteCtx } from './_ctx';
import { requireOwnership } from './_guards';
import { fieldErrors } from './_validation';
import { categorySubtree } from './categories';
import { categorySpend, progressThrough } from './cashflow';

export interface BudgetView {
  readonly id: string;
  readonly categoryId: string;
  readonly categoryLabel: string;
  readonly period: PeriodKind;
  /** As entered, in the budget's own currency. */
  readonly amount: Money;
  readonly currency: CurrencyCode;
  readonly startsOn: IsoDate;
  readonly endsOn: IsoDate | null;
  readonly isActive: boolean;

  readonly range: DateRange;
  readonly status: BudgetStatus;
  /** Set when the budget currency differs from base, so the UI can show the conversion. */
  readonly conversionRate: Rate | null;
}

export interface ListBudgetsOptions {
  readonly asOf?: IsoDate;
  readonly includeInactive?: boolean;
}

/**
 * Every budget with its status for the period containing `asOf`.
 *
 * A budget whose window has not started, or has ended, is reported with a zero
 * actual rather than being hidden: a budget that silently disappears near its
 * boundary is a budget the user believes is still running.
 */
export async function listBudgetStatuses(
  ctx: ReadCtx,
  options: ListBudgetsOptions = {},
): Promise<Result<BudgetView[], DomainError>> {
  const asOf = options.asOf ?? ctx.today;

  const rows = await ctx.db
    .select({
      id: budgets.id,
      categoryId: budgets.categoryId,
      period: budgets.period,
      amount: budgets.amount,
      currencyCode: budgets.currencyCode,
      startsOn: budgets.startsOn,
      endsOn: budgets.endsOn,
      isActive: budgets.isActive,
    })
    .from(budgets)
    .where(
      options.includeInactive
        ? eq(budgets.userId, ctx.userId)
        : and(eq(budgets.userId, ctx.userId), eq(budgets.isActive, true)),
    )
    .orderBy(asc(budgets.period));

  if (rows.length === 0) return ok([]);

  const nodes = await categoryNodes(ctx);

  const out: BudgetView[] = [];
  for (const row of rows) {
    const budgetCurrency = currency(row.currencyCode.trim());
    const amount = Money.fromDbString(row.amount, budgetCurrency);
    const range = periodContaining(asOf, row.period, ctx.fiscalYearStartMonth);

    // Converted at the **period start**, not today: a budget that moved because
    // an exchange rate moved mid-month would make yesterday's utilisation wrong.
    const converted = ctx.fx.toBase(amount, range.from);
    if (!converted.ok) {
      return err(
        insufficientData(
          'no_fx_rate',
          `No exchange rate from ${budgetCurrency} to ${ctx.base} on or before ${range.from}, so this budget cannot be compared with spending.`,
        ),
      );
    }

    const subtree = await categorySubtree(ctx, row.categoryId);
    const actual = await categorySpend(ctx, range, subtree);
    const progress = progressThrough(range, asOf);

    out.push({
      id: row.id,
      categoryId: row.categoryId,
      categoryLabel: categoryPath(nodes, row.categoryId),
      period: row.period,
      amount,
      currency: budgetCurrency,
      startsOn: isoDate(row.startsOn),
      endsOn: row.endsOn ? isoDate(row.endsOn) : null,
      isActive: row.isActive,
      range,
      status: budgetStatus({
        budgeted: converted.value.amount,
        actual,
        daysElapsed: progress.daysElapsed,
        daysTotal: progress.daysTotal,
      }),
      conversionRate: budgetCurrency === ctx.base ? null : converted.value.rate,
    });
  }

  return ok(out);
}

async function categoryNodes(ctx: ReadCtx): Promise<CategoryNode[]> {
  return ctx.db
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
}

// ------------------------------------------------------------------- commands

export async function createBudget(ctx: WriteCtx, raw: unknown): Promise<Result<string, DomainError>> {
  const parsed = createBudgetSchema.safeParse(raw);
  if (!parsed.success) return err(fieldErrors(parsed.error));
  const input = parsed.data;

  const [category] = await ctx.tx
    .select({ id: categories.id, userId: categories.userId, kind: categories.kind, name: categories.name })
    .from(categories)
    .where(eq(categories.id, input.categoryId))
    .limit(1);

  const owned = requireOwnership(category, ctx.userId, 'category', input.categoryId);
  if (!owned.ok) return owned;

  if (owned.value.kind !== 'expense') {
    return err(
      validationFailed({
        categoryId: [`${owned.value.name} is an income category. Budgets apply to spending.`],
      }),
    );
  }

  const budgetCurrency = currency(input.currencyCode);
  const amount = Money.parseUserInput(input.amount, budgetCurrency);
  if (!amount.ok) return err(validationFailed({ amount: [amount.error.message] }));
  if (amount.value.minor <= 0n) {
    // Edge case 9: a zero budget is rejected at creation. `budgetStatus` stays
    // null-safe regardless, because a row could still arrive by another route.
    return err(validationFailed({ amount: ['A budget must be greater than zero.'] }));
  }

  // One active budget per (category, period): a partial unique index enforces
  // it, and checking first turns the constraint into a sentence.
  const [existing] = await ctx.tx
    .select({ id: budgets.id })
    .from(budgets)
    .where(
      and(
        eq(budgets.userId, ctx.userId),
        eq(budgets.categoryId, input.categoryId),
        eq(budgets.period, input.period),
        eq(budgets.isActive, true),
      ),
    )
    .limit(1);

  if (existing) {
    return err(
      conflict(`There is already an active ${input.period} budget for ${owned.value.name}. Edit it instead.`),
    );
  }

  const [inserted] = await ctx.tx
    .insert(budgets)
    .values({
      userId: ctx.userId,
      categoryId: input.categoryId,
      period: input.period,
      amount: toDbString(amount.value),
      currencyCode: budgetCurrency,
      startsOn: input.startsOn,
      endsOn: input.endsOn ?? null,
    })
    .returning({ id: budgets.id });

  if (!inserted) throw new Error('Insert of a budget returned no row.');

  await ctx.audit.record({
    actor: 'user',
    action: 'budget.create',
    entityType: 'budget',
    entityId: inserted.id,
    after: { categoryId: input.categoryId, period: input.period, amount: toDbString(amount.value) },
  });

  return ok(inserted.id);
}

export async function updateBudget(
  ctx: WriteCtx,
  id: string,
  raw: unknown,
): Promise<Result<void, DomainError>> {
  const parsed = updateBudgetSchema.safeParse(raw);
  if (!parsed.success) return err(fieldErrors(parsed.error));

  const [existing] = await ctx.tx.select().from(budgets).where(eq(budgets.id, id)).limit(1);
  const owned = requireOwnership(existing, ctx.userId, 'budget', id);
  if (!owned.ok) return owned;

  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if (parsed.data.amount !== undefined) {
    const budgetCurrency = currency(owned.value.currencyCode.trim());
    const amount = Money.parseUserInput(parsed.data.amount, budgetCurrency);
    if (!amount.ok) return err(validationFailed({ amount: [amount.error.message] }));
    if (amount.value.minor <= 0n) {
      return err(validationFailed({ amount: ['A budget must be greater than zero.'] }));
    }
    patch['amount'] = toDbString(amount.value);
  }

  if (parsed.data.endsOn !== undefined) patch['endsOn'] = parsed.data.endsOn ?? null;
  if (parsed.data.isActive !== undefined) patch['isActive'] = parsed.data.isActive;

  await ctx.tx.update(budgets).set(patch).where(eq(budgets.id, id));

  await ctx.audit.record({
    actor: 'user',
    action: 'budget.update',
    entityType: 'budget',
    entityId: id,
    before: owned.value,
    after: patch,
  });

  return ok(undefined);
}

export async function deleteBudget(ctx: WriteCtx, id: string): Promise<Result<void, DomainError>> {
  const [existing] = await ctx.tx.select().from(budgets).where(eq(budgets.id, id)).limit(1);
  const owned = requireOwnership(existing, ctx.userId, 'budget', id);
  if (!owned.ok) return owned;

  await ctx.tx.delete(budgets).where(eq(budgets.id, id));
  await ctx.audit.record({
    actor: 'user',
    action: 'budget.delete',
    entityType: 'budget',
    entityId: id,
    before: owned.value,
  });

  return ok(undefined);
}

export async function getBudget(ctx: ReadCtx, id: string): Promise<Result<BudgetView, DomainError>> {
  const all = await listBudgetStatuses(ctx, { includeInactive: true });
  if (!all.ok) return all;
  const found = all.value.find((b) => b.id === id);
  return found ? ok(found) : err(notFound('budget', id));
}

/** Count of budgets over their limit — the Overview's one-line anomaly. */
export async function overBudgetCount(ctx: ReadCtx): Promise<number> {
  const all = await listBudgetStatuses(ctx);
  if (!all.ok) return 0;
  return all.value.filter((b) => b.status.isOverBudget).length;
}
