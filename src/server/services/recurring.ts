import 'server-only';

/**
 * Recurring transactions (FINANCIAL-DOMAIN.md §7, ADR-15).
 *
 * ## Why this cannot double-post
 *
 * "Did the rent get posted twice?" is the single most damaging routine bug in a
 * personal finance application, and a `last_posted_on` timestamp does not
 * prevent it under a retry, a duplicate cron fire, or a clock adjustment. Two
 * mechanisms do:
 *
 * 1. **`UNIQUE (rule_id, due_on)`.** Materialising an occurrence is an
 *    `INSERT … ON CONFLICT DO NOTHING`, so a second run inserts nothing.
 * 2. **A compare-and-swap claim.** Posting first runs
 *    `UPDATE … SET status='posted' WHERE id = ? AND status = 'pending'`. Under
 *    two concurrent runners the second blocks on the row lock, re-evaluates the
 *    condition after the first commits, matches nothing, and stops. The
 *    transaction is created *after* the claim and inside the same database
 *    transaction, so a failure rolls the claim back with it.
 *
 * `auto_post = false` (the default) leaves the occurrence `pending` for
 * one-click posting. Amounts that vary — a utility bill — should stay manual.
 */

import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { addDays, compareDates, isoDate, maxDate, type IsoDate } from '../../lib/date';
import { parseRrule, describeRrule, type Rrule } from '../../lib/date/rrule';
import { err, notFound, ok, type DomainError, type Result } from '../../lib/result';
import {
  createRecurringRuleSchema,
  updateRecurringRuleSchema,
  type RecurringTemplate,
} from '../../lib/schemas/money';
import { dueDates, nextDue, type RecurringRuleSpec } from '../domain/calc/recurrence';
import { recurringOccurrences, recurringRules } from '../db/schema';
import { createAuditWriter } from './_audit';
import type { ReadCtx, WriteCtx } from './_ctx';
import { requireOwnership } from './_guards';
import { fieldErrors } from './_validation';
import { createTransaction } from './transactions';
import { createTransfer } from './transfers';

export type RecurringKind = 'income' | 'expense' | 'transfer';
export type OccurrenceStatus = 'pending' | 'posted' | 'skipped';

/** How far ahead occurrences are materialised, so upcoming commitments are visible. */
export const DEFAULT_HORIZON_DAYS = 60;

export interface RecurringRuleView {
  readonly id: string;
  readonly name: string;
  readonly kind: RecurringKind;
  readonly template: RecurringTemplate;
  readonly rrule: string;
  readonly rruleDescription: string;
  readonly startsOn: IsoDate;
  readonly endsOn: IsoDate | null;
  readonly autoPost: boolean;
  readonly isActive: boolean;
  readonly nextDueOn: IsoDate | null;
}

export interface OccurrenceView {
  readonly id: string;
  readonly ruleId: string;
  readonly ruleName: string;
  readonly kind: RecurringKind;
  readonly dueOn: IsoDate;
  readonly status: OccurrenceStatus;
  readonly transactionId: string | null;
  readonly amountText: string;
  readonly autoPost: boolean;
}

interface RuleRow {
  id: string;
  userId: string;
  name: string;
  kind: 'income' | 'expense' | 'transfer' | 'investment';
  template: unknown;
  rrule: string;
  startsOn: string;
  endsOn: string | null;
  autoPost: boolean;
  isActive: boolean;
}

/**
 * Parse a stored rule into the pure spec the engine consumes.
 *
 * A stored rrule that no longer parses is a data-integrity problem, not a
 * user-input problem: it was validated on the way in. It is reported as an
 * invariant violation rather than silently producing an empty schedule, because
 * an empty schedule looks exactly like "nothing is due".
 */
function toSpec(row: RuleRow): Result<{ spec: RecurringRuleSpec; rule: Rrule }, DomainError> {
  const parsed = parseRrule(row.rrule);
  if (!parsed.ok) {
    return err({
      code: 'invariant_violation',
      invariant: 'recurring_rules.rrule',
      message: `Rule "${row.name}" has an unreadable schedule (${parsed.error.message}). Edit it to fix the schedule.`,
    });
  }
  return ok({
    rule: parsed.value,
    spec: {
      rrule: parsed.value,
      startsOn: isoDate(row.startsOn),
      endsOn: row.endsOn ? isoDate(row.endsOn) : null,
      isActive: row.isActive,
    },
  });
}

function templateOf(row: RuleRow): RecurringTemplate {
  return row.template as RecurringTemplate;
}

// ----------------------------------------------------------------------- reads

