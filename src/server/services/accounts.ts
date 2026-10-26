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
  existedAt,
  isAgainstExpectedSign,
  openingContribution,
  withRunningBalance,
  type AccountKind,
  type AccountRole,
} from '../domain/ledger/balance';
import {
  accounts,
  categories,
  instruments,
  investmentTransactions,
  transactionEntries,
  transactions,
} from '../db/schema';
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
  /** The **declared** opening balance, ungated. `balance` carries the gated form. */
  readonly openingBalance: Money;
  readonly openingDate: IsoDate;
  /** Did the account exist at the requested date? `false` ⟹ absent from net worth. */
  readonly existedAsOf: boolean;
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
  /** By the **sign** of the balance, never by kind (ADR-25). */
  readonly role: AccountRole;
  /** An overpaid card or an overdrawn bank account: flagged, never reclassified. */
  readonly againstExpectedSign: boolean;
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

  const asOf = options.asOf ?? null;
  const totals = await entryTotals(ctx, asOf);

  return rows.map((row) => toView(ctx, row, totals.get(row.id), asOf));
}

export async function getAccount(
  ctx: ReadCtx,
  id: string,
  options: { readonly asOf?: IsoDate } = {},
): Promise<Result<AccountView, DomainError>> {
  const [row] = (await ctx.db.select().from(accounts).where(eq(accounts.id, id)).limit(1)) as AccountRow[];

  const owned = requireOwnership(row, ctx.userId, 'account', id);
  if (!owned.ok) return owned;

  const asOf = options.asOf ?? null;
  const totals = await entryTotals(ctx, asOf, id);
  return ok(toView(ctx, owned.value, totals.get(id), asOf));
}

