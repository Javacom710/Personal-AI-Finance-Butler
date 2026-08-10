import 'server-only';

/**
 * Accounts (FINANCIAL-DOMAIN.md §3).
 *
 * The balance is **derived on every read** — there is no stored column and there
 * never will be. `deriveBalance()` in the engine is the single implementation;
 * this service's job is to fetch the rows it sums and to convert the result to
 * base currency, which is I/O and therefore not the engine's.
 */

import { and, asc, eq, sql } from 'drizzle-orm';

import { isoDate, type IsoDate } from '../../lib/date';
import { currency, Money, toDbString, type CurrencyCode } from '../../lib/decimal/money';
import { metric, unavailable, type Metric } from '../../lib/metric';
import {
  createAccountSchema,
  updateAccountSchema,
  type CreateAccountInput,
  type UpdateAccountInput,
} from '../../lib/schemas/money';
import { conflict, err, ok, validationFailed, type DomainError, type Result } from '../../lib/result';
import {
  accountRole,
  availableCredit,
  deriveBalance,
  withRunningBalance,
  type AccountKind,
  type AccountRole,
} from '../domain/ledger/balance';
import { accounts, categories, transactionEntries, transactions } from '../db/schema';
import type { ReadCtx, WriteCtx } from './_ctx';
import { bumpMoneyLedgerVersion } from './_ctx';
import { requireOwnership } from './_guards';
import { fieldErrors } from './_validation';

export interface AccountView {
  readonly id: string;
  readonly name: string;
  readonly kind: AccountKind;
  readonly institution: string | null;
  readonly currency: CurrencyCode;
  readonly openingBalance: Money;
  readonly openingDate: IsoDate;
  readonly creditLimit: Money | null;
  readonly isActive: boolean;
  readonly displayOrder: number;
  readonly notes: string | null;

  /** Derived: `opening_balance + Σ entries`, in the account's own currency. */
  readonly balance: Money;
  /** The same figure in base currency, or `null` with reason `no_fx_rate`. */
  readonly baseBalance: Metric<Money>;
  /** Shown on the row, counted in no total. `null` for anything but a card. */
  readonly availableCredit: Money | null;
  readonly role: AccountRole;
  readonly lastActivityOn: IsoDate | null;
  readonly entryCount: number;
}

interface AccountRow {
  id: string;
  userId: string;
  name: string;
  kind: AccountKind;
  institution: string | null;
  currencyCode: string;
  openingBalance: string;
  openingDate: string;
  creditLimit: string | null;
  isActive: boolean;
  displayOrder: number;
  notes: string | null;
}

export interface ListAccountsOptions {
  readonly includeInactive?: boolean;
  /** A historical balance is the same query with a different bound. */
  readonly asOf?: IsoDate;
}

/**
 * Every account with its derived balance.
 *
 * One grouped query rather than a balance query per account: the N+1 version is
 * correct but turns the accounts page into a dozen round trips.
 */
export async function listAccounts(
  ctx: ReadCtx,
  options: ListAccountsOptions = {},
): Promise<AccountView[]> {
  const rows = (await ctx.db
    .select()
    .from(accounts)
    .where(
      options.includeInactive
        ? eq(accounts.userId, ctx.userId)
        : and(eq(accounts.userId, ctx.userId), eq(accounts.isActive, true)),
    )
    .orderBy(asc(accounts.displayOrder), asc(accounts.name))) as AccountRow[];

  if (rows.length === 0) return [];

  const totals = await entryTotals(ctx, options.asOf ?? null);

  return rows.map((row) => toView(ctx, row, totals.get(row.id)));
}

export async function getAccount(
  ctx: ReadCtx,
  id: string,
  options: { readonly asOf?: IsoDate } = {},
): Promise<Result<AccountView, DomainError>> {
  const [row] = (await ctx.db.select().from(accounts).where(eq(accounts.id, id)).limit(1)) as AccountRow[];

  const owned = requireOwnership(row, ctx.userId, 'account', id);
  if (!owned.ok) return owned;

  const totals = await entryTotals(ctx, options.asOf ?? null, id);
  return ok(toView(ctx, owned.value, totals.get(id)));
}

interface EntryTotal {
  readonly total: string;
  readonly lastActivityOn: string | null;
  readonly entryCount: number;
}