export async function listRules(
  ctx: ReadCtx,
  options: { readonly includeInactive?: boolean } = {},
): Promise<RecurringRuleView[]> {
  const rows = (await ctx.db
    .select()
    .from(recurringRules)
    .where(
      options.includeInactive
        ? eq(recurringRules.userId, ctx.userId)
        : and(eq(recurringRules.userId, ctx.userId), eq(recurringRules.isActive, true)),
    )
    .orderBy(asc(recurringRules.name))) as RuleRow[];

  return rows.map((row) => {
    const spec = toSpec(row);
    const template = templateOf(row);
    return {
      id: row.id,
      name: row.name,
      kind: template.kind,
      template,
      rrule: row.rrule,
      rruleDescription: spec.ok ? describeRrule(spec.value.rule) : 'Unreadable schedule',
      startsOn: isoDate(row.startsOn),
      endsOn: row.endsOn ? isoDate(row.endsOn) : null,
      autoPost: row.autoPost,
      isActive: row.isActive,
      // From yesterday, so something due today still reads as "next".
      nextDueOn: spec.ok ? nextDue(spec.value.spec, addDays(ctx.today, -1)) : null,
    };
  });
}

export async function getRule(ctx: ReadCtx, id: string): Promise<Result<RecurringRuleView, DomainError>> {
  const [row] = (await ctx.db
    .select()
    .from(recurringRules)
    .where(eq(recurringRules.id, id))
    .limit(1)) as RuleRow[];

  const owned = requireOwnership(row, ctx.userId, 'recurring rule', id);
  if (!owned.ok) return owned;

  const all = await listRules(ctx, { includeInactive: true });
  const found = all.find((r) => r.id === id);
  return found ? ok(found) : err(notFound('recurring rule', id));
}

export interface ListOccurrencesOptions {
  readonly status?: OccurrenceStatus;
  readonly from?: IsoDate;
  readonly to?: IsoDate;
  readonly limit?: number;
}

export async function listOccurrences(
  ctx: ReadCtx,
  options: ListOccurrencesOptions = {},
): Promise<OccurrenceView[]> {
  const conditions = [eq(recurringRules.userId, ctx.userId)];
  if (options.status) conditions.push(eq(recurringOccurrences.status, options.status));
  if (options.from) conditions.push(sql`${recurringOccurrences.dueOn} >= ${options.from}`);
  if (options.to) conditions.push(sql`${recurringOccurrences.dueOn} <= ${options.to}`);

  const rows = await ctx.db
    .select({
      id: recurringOccurrences.id,
      ruleId: recurringOccurrences.ruleId,
      ruleName: recurringRules.name,
      template: recurringRules.template,
      autoPost: recurringRules.autoPost,
      dueOn: recurringOccurrences.dueOn,
      status: recurringOccurrences.status,
      transactionId: recurringOccurrences.transactionId,
    })
    .from(recurringOccurrences)
    .innerJoin(recurringRules, eq(recurringRules.id, recurringOccurrences.ruleId))
    .where(and(...conditions))
    .orderBy(asc(recurringOccurrences.dueOn))
    .limit(Math.min(Math.max(options.limit ?? 200, 1), 500));

  return rows.map((row) => {
    const template = row.template as RecurringTemplate;
    return {
      id: row.id,
      ruleId: row.ruleId,
      ruleName: row.ruleName,
      kind: template.kind,
      dueOn: isoDate(row.dueOn),
      status: row.status,
      transactionId: row.transactionId,
      amountText: template.amount,
      autoPost: row.autoPost,
    };
  });
}

/** Pending commitments in the next `days` days — the Overview strip. */
export async function upcomingCommitments(ctx: ReadCtx, days = 14): Promise<OccurrenceView[]> {
  return listOccurrences(ctx, {
    status: 'pending',
    from: ctx.today,
    to: addDays(ctx.today, days),
  });
}

// ------------------------------------------------------------------- commands

export async function createRule(ctx: WriteCtx, raw: unknown): Promise<Result<string, DomainError>> {
  const parsed = createRecurringRuleSchema.safeParse(raw);
  if (!parsed.success) return err(fieldErrors(parsed.error));
  const input = parsed.data;

  const [inserted] = await ctx.tx
    .insert(recurringRules)
    .values({
      userId: ctx.userId,
      name: input.name,
      kind: input.template.kind,
      template: input.template,
      rrule: input.rrule,
      startsOn: input.startsOn,
      endsOn: input.endsOn ?? null,
      autoPost: input.autoPost,
    })
    .returning({ id: recurringRules.id });

  if (!inserted) throw new Error('Insert of a recurring rule returned no row.');

  await ctx.audit.record({
    actor: 'user',
    action: 'recurring_rule.create',
    entityType: 'recurring_rule',
    entityId: inserted.id,
    after: { name: input.name, rrule: input.rrule, autoPost: input.autoPost },
  });

  return ok(inserted.id);
}

