import 'server-only';

/**
 * Categories (FINANCIAL-DOMAIN.md §5).
 *
 * A category answers "what kind of money movement is this", exactly one per
 * transaction, and it drives budgets and reporting. Two levels maximum, a child
 * shares its parent's kind, and **a category in use cannot be deleted** — it is
 * archived, which hides it from pickers while keeping it in historical reports.
 *
 * The tree arithmetic (rollup, subtree, path) is in the engine; this file
 * fetches rows and enforces the lifecycle.
 */

import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { conflict, err, ok, type DomainError, type Result } from '../../lib/result';
import {
  createCategorySchema,
  updateCategorySchema,
  type CreateCategoryInput,
} from '../../lib/schemas/money';
import { buildTree, categoryPath, subtreeIds, type CategoryNode, type CategoryTreeNode } from '../domain/calc/categories';
import type { CategoryKind } from '../domain/ledger/entries';
import { budgets, categories, transactions } from '../db/schema';
import type { ReadCtx, WriteCtx } from './_ctx';
import { requireOwnership } from './_guards';
import { fieldErrors } from './_validation';

export interface CategoryView extends CategoryNode {
  readonly path: string;
  readonly transactionCount: number;
}

export interface ListCategoriesOptions {
  readonly kind?: CategoryKind;
  readonly includeArchived?: boolean;
  readonly withCounts?: boolean;
}

export async function listCategories(
  ctx: ReadCtx,
  options: ListCategoriesOptions = {},
): Promise<CategoryView[]> {
  const conditions = [eq(categories.userId, ctx.userId)];
  if (options.kind) conditions.push(eq(categories.kind, options.kind));
  if (!options.includeArchived) conditions.push(eq(categories.isArchived, false));

  const rows = await ctx.db
    .select()
    .from(categories)
    .where(and(...conditions))
    .orderBy(asc(categories.sortOrder), asc(categories.name));

  const nodes: CategoryNode[] = rows.map((row) => ({
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    kind: row.kind,
    isArchived: row.isArchived,
    sortOrder: row.sortOrder,
  }));

  const counts = options.withCounts ? await transactionCounts(ctx) : new Map<string, number>();

  return nodes.map((node) => ({
    ...node,
    path: categoryPath(nodes, node.id),
    transactionCount: counts.get(node.id) ?? 0,
  }));
}

/** The two-level tree, for pickers and the categories page. */
export async function categoryTree(
  ctx: ReadCtx,
  options: ListCategoriesOptions = {},
): Promise<CategoryTreeNode[]> {
  return buildTree(await listCategories(ctx, options));
}

async function transactionCounts(ctx: ReadCtx): Promise<Map<string, number>> {
  const rows = await ctx.db
    .select({ categoryId: transactions.categoryId, n: sql<number>`count(*)::int` })
    .from(transactions)
    .where(eq(transactions.userId, ctx.userId))
    .groupBy(transactions.categoryId);

  return new Map(rows.filter((r) => r.categoryId !== null).map((r) => [r.categoryId!, r.n]));
}

/**
 * A category and its children, as an id list.
 *
 * This is what a category report filters on: asking for `Food` must include
 * `Groceries` and `Dining`. Archived children are included deliberately —
 * archiving hides a category from pickers, not from history.
 */
export async function categorySubtree(ctx: ReadCtx, rootId: string): Promise<string[]> {
  const rows = await ctx.db
    .select({ id: categories.id, parentId: categories.parentId })
    .from(categories)
    .where(eq(categories.userId, ctx.userId));

  return [
    ...subtreeIds(
      rows.map((r) => ({
        id: r.id,
        parentId: r.parentId,
        name: '',
        kind: 'expense' as const,
        isArchived: false,
        sortOrder: 0,
      })),
      rootId,
    ),
  ];
}

export async function getCategory(
  ctx: ReadCtx,
  id: string,
): Promise<Result<CategoryView, DomainError>> {
  const [row] = await ctx.db.select().from(categories).where(eq(categories.id, id)).limit(1);
  const owned = requireOwnership(row, ctx.userId, 'category', id);
  if (!owned.ok) return owned;

  const all = await listCategories(ctx, { includeArchived: true });
  const found = all.find((c) => c.id === id);
  return found ? ok(found) : err({ code: 'not_found', entity: 'category', id, message: 'category not found' });
}

// ------------------------------------------------------------------- commands

