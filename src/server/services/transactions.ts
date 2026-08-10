import 'server-only';

/**
 * Transactions (FINANCIAL-DOMAIN.md §4).
 *
 * ```
 * createTransaction(ctx, input) →
 *   1. VALIDATE   Zod parse
 *   2. AUTHORIZE  resolve account + category; requireOwnership; require active
 *   3. RESOLVE    FX rate for booked_on
 *   4. ENGINE     buildEntries() — signs derived from `kind`
 *   5. ENGINE     assertEntryInvariants()
 *   6. BEGIN … INSERT … audit … bump money_ledger_version … COMMIT
 * ```
 *
 * Steps 4 and 5 are the engine and touch nothing but their arguments;
 * everything else is this layer's work (ADR-21). **The caller supplies a
 * positive amount and a kind — the engine decides the sign.**
 *
 * Transfers live in `transfers.ts`. They share the write path below through
 * `insertTransaction`, so there is one implementation of "write a header, its
 * entries, its tags, an audit row and a version bump".
 */

import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';

import { isoDate, type IsoDate } from '../../lib/date';
import { abs, currency, Money, toDbString, type CurrencyCode } from '../../lib/decimal/money';
import { Rate, rToDbString } from '../../lib/decimal/rate';
import {
  createTransactionSchema,
  transactionFilterSchema,
  updateTransactionSchema,
  type CreateTransactionInput,
} from '../../lib/schemas/money';
import { err, insufficientData, notFound, ok, validationFailed, type DomainError, type Result } from '../../lib/result';
import { assertEntryInvariants, buildEntries, type EntryDraft, type TransactionKind } from '../domain/ledger/entries';
import {
  accounts,
  categories,
  tags,
  transactionEntries,
  transactions,
  transactionTags,
} from '../db/schema';
import type { ReadCtx, WriteCtx } from './_ctx';
import { bumpMoneyLedgerVersion } from './_ctx';
import { requireActiveAccount, requireOnOrAfterOpening, requireOwnership } from './_guards';
import { fieldErrors } from './_validation';
import { categorySubtree } from './categories';
import { setTransactionTags } from './tags';

export type RecordSource = 'manual' | 'ai' | 'recurring' | 'import';

export interface TransactionEntryView {
  readonly id: string;
  readonly accountId: string;
  readonly accountName: string;
  readonly amount: Money;
  readonly baseAmount: Money;
  readonly fxRateToBase: Rate;
}