interface EntryTotal {
  /** `Σ transaction_entries.amount` — the money ledger. */
  readonly total: string;
  /** `Σ investment_transactions.net_amount` — the investment ledger. */
  readonly investmentTotal: string;
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
 * **Phase 4 unions `investment_transactions.net_amount` into `movements`.** The
 * two ledgers are summed in one pass and kept as separate columns, because
 * `deriveBalance()` takes them as separate parameters — every rupee of movement
 * lives in exactly one ledger (I-13), and a mirroring row in the other would
 * credit the account twice.
 *
 * The union has **no `cash_settled` filter**, deliberately: `deriveBalance()`
 * sums `net_amount` unconditionally, and the `CHECK` behind invariant I-16
 * guarantees an unsettled row carries zero. Filtering here as well would hide a
 * broken constraint instead of surfacing it.
 */
async function entryTotals(
  ctx: ReadCtx,
  asOf: IsoDate | null,
  accountId?: string,
): Promise<Map<string, EntryTotal>> {
  const result = await ctx.db.execute<{
    account_id: string;
    total: string;
    investment_total: string;
    last_activity_on: string | null;
    entry_count: string;
  }>(sql`
    select a.id                                                          as account_id,
           coalesce(sum(m.amount) filter (where not m.is_investment), 0)::text as total,
           coalesce(sum(m.amount) filter (where m.is_investment), 0)::text     as investment_total,
           max(m.booked_on)::text                                        as last_activity_on,
           count(m.amount)::text                                         as entry_count
      from ${accounts} a
      left join (
        select e.account_id, e.amount, t.booked_on, false as is_investment
          from ${transactionEntries} e
          join ${transactions} t on t.id = e.transaction_id
         where t.user_id = ${ctx.userId}
           ${asOf === null ? sql`` : sql`and t.booked_on <= ${asOf}`}
        union all
        select i.account_id, i.net_amount, i.trade_date, true
          from ${investmentTransactions} i
         where i.user_id = ${ctx.userId}
           ${asOf === null ? sql`` : sql`and i.trade_date <= ${asOf}`}
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
        investmentTotal: row.investment_total,
        lastActivityOn: row.last_activity_on,
        entryCount: Number(row.entry_count),
      },
    ]),
  );
}

/**
 * `asOf === null` means the present-tense read. Two things depend on it and
 * both were previously wrong in the `asOf` path (N2, N3):
 *
 * - the **opening balance is gated by `opening_date`**, so an account opened in
 *   2026 contributes nothing to a 2020 figure (ADR-26);
 * - the **base-currency conversion uses the rate in force on the requested
 *   date**, not today's. The native balance honoured `asOf` and the base figure
 *   silently did not, which would have priced 2021's rupees at 2026's dollar.
 */
function toView(
  ctx: ReadCtx,
  row: AccountRow,
  total: EntryTotal | undefined,
  asOf: IsoDate | null,
): AccountView {
  const accountCurrency = currency(row.currencyCode.trim());
  const declaredOpening = Money.fromDbString(row.openingBalance, accountCurrency);
  const openingDate = isoDate(row.openingDate);

  // **"When `asOf` is omitted the bound is *today*"** (FINANCIAL-DOMAIN.md §3) —
  // not "unbounded". The distinction only shows on an account whose
  // `opening_date` is in the future: treating the default as unbounded let the
  // accounts page report its opening balance as money held **now**, while net
  // worth correctly excluded it. Two screens, one account, two figures. Found in
  // signed-in browser verification.
  //
  // The movement sums keep the caller's bound (`null` = unbounded), because that
  // is Phase 3 behaviour and a future-dated *transaction* is a different question
  // from an account that does not exist yet.
  const openingBound = asOf ?? ctx.today;
  const opening = openingContribution(declaredOpening, openingDate, openingBound);

  // Both sums are already in the account's own currency: `transaction_entries`
  // by its own currency column, and `investment_transactions.net_amount` by
  // OD-5. That is what lets `deriveBalance` add them without a currency
  // argument — and why `net_amount` is not the instrument's currency.
  const entries = total && total.total !== '0' ? [Money.fromDbString(total.total, accountCurrency)] : [];
  const investmentEntries =
    total && total.investmentTotal !== '0'
      ? [Money.fromDbString(total.investmentTotal, accountCurrency)]
      : [];
  const balance = deriveBalance(opening, entries, investmentEntries);

  const limit = row.creditLimit === null ? null : Money.fromDbString(row.creditLimit, accountCurrency);
  const converted = ctx.fx.toBase(balance, asOf ?? ctx.today);

  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    institution: row.institution,
    currency: accountCurrency,
    openingBalance: declaredOpening,
    openingDate,
    existedAsOf: existedAt(openingDate, openingBound),
    creditLimit: limit,
    isActive: row.isActive,
    displayOrder: row.displayOrder,
    notes: row.notes,
    balance,
    baseBalance: converted.ok ? metric(converted.value.amount) : unavailable('no_fx_rate'),
    availableCredit: limit === null ? null : availableCredit(limit, balance),
    role: accountRole(row.kind, balance),
    againstExpectedSign: isAgainstExpectedSign(row.kind, balance),
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
  // carry on" once it has fired. Nothing translates database errors (R-4): a
  // constraint that still fires is a bug, and surfaces as a fault.
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
  /** Which ledger the movement came from. A row is in exactly one (I-13). */
  readonly ledger: 'money' | 'investment';
  readonly bookedOn: IsoDate;
  readonly description: string;
  readonly kind: string;
  readonly categoryName: string | null;
  readonly counterAccountName: string | null;
  readonly amount: Money;
  readonly balance: Money;
}

/**
 * An account's ledger with a running balance.
 *
 * **Both ledgers**, unioned. A brokerage account's cash moves through
 * `investment_transactions.net_amount`, and `deriveBalance()` sums it — so a
 * ledger showing only `transaction_entries` would end on a running balance that
 * disagreed with the balance printed at the top of the same page. The union is a
 * *read* over two tables, not a second row: reporting may combine the ledgers,
 * and I-13 forbids a movement existing in both.
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
    ledger: 'money' | 'investment';
    booked_on: string;
    description: string;
    kind: string;
    category_name: string | null;
    counter_account_name: string | null;
    amount: string;
    sort_order: number;
  }>(sql`
    select e.id::text          as entry_id,
           t.id::text          as transaction_id,
           'money'             as ledger,
           t.booked_on::text   as booked_on,
           t.description       as description,
           t.kind::text        as kind,
           c.name              as category_name,
           counter.name        as counter_account_name,
           e.amount::text      as amount,
           t.created_at        as created_at,
           e.sort_order        as sort_order
      from ${transactionEntries} e
      join ${transactions} t on t.id = e.transaction_id
      left join ${categories} c on c.id = t.category_id
      left join ${transactionEntries} other
             on other.transaction_id = t.id and other.id <> e.id
      left join ${accounts} counter on counter.id = other.account_id
     where e.account_id = ${id} and t.user_id = ${ctx.userId}
    union all
    select i.id::text          as entry_id,
           i.id::text          as transaction_id,
           'investment'        as ledger,
           i.trade_date::text  as booked_on,
           coalesce(i.notes, '') as description,
           i.kind::text        as kind,
           null                as category_name,
           ins.symbol          as counter_account_name,
           i.net_amount::text  as amount,
           i.created_at        as created_at,
           0                   as sort_order
      from ${investmentTransactions} i
      left join ${instruments} ins on ins.id = i.instrument_id
     where i.account_id = ${id} and i.user_id = ${ctx.userId}
     order by booked_on asc, created_at asc, transaction_id asc, sort_order asc
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
    ledger: line.row.ledger,
    bookedOn: isoDate(line.row.booked_on),
    description:
      line.row.ledger === 'investment' && line.row.description === ''
        ? investmentLineDescription(line.row.kind, line.row.counter_account_name)
        : line.row.description,
    kind: line.row.kind,
    categoryName: line.row.category_name,
    counterAccountName: line.row.counter_account_name,
    amount: line.amount,
    balance: line.balance,
  }));

  return ok({ account: account.value, lines });
}

const INVESTMENT_KIND_LABELS: Record<string, string> = {
  buy: 'Buy',
  sell: 'Sell',
  mf_purchase: 'Purchase',
  mf_redemption: 'Redemption',
  dividend: 'Dividend',
  interest: 'Interest',
  fee: 'Fee',
  tax: 'Tax',
  split: 'Split',
  bonus: 'Bonus',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
};

/** A readable line for an investment row the user left unannotated. */
function investmentLineDescription(kind: string, symbol: string | null): string {
  const label = INVESTMENT_KIND_LABELS[kind] ?? kind;
  return symbol === null ? label : `${label} · ${symbol}`;
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