/**
 * `Σ transaction_entries.amount` per account, with the last activity date.
 *
 * The date bound is applied **inside** the movements subquery, not in the outer
 * WHERE clause: filtering after the join would drop accounts with no entries in
 * range instead of reporting them at their opening balance, which is the
 * classic way this query loses an empty account.
 *
 * Phase 4 unions `investment_transactions.net_amount` into `movements`. The
 * engine's `deriveBalance` already takes that sum as a parameter.
 */
async function entryTotals(
  ctx: ReadCtx,
  asOf: IsoDate | null,
  accountId?: string,
): Promise<Map<string, EntryTotal>> {
  const result = await ctx.db.execute<{
    account_id: string;
    total: string;
    last_activity_on: string | null;
    entry_count: string;
  }>(sql`
    select a.id                                as account_id,
           coalesce(sum(m.amount), 0)::text    as total,
           max(m.booked_on)::text              as last_activity_on,
           count(m.amount)::text               as entry_count
      from ${accounts} a
      left join (
        select e.account_id, e.amount, t.booked_on
          from ${transactionEntries} e
          join ${transactions} t on t.id = e.transaction_id
         where t.user_id = ${ctx.userId}
           ${asOf === null ? sql`` : sql`and t.booked_on <= ${asOf}`}
      ) m on m.account_id = a.id
     where a.user_id = ${ctx.userId}
       ${accountId === undefined ? sql`` : sql`and a.id = ${accountId}`}
     group by a.id
  `);

  return new Map(
    result.rows.map((row) => [
      row.account_id,
      {
        total: row.total,
        lastActivityOn: row.last_activity_on,
        entryCount: Number(row.entry_count),
      },
    ]),
  );
}

function toView(ctx: ReadCtx, row: AccountRow, total: EntryTotal | undefined): AccountView {
  const accountCurrency = currency(row.currencyCode.trim());
  const opening = Money.fromDbString(row.openingBalance, accountCurrency);

  const entries = total && total.total !== '0' ? [Money.fromDbString(total.total, accountCurrency)] : [];
  const balance = deriveBalance(opening, entries);

  const limit = row.creditLimit === null ? null : Money.fromDbString(row.creditLimit, accountCurrency);
  const converted = ctx.fx.toBase(balance, ctx.today);

  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    institution: row.institution,
    currency: accountCurrency,
    openingBalance: opening,
    openingDate: isoDate(row.openingDate),
    creditLimit: limit,
    isActive: row.isActive,
    displayOrder: row.displayOrder,
    notes: row.notes,
    balance,
    baseBalance: converted.ok ? metric(converted.value.amount) : unavailable('no_fx_rate'),
    availableCredit: limit === null ? null : availableCredit(limit, balance),
    role: accountRole(row.kind, balance),
    lastActivityOn: total?.lastActivityOn ? isoDate(total.lastActivityOn) : null,
    entryCount: total?.entryCount ?? 0,
  };
}

// ------------------------------------------------------------------- commands

export async function createAccount(
  ctx: WriteCtx,
  raw: unknown,
): Promise<Result<AccountView, DomainError>> {
  const parsed = createAccountSchema.safeParse(raw);
  if (!parsed.success) return err(fieldErrors(parsed.error));
  const input: CreateAccountInput = parsed.data;

  const accountCurrency = currency(input.currencyCode);
  const opening = Money.parseUserInput(input.openingBalance, accountCurrency);
  if (!opening.ok) return err(validationFailed({ openingBalance: [opening.error.message] }));

  let limit: Money | null = null;
  if (input.creditLimit !== undefined && input.creditLimit !== null) {
    const parsedLimit = Money.parseUserInput(input.creditLimit, accountCurrency);
    if (!parsedLimit.ok) return err(validationFailed({ creditLimit: [parsedLimit.error.message] }));
    if (parsedLimit.value.minor < 0n) {
      return err(validationFailed({ creditLimit: ['A credit limit cannot be negative.'] }));
    }
    limit = parsedLimit.value;
  }

  // Checked before the insert rather than caught after it: a constraint
  // violation aborts the whole Postgres transaction, so there is no "catch and
  // carry on" once it has fired (see _errors.ts).
  const duplicate = await findByName(ctx, input.name);
  if (duplicate) return err(conflict(`An account named "${input.name}" already exists.`));

  const [inserted] = await ctx.tx
    .insert(accounts)
    .values({
      userId: ctx.userId,
      name: input.name,
      kind: input.kind,
      institution: input.institution ?? null,
      currencyCode: accountCurrency,
      openingBalance: toDbString(opening.value),
      openingDate: input.openingDate,
      creditLimit: limit === null ? null : toDbString(limit),
      notes: input.notes ?? null,
    })
    .returning();

  if (inserted === undefined) throw new Error('Insert of an account returned no row.');

  await ctx.audit.record({
    actor: 'user',
    action: 'account.create',
    entityType: 'account',
    entityId: inserted.id,
    after: inserted,
  });

  // The opening balance is part of the ledger's starting position, so creating
  // an account invalidates anything derived from it (ARCHITECTURE.md §6).
  await bumpMoneyLedgerVersion(ctx);

  return getAccount(ctx, inserted.id);
}