export async function updateRule(
  ctx: WriteCtx,
  id: string,
  raw: unknown,
): Promise<Result<void, DomainError>> {
  const parsed = updateRecurringRuleSchema.safeParse(raw);
  if (!parsed.success) return err(fieldErrors(parsed.error));

  const [existing] = (await ctx.tx
    .select()
    .from(recurringRules)
    .where(eq(recurringRules.id, id))
    .limit(1)) as RuleRow[];

  const owned = requireOwnership(existing, ctx.userId, 'recurring rule', id);
  if (!owned.ok) return owned;

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) patch['name'] = parsed.data.name;
  if (parsed.data.template !== undefined) {
    patch['template'] = parsed.data.template;
    patch['kind'] = parsed.data.template.kind;
  }
  if (parsed.data.rrule !== undefined) patch['rrule'] = parsed.data.rrule;
  if (parsed.data.endsOn !== undefined) patch['endsOn'] = parsed.data.endsOn ?? null;
  if (parsed.data.autoPost !== undefined) patch['autoPost'] = parsed.data.autoPost;
  if (parsed.data.isActive !== undefined) patch['isActive'] = parsed.data.isActive;

  await ctx.tx.update(recurringRules).set(patch).where(eq(recurringRules.id, id));

  // Changing the schedule invalidates occurrences that have not happened yet.
  // Posted ones are history and are left alone.
  if (parsed.data.rrule !== undefined || parsed.data.endsOn !== undefined) {
    await ctx.tx
      .delete(recurringOccurrences)
      .where(
        and(eq(recurringOccurrences.ruleId, id), eq(recurringOccurrences.status, 'pending')),
      );
  }

  await ctx.audit.record({
    actor: 'user',
    action: 'recurring_rule.update',
    entityType: 'recurring_rule',
    entityId: id,
    before: { name: owned.value.name, rrule: owned.value.rrule, autoPost: owned.value.autoPost },
    after: patch,
  });

  return ok(undefined);
}

/**
 * Delete a rule.
 *
 * Occurrences cascade, but transactions already posted do not: they are real
 * money movements, and `transactions.recurring_rule_id` is `ON DELETE SET NULL`
 * so they survive with their link cleared.
 */
export async function deleteRule(ctx: WriteCtx, id: string): Promise<Result<void, DomainError>> {
  const [existing] = (await ctx.tx
    .select()
    .from(recurringRules)
    .where(eq(recurringRules.id, id))
    .limit(1)) as RuleRow[];

  const owned = requireOwnership(existing, ctx.userId, 'recurring rule', id);
  if (!owned.ok) return owned;

  await ctx.tx.delete(recurringRules).where(eq(recurringRules.id, id));
  await ctx.audit.record({
    actor: 'user',
    action: 'recurring_rule.delete',
    entityType: 'recurring_rule',
    entityId: id,
    before: { name: owned.value.name, rrule: owned.value.rrule },
  });

  return ok(undefined);
}

// --------------------------------------------------------------- materialising

export interface MaterialiseResult {
  readonly created: number;
  readonly rulesConsidered: number;
}

/**
 * Create `pending` occurrence rows for everything due up to `today + horizon`.
 *
 * Expansion starts from the later of the rule's start date and the day after
 * the last occurrence already materialised, so a rule created with a start date
 * in the past catches up on its first run instead of losing that history — and a
 * rule that has been running for years does not re-expand from the beginning
 * every night.
 */