export interface TransactionView {
  readonly id: string;
  readonly kind: TransactionKind;
  readonly bookedOn: IsoDate;
  readonly description: string;
  readonly categoryId: string | null;
  readonly categoryName: string | null;
  readonly notes: string | null;
  readonly source: RecordSource;
  readonly recurringRuleId: string | null;
  readonly entries: readonly TransactionEntryView[];
  readonly tags: readonly { readonly id: string; readonly name: string }[];
  /**
   * The headline figure, as a positive magnitude: the amount for income and
   * expense, and the amount that **left** the source account for a transfer.
   */
  readonly amount: Money;
  readonly baseAmount: Money;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// ----------------------------------------------------------------------- reads

export interface TransactionQuery {
  readonly from?: IsoDate;
  readonly to?: IsoDate;
  readonly accountId?: string;
  readonly categoryId?: string;
  readonly kind?: TransactionKind;
  readonly tagId?: string;
  readonly search?: string;
  readonly minAmount?: string;
  readonly maxAmount?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface TransactionPage {
  readonly rows: readonly TransactionView[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export async function listTransactions(
  ctx: ReadCtx,
  rawQuery: TransactionQuery = {},
): Promise<Result<TransactionPage, DomainError>> {
  const parsed = transactionFilterSchema.safeParse(rawQuery);
  if (!parsed.success) return err(fieldErrors(parsed.error));
  const query = parsed.data;

  const conditions: SQL[] = [eq(transactions.userId, ctx.userId)];

  if (query.from) conditions.push(sql`${transactions.bookedOn} >= ${query.from}`);
  if (query.to) conditions.push(sql`${transactions.bookedOn} <= ${query.to}`);
  if (query.kind) conditions.push(eq(transactions.kind, query.kind));

  if (query.categoryId) {
    // A category filter always means the subtree: asking for Food must include
    // Groceries and Dining (FINANCIAL-DOMAIN.md §5).
    const subtree = await categorySubtree(ctx, query.categoryId);
    conditions.push(inArray(transactions.categoryId, subtree));
  }

  if (query.accountId) {
    conditions.push(sql`exists (
      select 1 from ${transactionEntries} e
       where e.transaction_id = ${transactions.id} and e.account_id = ${query.accountId}
    )`);
  }

  if (query.tagId) {
    conditions.push(sql`exists (
      select 1 from ${transactionTags} tt
       where tt.transaction_id = ${transactions.id} and tt.tag_id = ${query.tagId}
    )`);
  }

  if (query.search) {
    const pattern = `%${query.search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conditions.push(sql`(${transactions.description} ilike ${pattern} or ${transactions.notes} ilike ${pattern})`);
  }

  if (query.minAmount) {
    conditions.push(sql`exists (
      select 1 from ${transactionEntries} e
       where e.transaction_id = ${transactions.id} and abs(e.base_amount) >= ${query.minAmount}
    )`);
  }
  if (query.maxAmount) {
    conditions.push(sql`exists (
      select 1 from ${transactionEntries} e
       where e.transaction_id = ${transactions.id} and abs(e.base_amount) <= ${query.maxAmount}
    )`);
  }

  const where = and(...conditions)!;

  const [counted] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(transactions)
    .where(where);

  const headers = await ctx.db
    .select({
      id: transactions.id,
      kind: transactions.kind,
      bookedOn: transactions.bookedOn,
      description: transactions.description,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      notes: transactions.notes,
      source: transactions.source,
      recurringRuleId: transactions.recurringRuleId,
      createdAt: transactions.createdAt,
      updatedAt: transactions.updatedAt,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(where)
    // The same total order the engine assumes, so two rows on one date never
    // swap places between renders.
    .orderBy(desc(transactions.bookedOn), desc(transactions.createdAt), desc(transactions.id))
    .limit(query.limit)
    .offset(query.offset);

  const rows = await hydrate(ctx, headers);

  return ok({ rows, total: counted?.n ?? 0, limit: query.limit, offset: query.offset });
}

export async function getTransaction(
  ctx: ReadCtx,
  id: string,
): Promise<Result<TransactionView, DomainError>> {
  const [header] = await ctx.db
    .select({
      id: transactions.id,
      userId: transactions.userId,
      kind: transactions.kind,
      bookedOn: transactions.bookedOn,
      description: transactions.description,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      notes: transactions.notes,
      source: transactions.source,
      recurringRuleId: transactions.recurringRuleId,
      createdAt: transactions.createdAt,
      updatedAt: transactions.updatedAt,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(eq(transactions.id, id))
    .limit(1);

  const owned = requireOwnership(header, ctx.userId, 'transaction', id);
  if (!owned.ok) return owned;

  const [view] = await hydrate(ctx, [owned.value]);
  return view ? ok(view) : err(notFound('transaction', id));
}

interface HeaderRow {
  id: string;
  kind: TransactionKind;
  bookedOn: string;
  description: string;
  categoryId: string | null;
  categoryName: string | null;
  notes: string | null;
  source: RecordSource;
  recurringRuleId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Attach entries and tags to a page of headers — two queries, not two per row. */
async function hydrate(ctx: ReadCtx, headers: readonly HeaderRow[]): Promise<TransactionView[]> {
  if (headers.length === 0) return [];
  const ids = headers.map((h) => h.id);

  const entryRows = await ctx.db
    .select({
      id: transactionEntries.id,
      transactionId: transactionEntries.transactionId,
      accountId: transactionEntries.accountId,
      accountName: accounts.name,
      amount: transactionEntries.amount,
      currencyCode: transactionEntries.currencyCode,
      fxRateToBase: transactionEntries.fxRateToBase,
      baseAmount: transactionEntries.baseAmount,
      sortOrder: transactionEntries.sortOrder,
    })
    .from(transactionEntries)
    .innerJoin(accounts, eq(accounts.id, transactionEntries.accountId))
    .where(inArray(transactionEntries.transactionId, ids))
    .orderBy(transactionEntries.sortOrder);

  const tagRows = await ctx.db
    .select({ transactionId: transactionTags.transactionId, id: tags.id, name: tags.name })
    .from(transactionTags)
    .innerJoin(tags, eq(tags.id, transactionTags.tagId))
    .where(inArray(transactionTags.transactionId, ids));

  const entriesByTxn = new Map<string, TransactionEntryView[]>();
  for (const row of entryRows) {
    const entryCurrency = currency(row.currencyCode.trim());
    const list = entriesByTxn.get(row.transactionId) ?? [];
    list.push({
      id: row.id,
      accountId: row.accountId,
      accountName: row.accountName,
      amount: Money.fromDbString(row.amount, entryCurrency),
      baseAmount: Money.fromDbString(row.baseAmount, ctx.base),
      fxRateToBase: Rate.fromDbString(row.fxRateToBase),
    });
    entriesByTxn.set(row.transactionId, list);
  }

  const tagsByTxn = new Map<string, { id: string; name: string }[]>();
  for (const row of tagRows) {
    const list = tagsByTxn.get(row.transactionId) ?? [];
    list.push({ id: row.id, name: row.name });
    tagsByTxn.set(row.transactionId, list);
  }

  return headers.map((header) => {
    const entries = entriesByTxn.get(header.id) ?? [];
    // For a transfer the headline is what left the source account; for income
    // and expense there is only one entry, so the choice is the same figure.
    const headline = header.kind === 'transfer' ? (entries.find((e) => e.amount.minor < 0n) ?? entries[0]) : entries[0];

    return {
      id: header.id,
      kind: header.kind,
      bookedOn: isoDate(header.bookedOn),
      description: header.description,
      categoryId: header.categoryId,
      categoryName: header.categoryName,
      notes: header.notes,
      source: header.source,
      recurringRuleId: header.recurringRuleId,
      entries,
      tags: (tagsByTxn.get(header.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
      amount: headline ? abs(headline.amount) : Money.zero(ctx.base),
      baseAmount: headline ? abs(headline.baseAmount) : Money.zero(ctx.base),
      createdAt: header.createdAt,
      updatedAt: header.updatedAt,
    };
  });
}

// -------------------------------------------------------------------- commands

export interface ResolvedAccount {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly currency: CurrencyCode;
  readonly isActive: boolean;
  readonly openingDate: string;
}

/** Fetch an account and prove the caller may post to it on this date. */
export async function resolveAccount(
  ctx: WriteCtx,
  accountId: string,
  bookedOn: IsoDate,
  field: string,
): Promise<Result<ResolvedAccount, DomainError>> {
  const [row] = await ctx.tx
    .select({
      id: accounts.id,
      userId: accounts.userId,
      name: accounts.name,
      currencyCode: accounts.currencyCode,
      isActive: accounts.isActive,
      openingDate: accounts.openingDate,
    })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);

  const owned = requireOwnership(row, ctx.userId, 'account', accountId);
  if (!owned.ok) return owned;

  const active = requireActiveAccount(owned.value, field);
  if (!active.ok) return active;

  const dated = requireOnOrAfterOpening(owned.value, bookedOn);
  if (!dated.ok) return dated;

  return ok({
    id: owned.value.id,
    userId: owned.value.userId,
    name: owned.value.name,
    currency: currency(owned.value.currencyCode.trim()),
    isActive: owned.value.isActive,
    openingDate: owned.value.openingDate,
  });
}

/**
 * The rate converting an account's currency into base, on the booking date.
 *
 * A missing rate is refused rather than defaulted to 1 (FINANCIAL-DOMAIN.md §12,
 * case 17): a fabricated rate silently mis-states every total the entry appears
 * in, and there is no later signal that it was invented.
 */
export function resolveRate(
  ctx: WriteCtx,
  from: CurrencyCode,
  bookedOn: IsoDate,
  field: string,
): Result<Rate, DomainError> {
  const selection = ctx.fx.rate(from, ctx.base, bookedOn);
  if (!selection.ok) {
    return err(
      insufficientData(
        'no_fx_rate',
        `No exchange rate from ${from} to ${ctx.base} on or before ${bookedOn}. ` +
          `Add one before recording this ${field}.`,
      ),
    );
  }
  return ok(selection.value.rate);
}

export interface InsertTransactionArgs {
  readonly kind: TransactionKind;
  readonly bookedOn: IsoDate;
  readonly description: string;
  readonly categoryId: string | null;
  readonly notes: string | null;
  readonly source: RecordSource;
  readonly recurringRuleId?: string | null;
  readonly entries: readonly EntryDraft[];
  readonly tags: readonly string[];
}

/**
 * The one write path for a header, its entries, its tags, the audit row and the
 * ledger-version bump. Income, expense, transfer and recurring postings all go
 * through it, so none of them can forget a step.
 */
export async function insertTransaction(
  ctx: WriteCtx,
  args: InsertTransactionArgs,
): Promise<Result<string, DomainError>> {
  const [header] = await ctx.tx
    .insert(transactions)
    .values({
      userId: ctx.userId,
      kind: args.kind,
      bookedOn: args.bookedOn,
      description: args.description,
      categoryId: args.categoryId,
      notes: args.notes,
      source: args.source,
      recurringRuleId: args.recurringRuleId ?? null,
    })
    .returning({ id: transactions.id });

  if (!header) throw new Error('Insert of a transaction returned no row.');

  await ctx.tx.insert(transactionEntries).values(
    args.entries.map((entry) => ({
      transactionId: header.id,
      accountId: entry.accountId,
      amount: toDbString(entry.amount),
      currencyCode: entry.currency,
      fxRateToBase: rToDbString(entry.fxRateToBase),
      baseAmount: toDbString(entry.baseAmount),
      sortOrder: entry.sortOrder,
    })),
  );

  const tagged = await setTransactionTags(ctx, header.id, args.tags);
  if (!tagged.ok) return tagged;

  await ctx.audit.record({
    actor: args.source === 'ai' ? 'ai_confirmed' : args.source === 'recurring' ? 'system' : 'user',
    action: 'transaction.create',
    entityType: 'transaction',
    entityId: header.id,
    after: {
      kind: args.kind,
      bookedOn: args.bookedOn,
      description: args.description,
      categoryId: args.categoryId,
      entries: args.entries.map((e) => ({
        accountId: e.accountId,
        amount: toDbString(e.amount),
        currency: e.currency,
        baseAmount: toDbString(e.baseAmount),
      })),
      tags: args.tags,
    },
  });

  await bumpMoneyLedgerVersion(ctx);
  return ok(header.id);
}

export async function createTransaction(
  ctx: WriteCtx,
  raw: unknown,
  options: { readonly source?: RecordSource; readonly recurringRuleId?: string | null } = {},
): Promise<Result<TransactionView, DomainError>> {
  const parsed = createTransactionSchema.safeParse(raw);
  if (!parsed.success) return err(fieldErrors(parsed.error));
  const input: CreateTransactionInput = parsed.data;

  const bookedOn = isoDate(input.bookedOn);

  const account = await resolveAccount(ctx, input.accountId, bookedOn, 'accountId');
  if (!account.ok) return account;

  const category = await resolveCategory(ctx, input.categoryId);
  if (!category.ok) return category;

  const amount = Money.parseUserInput(input.amount, account.value.currency);
  if (!amount.ok) return err(validationFailed({ amount: [amount.error.message] }));

  const rate = resolveRate(ctx, account.value.currency, bookedOn, 'transaction');
  if (!rate.ok) return rate;

  const built = buildEntries(
    {
      kind: input.kind,
      leg: { accountId: account.value.id, amount: amount.value, fxRateToBase: rate.value },
    },
    ctx.base,
  );
  if (!built.ok) return built;

  const invariants = assertEntryInvariants({
    kind: input.kind,
    categoryId: category.value.id,
    categoryKind: category.value.kind,
    entries: built.value,
  });
  if (!invariants.ok) return invariants;

  const created = await insertTransaction(ctx, {
    kind: input.kind,
    bookedOn,
    description: input.description,
    categoryId: category.value.id,
    notes: input.notes ?? null,
    source: options.source ?? 'manual',
    recurringRuleId: options.recurringRuleId ?? null,
    entries: built.value,
    tags: input.tags,
  });
  if (!created.ok) return created;

  return getTransaction(ctx, created.value);
}

export async function resolveCategory(
  ctx: WriteCtx,
  categoryId: string,
): Promise<Result<{ readonly id: string; readonly kind: 'income' | 'expense'; readonly name: string }, DomainError>> {
  const [row] = await ctx.tx
    .select({ id: categories.id, userId: categories.userId, kind: categories.kind, name: categories.name, isArchived: categories.isArchived })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .limit(1);

  const owned = requireOwnership(row, ctx.userId, 'category', categoryId);
  if (!owned.ok) return owned;

  // An archived category is still usable when editing an old record — it is
  // hidden from pickers, not retired from history.
  return ok({ id: owned.value.id, kind: owned.value.kind, name: owned.value.name });
}

/**
 * Edit a transaction in place, with a full before/after audit entry.
 *
 * The entries are rebuilt rather than patched: a change of amount, account or
 * date changes the sign derivation, the currency, and the FX rate together, and
 * patching one field of an entry is how a base amount stops matching its own
 * rate. `kind` is not editable — changing income into an expense is a delete and
 * a create, and it should read that way in the audit trail.
 */
export async function updateTransaction(
  ctx: WriteCtx,
  id: string,
  raw: unknown,
): Promise<Result<TransactionView, DomainError>> {
  const parsed = updateTransactionSchema.safeParse(raw);
  if (!parsed.success) return err(fieldErrors(parsed.error));
  const input = parsed.data;

  const before = await getTransaction(ctx, id);
  if (!before.ok) return before;
  const existing = before.value;

  if (existing.kind === 'transfer') {
    return err(
      validationFailed({
        _: ['Edit a transfer from the transfer form — it has two legs and one amount cannot be changed alone.'],
      }),
    );
  }

  const entry = existing.entries[0];
  if (!entry) throw new Error(`Transaction ${id} has no entries; invariant I-1 has been violated.`);

  const bookedOn = input.bookedOn ? isoDate(input.bookedOn) : existing.bookedOn;
  const accountId = input.accountId ?? entry.accountId;

  const account = await resolveAccount(ctx, accountId, bookedOn, 'accountId');
  if (!account.ok) return account;

  const category = await resolveCategory(ctx, input.categoryId ?? existing.categoryId!);
  if (!category.ok) return category;

  const amountText = input.amount ?? toDbString(existing.amount);
  const amount = Money.parseUserInput(amountText, account.value.currency);
  if (!amount.ok) return err(validationFailed({ amount: [amount.error.message] }));

  const rate = resolveRate(ctx, account.value.currency, bookedOn, 'transaction');
  if (!rate.ok) return rate;

  const built = buildEntries(
    {
      kind: existing.kind,
      leg: { accountId: account.value.id, amount: amount.value, fxRateToBase: rate.value },
    },
    ctx.base,
  );
  if (!built.ok) return built;

  const invariants = assertEntryInvariants({
    kind: existing.kind,
    categoryId: category.value.id,
    categoryKind: category.value.kind,
    entries: built.value,
  });
  if (!invariants.ok) return invariants;

  await ctx.tx
    .update(transactions)
    .set({
      bookedOn,
      description: input.description ?? existing.description,
      categoryId: category.value.id,
      notes: input.notes === undefined ? existing.notes : input.notes || null,
      updatedAt: new Date(),
    })
    .where(eq(transactions.id, id));

  await ctx.tx.delete(transactionEntries).where(eq(transactionEntries.transactionId, id));
  await ctx.tx.insert(transactionEntries).values(
    built.value.map((draft) => ({
      transactionId: id,
      accountId: draft.accountId,
      amount: toDbString(draft.amount),
      currencyCode: draft.currency,
      fxRateToBase: rToDbString(draft.fxRateToBase),
      baseAmount: toDbString(draft.baseAmount),
      sortOrder: draft.sortOrder,
    })),
  );

  if (input.tags !== undefined) {
    const tagged = await setTransactionTags(ctx, id, input.tags);
    if (!tagged.ok) return tagged;
  }

  await ctx.audit.record({
    actor: 'user',
    action: 'transaction.update',
    entityType: 'transaction',
    entityId: id,
    before: auditShape(existing),
    after: {
      kind: existing.kind,
      bookedOn,
      description: input.description ?? existing.description,
      categoryId: category.value.id,
      entries: built.value.map((e) => ({
        accountId: e.accountId,
        amount: toDbString(e.amount),
        currency: e.currency,
        baseAmount: toDbString(e.baseAmount),
      })),
    },
  });

  // Correcting history is a normal operation: every balance from this date
  // onward is right on the next read, with no backfill job.
  await bumpMoneyLedgerVersion(ctx);

  return getTransaction(ctx, id);
}

/**
 * Hard delete, with the full row captured in the audit log.
 *
 * Not a soft-delete flag: a flag has to be remembered by every aggregate query,
 * which is exactly the failure mode the entry-based ledger exists to avoid
 * (ADR-05). The entries cascade with the header.
 */
export async function deleteTransaction(ctx: WriteCtx, id: string): Promise<Result<void, DomainError>> {
  const before = await getTransaction(ctx, id);
  if (!before.ok) return before;

  await ctx.tx.delete(transactions).where(eq(transactions.id, id));

  await ctx.audit.record({
    actor: 'user',
    action: 'transaction.delete',
    entityType: 'transaction',
    entityId: id,
    before: auditShape(before.value),
  });

  await bumpMoneyLedgerVersion(ctx);
  return ok(undefined);
}

function auditShape(view: TransactionView): Record<string, unknown> {
  return {
    kind: view.kind,
    bookedOn: view.bookedOn,
    description: view.description,
    categoryId: view.categoryId,
    notes: view.notes,
    source: view.source,
    entries: view.entries.map((e) => ({
      accountId: e.accountId,
      amount: toDbString(e.amount),
      currency: e.amount.currency,
      baseAmount: toDbString(e.baseAmount),
    })),
    tags: view.tags.map((t) => t.name),
  };
}