export async function createCategory(
  ctx: WriteCtx,
  raw: unknown,
): Promise<Result<CategoryView, DomainError>> {
  const parsed = createCategorySchema.safeParse(raw);
  if (!parsed.success) return err(fieldErrors(parsed.error));
  const input: CreateCategoryInput = parsed.data;

  if (input.parentId) {
    const [parent] = await ctx.tx
      .select()
      .from(categories)
      .where(eq(categories.id, input.parentId))
      .limit(1);

    const owned = requireOwnership(parent, ctx.userId, 'category', input.parentId);
    if (!owned.ok) return owned;

    // Both rules are also enforced by `check_category_shape()`. Checking here
    // turns a constraint failure into a message beside the right field.
    if (owned.value.parentId !== null) {
      return err(
        fieldErrors({
          issues: [{ path: ['parentId'], message: 'Categories go two levels deep. Choose a top-level parent.' }],
        }),
      );
    }
    if (owned.value.kind !== input.kind) {
      return err(
        fieldErrors({
          issues: [
            { path: ['kind'], message: `${owned.value.name} is an ${owned.value.kind} category, so its children are too.` },
          ],
        }),
      );
    }
  }

  const duplicate = await ctx.tx
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.userId, ctx.userId),
        eq(categories.name, input.name),
        input.parentId
          ? eq(categories.parentId, input.parentId)
          : sql`${categories.parentId} is null`,
      ),
    )
    .limit(1);

  if (duplicate.length > 0) {
    return err(conflict(`A category named "${input.name}" already exists here.`));
  }

  const [inserted] = await ctx.tx
    .insert(categories)
    .values({
      userId: ctx.userId,
      name: input.name,
      kind: input.kind,
      parentId: input.parentId ?? null,
      sortOrder: input.sortOrder ?? 500,
    })
    .returning();

  if (!inserted) throw new Error('Insert of a category returned no row.');

  await ctx.audit.record({
    actor: 'user',
    action: 'category.create',
    entityType: 'category',
    entityId: inserted.id,
    after: inserted,
  });

  return getCategory(ctx, inserted.id);
}

export async function updateCategory(
  ctx: WriteCtx,
  id: string,
  raw: unknown,
): Promise<Result<CategoryView, DomainError>> {
  const parsed = updateCategorySchema.safeParse(raw);
  if (!parsed.success) return err(fieldErrors(parsed.error));

  const [existing] = await ctx.tx.select().from(categories).where(eq(categories.id, id)).limit(1);
  const owned = requireOwnership(existing, ctx.userId, 'category', id);
  if (!owned.ok) return owned;

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) patch['name'] = parsed.data.name;
  if (parsed.data.isArchived !== undefined) patch['isArchived'] = parsed.data.isArchived;
  if (parsed.data.sortOrder !== undefined) patch['sortOrder'] = parsed.data.sortOrder;

  // The kind is not editable. Changing it would reclassify every transaction
  // already filed under it, turning past income into past spending.
  await ctx.tx.update(categories).set(patch).where(eq(categories.id, id));

  await ctx.audit.record({
    actor: 'user',
    action: 'category.update',
    entityType: 'category',
    entityId: id,
    before: owned.value,
    after: { ...owned.value, ...patch },
  });

  return getCategory(ctx, id);
}

/**
 * Delete a category that nothing refers to.
 *
 * `ON DELETE RESTRICT` on `transactions.category_id` would refuse it anyway;
 * refusing here names the alternative (FINANCIAL-DOMAIN.md §12, case 6). A
 * parent with children is refused for the same reason.
 */
export async function deleteCategory(ctx: WriteCtx, id: string): Promise<Result<void, DomainError>> {
  const [existing] = await ctx.tx.select().from(categories).where(eq(categories.id, id)).limit(1);
  const owned = requireOwnership(existing, ctx.userId, 'category', id);
  if (!owned.ok) return owned;

  const [used] = await ctx.tx
    .select({ n: sql<number>`count(*)::int` })
    .from(transactions)
    .where(eq(transactions.categoryId, id));

  if ((used?.n ?? 0) > 0) {
    return err(
      conflict(
        `${owned.value.name} classifies ${used!.n} transaction${used!.n === 1 ? '' : 's'} and cannot be deleted. Archive it instead — it stays in past reports and disappears from pickers.`,
      ),
    );
  }

  const [children] = await ctx.tx
    .select({ n: sql<number>`count(*)::int` })
    .from(categories)
    .where(eq(categories.parentId, id));

  if ((children?.n ?? 0) > 0) {
    return err(conflict(`${owned.value.name} has subcategories. Delete or move them first.`));
  }

  const [budgeted] = await ctx.tx
    .select({ n: sql<number>`count(*)::int` })
    .from(budgets)
    .where(eq(budgets.categoryId, id));

  if ((budgeted?.n ?? 0) > 0) {
    return err(conflict(`${owned.value.name} has a budget. Remove the budget first.`));
  }

  await ctx.tx.delete(categories).where(eq(categories.id, id));
  await ctx.audit.record({
    actor: 'user',
    action: 'category.delete',
    entityType: 'category',
    entityId: id,
    before: owned.value,
  });

  return ok(undefined);
}

/** Resolve several ids at once, for the transaction list's category column. */
export async function categoriesByIds(
  ctx: ReadCtx,
  ids: readonly string[],
): Promise<Map<string, { readonly name: string; readonly kind: CategoryKind }>> {
  if (ids.length === 0) return new Map();
  const rows = await ctx.db
    .select({ id: categories.id, name: categories.name, kind: categories.kind })
    .from(categories)
    .where(and(eq(categories.userId, ctx.userId), inArray(categories.id, [...ids])));
  return new Map(rows.map((r) => [r.id, { name: r.name, kind: r.kind }]));
}