export async function updateAccount(
  ctx: WriteCtx,
  id: string,
  raw: unknown,
): Promise<Result<AccountView, DomainError>> {
  const parsed = updateAccountSchema.safeParse(raw);
  if (!parsed.success) return err(fieldErrors(parsed.error));
  const input: UpdateAccountInput = parsed.data;

  const [existing] = (await ctx.tx.select().from(accounts).where(eq(accounts.id, id)).limit(1)) as AccountRow[];
  const owned = requireOwnership(existing, ctx.userId, 'account', id);
  if (!owned.ok) return owned;

  const accountCurrency = currency(owned.value.currencyCode.trim());

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) patch['name'] = input.name;
  if (input.institution !== undefined) patch['institution'] = input.institution || null;
  if (input.notes !== undefined) patch['notes'] = input.notes || null;
  if (input.displayOrder !== undefined) patch['displayOrder'] = input.displayOrder;

  if (input.creditLimit !== undefined) {
    if (input.creditLimit === null || input.creditLimit === '') {
      if (owned.value.kind === 'credit_card') {
        return err(validationFailed({ creditLimit: ['A credit card needs a limit.'] }));
      }
      patch['creditLimit'] = null;
    } else {
      const parsedLimit = Money.parseUserInput(input.creditLimit, accountCurrency);
      if (!parsedLimit.ok) return err(validationFailed({ creditLimit: [parsedLimit.error.message] }));
      patch['creditLimit'] = toDbString(parsedLimit.value);
    }
  }

  if (input.name !== undefined && input.name !== owned.value.name) {
    const duplicate = await findByName(ctx, input.name);
    if (duplicate) return err(conflict(`An account named "${input.name}" already exists.`));
  }

  // Neither the currency nor the opening balance nor the opening date is
  // editable. Each of them silently rewrites every balance and every historical
  // total ever computed from this account — a correction is a new account plus a
  // transfer, which leaves a trail.
  const [updated] = await ctx.tx.update(accounts).set(patch).where(eq(accounts.id, id)).returning();

  if (updated === undefined) throw new Error('Update of an account returned no row.');

  await ctx.audit.record({
    actor: 'user',
    action: 'account.update',
    entityType: 'account',
    entityId: id,
    before: owned.value,
    after: updated,
  });

  return getAccount(ctx, id);
}

/**
 * Close or reopen an account.
 *
 * Closing is `is_active = false` and nothing else. Historical records remain and
 * remain in historical totals — an inactive account with a non-zero balance is
 * flagged on the accounts page rather than being zeroed, because closing an
 * account does not settle it (FINANCIAL-DOMAIN.md §3, edge case 7).
 */
export async function setAccountActive(
  ctx: WriteCtx,
  id: string,
  isActive: boolean,
): Promise<Result<AccountView, DomainError>> {
  const [existing] = (await ctx.tx.select().from(accounts).where(eq(accounts.id, id)).limit(1)) as AccountRow[];
  const owned = requireOwnership(existing, ctx.userId, 'account', id);
  if (!owned.ok) return owned;

  await ctx.tx.update(accounts).set({ isActive, updatedAt: new Date() }).where(eq(accounts.id, id));

  await ctx.audit.record({
    actor: 'user',
    action: isActive ? 'account.reopen' : 'account.close',
    entityType: 'account',
    entityId: id,
    before: { isActive: owned.value.isActive },
    after: { isActive },
  });

  return getAccount(ctx, id);
}