export async function materialiseOccurrences(
  ctx: WriteCtx,
  options: { readonly horizonDays?: number } = {},
): Promise<Result<MaterialiseResult, DomainError>> {
  const horizon = addDays(ctx.today, options.horizonDays ?? DEFAULT_HORIZON_DAYS);

  const rows = (await ctx.tx
    .select()
    .from(recurringRules)
    .where(and(eq(recurringRules.userId, ctx.userId), eq(recurringRules.isActive, true)))) as RuleRow[];

  if (rows.length === 0) return ok({ created: 0, rulesConsidered: 0 });

  const lastByRule = new Map<string, string>();
  const lastRows = await ctx.tx
    .select({ ruleId: recurringOccurrences.ruleId, lastDue: sql<string>`max(${recurringOccurrences.dueOn})::text` })
    .from(recurringOccurrences)
    .where(inArray(recurringOccurrences.ruleId, rows.map((r) => r.id)))
    .groupBy(recurringOccurrences.ruleId);

  for (const row of lastRows) {
    if (row.lastDue) lastByRule.set(row.ruleId, row.lastDue);
  }

  let created = 0;

  for (const row of rows) {
    const spec = toSpec(row);
    if (!spec.ok) continue; // Reported through listRules; one bad rule must not stop the rest.

    const startsOn = isoDate(row.startsOn);
    const last = lastByRule.get(row.id);
    const from = last ? maxDate(startsOn, isoDate(last)) : startsOn;

    if (compareDates(from, horizon) > 0) continue;

    const dates = dueDates(spec.value.spec, { from, to: horizon });
    if (dates.length === 0) continue;

    const inserted = await ctx.tx
      .insert(recurringOccurrences)
      .values(dates.map((dueOn) => ({ ruleId: row.id, dueOn, status: 'pending' as const })))
      // ADR-15: the idempotency key. A second run inserts nothing.
      .onConflictDoNothing()
      .returning({ id: recurringOccurrences.id });

    created += inserted.length;
  }

  return ok({ created, rulesConsidered: rows.length });
}

export type PostOutcome =
  | { readonly status: 'posted'; readonly transactionId: string }
  | { readonly status: 'already_settled' }
  | { readonly status: 'not_due'; readonly dueOn: IsoDate };

/** Carries a domain error out of a savepoint so the savepoint rolls back with it. */
class PostingFailed extends Error {
  constructor(readonly domainError: DomainError) {
    super(domainError.message);
    this.name = 'PostingFailed';
  }
}

/**
 * Post one occurrence.
 *
 * The claim happens **first**: `UPDATE … WHERE status = 'pending'` either
 * matches one row or matches none, so a concurrent runner that loses the race
 * writes nothing at all.
 *
 * Claim and posting share a **savepoint**, and that is load-bearing rather than
 * tidy. Returning an error from inside an open transaction does not undo the
 * writes already made in it: without the savepoint, a posting that failed —
 * a closed account, a missing FX rate — would leave the occurrence marked
 * `posted` with no transaction behind it, which is invariant I-9 violated and a
 * commitment silently never paid. The savepoint rolls the claim back with the
 * failure, so the occurrence stays `pending` and is retried.
 */
export async function postOccurrence(
  ctx: WriteCtx,
  occurrenceId: string,
  options: { readonly allowFuture?: boolean } = {},
): Promise<Result<PostOutcome, DomainError>> {
  const [row] = await ctx.tx
    .select({
      id: recurringOccurrences.id,
      ruleId: recurringOccurrences.ruleId,
      dueOn: recurringOccurrences.dueOn,
      status: recurringOccurrences.status,
      userId: recurringRules.userId,
      name: recurringRules.name,
      template: recurringRules.template,
    })
    .from(recurringOccurrences)
    .innerJoin(recurringRules, eq(recurringRules.id, recurringOccurrences.ruleId))
    .where(eq(recurringOccurrences.id, occurrenceId))
    .limit(1);

  const owned = requireOwnership(row, ctx.userId, 'occurrence', occurrenceId);
  if (!owned.ok) return owned;

  const dueOn = isoDate(owned.value.dueOn);
  if (!options.allowFuture && compareDates(dueOn, ctx.today) > 0) {
    return ok({ status: 'not_due', dueOn });
  }

  const template = owned.value.template as RecurringTemplate;

  try {
    return await ctx.tx.transaction(async (savepoint) => {
      const scoped: WriteCtx = {
        ...ctx,
        db: savepoint,
        tx: savepoint,
        audit: createAuditWriter(savepoint, ctx.userId, null),
      };

      const claimed = await savepoint
        .update(recurringOccurrences)
        .set({ status: 'posted', postedAt: ctx.now })
        .where(
          and(eq(recurringOccurrences.id, occurrenceId), eq(recurringOccurrences.status, 'pending')),
        )
        .returning({ id: recurringOccurrences.id });

      if (claimed.length === 0) return ok<PostOutcome>({ status: 'already_settled' });

      const created = await postFromTemplate(scoped, template, dueOn, owned.value.ruleId);
      if (!created.ok) throw new PostingFailed(created.error);

      await savepoint
        .update(recurringOccurrences)
        .set({ transactionId: created.value })
        .where(eq(recurringOccurrences.id, occurrenceId));

      await scoped.audit.record({
        actor: 'system',
        action: 'recurring_occurrence.post',
        entityType: 'recurring_occurrence',
        entityId: occurrenceId,
        after: { dueOn, transactionId: created.value, rule: owned.value.name },
      });

      return ok<PostOutcome>({ status: 'posted', transactionId: created.value });
    });
  } catch (error) {
    if (error instanceof PostingFailed) return err(error.domainError);
    throw error;
  }
}

