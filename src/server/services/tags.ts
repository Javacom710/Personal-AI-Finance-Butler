import 'server-only';

/**
 * Tags (FINANCIAL-DOMAIN.md §5).
 *
 * A tag answers "what was this for", zero to eight per transaction, and it
 * **drives nothing but filtering**. A tag can never change a number — only which
 * rows you are looking at.
 *
 * Two behaviours here are deliberate and easy to get wrong:
 *
 * - **Case-insensitive identity.** `Travel` and `travel` are one tag, enforced
 *   by a unique index on `lower(name)`. The name is stored as the user typed it.
 * - **Renaming onto an existing name is a merge, not an error.** The rows move,
 *   duplicates collapse, and the emptied tag is deleted — so one transaction can
 *   never hold the same tag twice.
 *
 * Tags attach to the transaction **header**, never to an entry: a transfer's two
 * legs share one tag set, because the tag describes the event.
 */

import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { err, ok, type DomainError, type Result } from '../../lib/result';
import { tagNameSchema } from '../../lib/schemas/money';
import { tags, transactionTags } from '../db/schema';
import type { ReadCtx, WriteCtx } from './_ctx';
import { requireOwnership } from './_guards';
import { fieldErrors } from './_validation';

export interface TagView {
  readonly id: string;
  readonly name: string;
  readonly transactionCount: number;
}

export async function listTags(ctx: ReadCtx): Promise<TagView[]> {
  const rows = await ctx.db
    .select({
      id: tags.id,
      name: tags.name,
      n: sql<number>`count(${transactionTags.transactionId})::int`,
    })
    .from(tags)
    .leftJoin(transactionTags, eq(transactionTags.tagId, tags.id))
    .where(eq(tags.userId, ctx.userId))
    .groupBy(tags.id, tags.name)
    .orderBy(asc(tags.name));

  return rows.map((r) => ({ id: r.id, name: r.name, transactionCount: r.n }));
}

/**
 * Resolve tag names to ids, creating any that do not exist.
 *
 * Tags are created implicitly on first use — there is no "manage tags" step
 * before one can be applied. Matching is case-insensitive, so typing `travel`
 * after having used `Travel` reuses the existing tag rather than splitting the
 * reports in two.
 */
export async function resolveTags(
  ctx: WriteCtx,
  names: readonly string[],
): Promise<Result<string[], DomainError>> {
  if (names.length === 0) return ok([]);

  const normalised: string[] = [];
  for (const raw of names) {
    const parsed = tagNameSchema.safeParse(raw);
    if (!parsed.success) return err(fieldErrors(parsed.error));
    normalised.push(parsed.data);
  }

  // De-duplicate case-insensitively before touching the database: two spellings
  // of one tag in the same submission must not become two inserts.
  const wanted = new Map<string, string>();
  for (const name of normalised) {
    if (!wanted.has(name.toLowerCase())) wanted.set(name.toLowerCase(), name);
  }

  const existing = await ctx.tx
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(
      and(
        eq(tags.userId, ctx.userId),
        inArray(sql`lower(${tags.name})`, [...wanted.keys()]),
      ),
    );

  const ids: string[] = [];
  const found = new Set<string>();
  for (const row of existing) {
    found.add(row.name.toLowerCase());
    ids.push(row.id);
  }

  const missing = [...wanted.entries()].filter(([key]) => !found.has(key)).map(([, name]) => name);
  if (missing.length > 0) {
    const inserted = await ctx.tx
      .insert(tags)
      .values(missing.map((name) => ({ userId: ctx.userId, name })))
      .returning({ id: tags.id });
    ids.push(...inserted.map((r) => r.id));
  }

  return ok(ids);
}

/** Replace a transaction's tag set. Called by create and update; never partially applied. */
export async function setTransactionTags(
  ctx: WriteCtx,
  transactionId: string,
  names: readonly string[],
): Promise<Result<void, DomainError>> {
  const resolved = await resolveTags(ctx, names);
  if (!resolved.ok) return resolved;

  await ctx.tx.delete(transactionTags).where(eq(transactionTags.transactionId, transactionId));

  if (resolved.value.length > 0) {
    await ctx.tx
      .insert(transactionTags)
      .values(resolved.value.map((tagId) => ({ transactionId, tagId })))
      .onConflictDoNothing();
  }

  return ok(undefined);
}

/**
 * Rename a tag, merging when the new name already exists.
 *
 * The merge reassigns `transaction_tags` rows, collapses the duplicates a
 * transaction carrying both tags would produce, and deletes the emptied tag.
 * `ON CONFLICT DO NOTHING` against the composite primary key is what makes the
 * collapse exact rather than a count that has to be reconciled afterwards.
 */
export async function renameTag(
  ctx: WriteCtx,
  id: string,
  rawName: string,
): Promise<Result<{ readonly id: string; readonly merged: boolean }, DomainError>> {
  const parsed = tagNameSchema.safeParse(rawName);
  if (!parsed.success) return err(fieldErrors(parsed.error));
  const name = parsed.data;

  const [existing] = await ctx.tx.select().from(tags).where(eq(tags.id, id)).limit(1);
  const owned = requireOwnership(existing, ctx.userId, 'tag', id);
  if (!owned.ok) return owned;

  const [target] = await ctx.tx
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.userId, ctx.userId), sql`lower(${tags.name}) = ${name.toLowerCase()}`))
    .limit(1);

  if (target && target.id !== id) {
    // INSERT … SELECT … ON CONFLICT DO NOTHING: a transaction already carrying
    // the target tag keeps exactly one row, and the count needs no reconciling.
    await ctx.tx.execute(sql`
      insert into ${transactionTags} (transaction_id, tag_id)
      select tt.transaction_id, ${target.id}::uuid
        from ${transactionTags} tt
       where tt.tag_id = ${id}
      on conflict do nothing
    `);

    await ctx.tx.delete(tags).where(eq(tags.id, id));

    await ctx.audit.record({
      actor: 'user',
      action: 'tag.merge',
      entityType: 'tag',
      entityId: id,
      before: owned.value,
      after: { mergedInto: target.id, name },
    });

    return ok({ id: target.id, merged: true });
  }

  await ctx.tx.update(tags).set({ name }).where(eq(tags.id, id));
  await ctx.audit.record({
    actor: 'user',
    action: 'tag.rename',
    entityType: 'tag',
    entityId: id,
    before: owned.value,
    after: { name },
  });

  return ok({ id, merged: false });
}

/**
 * Delete a tag.
 *
 * Allowed at any time. Cascades to `transaction_tags` only — the transactions
 * themselves are untouched, because a tag has never affected a number. This is
 * the opposite of a category, which is `RESTRICT` precisely because it does.
 */
export async function deleteTag(ctx: WriteCtx, id: string): Promise<Result<void, DomainError>> {
  const [existing] = await ctx.tx.select().from(tags).where(eq(tags.id, id)).limit(1);
  const owned = requireOwnership(existing, ctx.userId, 'tag', id);
  if (!owned.ok) return owned;

  await ctx.tx.delete(tags).where(eq(tags.id, id));
  await ctx.audit.record({
    actor: 'user',
    action: 'tag.delete',
    entityType: 'tag',
    entityId: id,
    before: owned.value,
  });

  return ok(undefined);
}