/**
 * Delete an account that has never been used.
 *
 * An account with ledger history cannot be deleted — `ON DELETE RESTRICT` on
 * `transaction_entries.account_id` would refuse it anyway, but refusing here
 * produces a sentence instead of a constraint name.
 */
export async function deleteAccount(ctx: WriteCtx, id: string): Promise<Result<void, DomainError>> {
  const [existing] = (await ctx.tx.select().from(accounts).where(eq(accounts.id, id)).limit(1)) as AccountRow[];
  const owned = requireOwnership(existing, ctx.userId, 'account', id);
  if (!owned.ok) return owned;

  const [used] = await ctx.tx
    .select({ n: sql<number>`count(*)::int` })
    .from(transactionEntries)
    .where(eq(transactionEntries.accountId, id));

  if ((used?.n ?? 0) > 0) {
    return err(
      conflict(
        `${owned.value.name} has ${used!.n} ledger entries and cannot be deleted. Close it instead — its history stays in past totals.`,
      ),
    );
  }

  await ctx.tx.delete(accounts).where(eq(accounts.id, id));
  await ctx.audit.record({
    actor: 'user',
    action: 'account.delete',
    entityType: 'account',
    entityId: id,
    before: owned.value,
  });
  await bumpMoneyLedgerVersion(ctx);

  return ok(undefined);
}

// -------------------------------------------------------------------- ledger

export interface LedgerLine {
  readonly entryId: string;
  readonly transactionId: string;
  readonly bookedOn: IsoDate;
  readonly description: string;
  readonly kind: 'income' | 'expense' | 'transfer';
  readonly categoryName: string | null;
  readonly counterAccountName: string | null;
  readonly amount: Money;
  readonly balance: Money;
}

/**
 * An account's ledger with a running balance.
 *
 * Ordered ascending by the same total order the engine assumes
 * (`booked_on, created_at, id`), because a running balance over a partial order
 * is a plausible-looking wrong answer.
 */
export async function accountLedger(
  ctx: ReadCtx,
  id: string,
  options: { readonly limit?: number } = {},
): Promise<Result<{ readonly account: AccountView; readonly lines: LedgerLine[] }, DomainError>> {
  const account = await getAccount(ctx, id);
  if (!account.ok) return account;

  const limit = Math.min(Math.max(options.limit ?? 200, 1), 1000);

  const result = await ctx.db.execute<{
    entry_id: string;
    transaction_id: string;
    booked_on: string;
    description: string;
    kind: 'income' | 'expense' | 'transfer';
    category_name: string | null;
    counter_account_name: string | null;
    amount: string;
  }>(sql`
    select e.id                as entry_id,
           t.id                as transaction_id,
           t.booked_on::text   as booked_on,
           t.description       as description,
           t.kind              as kind,
           c.name              as category_name,
           counter.name        as counter_account_name,
           e.amount::text      as amount
      from ${transactionEntries} e
      join ${transactions} t on t.id = e.transaction_id
      left join ${categories} c on c.id = t.category_id
      left join ${transactionEntries} other
             on other.transaction_id = t.id and other.id <> e.id
      left join ${accounts} counter on counter.id = other.account_id
     where e.account_id = ${id} and t.user_id = ${ctx.userId}
     order by t.booked_on asc, t.created_at asc, t.id asc, e.sort_order asc
     limit ${limit}
  `);

  const accountCurrency = account.value.currency;
  const movements = result.rows.map((row) => ({
    row,
    amount: Money.fromDbString(row.amount, accountCurrency),
  }));

  const lines = withRunningBalance(account.value.openingBalance, movements).map((line) => ({
    entryId: line.row.entry_id,
    transactionId: line.row.transaction_id,
    bookedOn: isoDate(line.row.booked_on),
    description: line.row.description,
    kind: line.row.kind,
    categoryName: line.row.category_name,
    counterAccountName: line.row.counter_account_name,
    amount: line.amount,
    balance: line.balance,
  }));

  return ok({ account: account.value, lines });
}

// -------------------------------------------------------------------- helpers

async function findByName(ctx: WriteCtx, name: string): Promise<string | null> {
  const [row] = await ctx.tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, ctx.userId), eq(accounts.name, name)))
    .limit(1);
  return row?.id ?? null;
}