async function postFromTemplate(
  ctx: WriteCtx,
  template: RecurringTemplate,
  dueOn: IsoDate,
  ruleId: string,
): Promise<Result<string, DomainError>> {
  if (template.kind === 'transfer') {
    const result = await createTransfer(
      ctx,
      {
        fromAccountId: template.fromAccountId,
        toAccountId: template.toAccountId,
        amount: template.amount,
        bookedOn: dueOn,
        description: template.description,
        notes: template.notes,
        tags: [],
      },
      { source: 'recurring', recurringRuleId: ruleId },
    );
    return result.ok ? ok(result.value.transaction.id) : result;
  }

  const result = await createTransaction(
    ctx,
    {
      kind: template.kind,
      accountId: template.accountId,
      categoryId: template.categoryId,
      amount: template.amount,
      bookedOn: dueOn,
      description: template.description,
      notes: template.notes,
      tags: [],
    },
    { source: 'recurring', recurringRuleId: ruleId },
  );
  return result.ok ? ok(result.value.id) : result;
}

export async function skipOccurrence(
  ctx: WriteCtx,
  occurrenceId: string,
): Promise<Result<PostOutcome, DomainError>> {
  const [row] = await ctx.tx
    .select({
      id: recurringOccurrences.id,
      userId: recurringRules.userId,
      dueOn: recurringOccurrences.dueOn,
    })
    .from(recurringOccurrences)
    .innerJoin(recurringRules, eq(recurringRules.id, recurringOccurrences.ruleId))
    .where(eq(recurringOccurrences.id, occurrenceId))
    .limit(1);

  const owned = requireOwnership(row, ctx.userId, 'occurrence', occurrenceId);
  if (!owned.ok) return owned;

  const claimed = await ctx.tx
    .update(recurringOccurrences)
    .set({ status: 'skipped', postedAt: ctx.now })
    .where(and(eq(recurringOccurrences.id, occurrenceId), eq(recurringOccurrences.status, 'pending')))
    .returning({ id: recurringOccurrences.id });

  if (claimed.length === 0) return ok({ status: 'already_settled' });

  await ctx.audit.record({
    actor: 'user',
    action: 'recurring_occurrence.skip',
    entityType: 'recurring_occurrence',
    entityId: occurrenceId,
    after: { dueOn: owned.value.dueOn },
  });

  return ok({ status: 'already_settled' });
}

export interface PostDueResult {
  readonly materialised: number;
  readonly posted: number;
  readonly failed: readonly { readonly occurrenceId: string; readonly error: DomainError }[];
}

/**
 * The `recurring.post` job body: materialise, then post everything due that its
 * rule marks `auto_post`.
 *
 * A rule whose posting fails — a closed account, a missing FX rate — is recorded
 * and skipped rather than stopping the run. Its occurrence stays `pending`,
 * because the failed post rolled its claim back.
 */
export async function postDueOccurrences(
  ctx: WriteCtx,
  options: { readonly horizonDays?: number } = {},
): Promise<Result<PostDueResult, DomainError>> {
  const materialised = await materialiseOccurrences(ctx, options);
  if (!materialised.ok) return materialised;

  const due = await ctx.tx
    .select({ id: recurringOccurrences.id })
    .from(recurringOccurrences)
    .innerJoin(recurringRules, eq(recurringRules.id, recurringOccurrences.ruleId))
    .where(
      and(
        eq(recurringRules.userId, ctx.userId),
        eq(recurringRules.isActive, true),
        eq(recurringRules.autoPost, true),
        eq(recurringOccurrences.status, 'pending'),
        sql`${recurringOccurrences.dueOn} <= ${ctx.today}`,
      ),
    )
    .orderBy(asc(recurringOccurrences.dueOn));

  let posted = 0;
  const failed: { occurrenceId: string; error: DomainError }[] = [];

  for (const occurrence of due) {
    const result = await postOccurrence(ctx, occurrence.id);
    if (!result.ok) {
      failed.push({ occurrenceId: occurrence.id, error: result.error });
      continue;
    }
    if (result.value.status === 'posted') posted += 1;
  }

  return ok({ materialised: materialised.value.created, posted, failed });
}

