import 'server-only';

/**
 * Liabilities — two shapes, and only one of them carries money
 * ([FINANCIAL-DOMAIN.md §9.4](../../../docs/FINANCIAL-DOMAIN.md#94-asset-and-liability-lifecycle)).
 *
 * | Shape | `linked_account_id` | Contribution to net worth |
 * |---|---|---|
 * | **Transacted** | set (`UNIQUE`) | **none.** The account contributes, by sign |
 * | **Scheduled** | `NULL` | the latest `liability_balances` row `as_of <= T` |
 *
 * > **A `liabilities` row with `linked_account_id` set is metadata.** It carries
 * > the name, the kind, the interest rate, the EMI and the schedule dates. It
 * > carries **no money** into net worth. The money is the account's balance,
 * > counted once, by sign.
 *
 * That is the double-count guard (invariant I-8), and it is why this service
 * refuses an opening balance on a transacted liability: storing a figure nothing
 * reads is how a second source of truth begins.
 *
 * Three rules are enforced here rather than hoped for:
 *
 * - the linked account must be of kind `credit_card` or `loan` (**I-27**) — a
 *   link to a `bank` account would leave the liability contributing nothing
 *   *while the account contributed as an asset*, and the debt would disappear;
 * - closing writes a **terminal `outstanding = 0` row** before setting the flag
 *   (**I-28**), because under a date-driven rule the flag changes nothing;
 * - `interest_rate`, `emi_amount`, `started_on` and `ends_on` are **descriptive
 *   only**. Nothing derives an amortisation schedule, and the UI must not imply
 *   one.
 */

import { and, asc, desc, eq, sql } from 'drizzle-orm';

import { isoDate, type IsoDate } from '../../lib/date';
import { currency, isZero, Money, toDbString, type CurrencyCode } from '../../lib/decimal/money';
import { Rate, rToDbString } from '../../lib/decimal/rate';
import {
  closeLiabilitySchema,
  createLiabilitySchema,
  recordLiabilityBalanceSchema,
  updateLiabilitySchema,
  type CreateLiabilityInput,
} from '../../lib/schemas/networth';
import { conflict, err, ok, validationFailed, type DomainError, type Result } from '../../lib/result';
import { accounts, liabilities, liabilityBalances } from '../db/schema';
import type { ReadCtx, WriteCtx } from './_ctx';
import { requireOwnership } from './_guards';
import { fieldErrors } from './_validation';

export type LiabilityKind =
  | 'home_loan'
  | 'auto_loan'
  | 'personal_loan'
  | 'student_loan'
  | 'credit_card'
  | 'other';

/** The kinds of account a liability may be linked to (I-27). */
const LINKABLE_ACCOUNT_KINDS = new Set(['credit_card', 'loan']);

export interface LiabilityBalanceView {
  readonly id: string;
  readonly asOf: IsoDate;
  readonly outstanding: Money;
  readonly source: string;
}

export interface LiabilityView {
  readonly id: string;
  readonly name: string;
  readonly kind: LiabilityKind;
  readonly shape: 'transacted' | 'scheduled';
  readonly linkedAccountId: string | null;
  readonly linkedAccountName: string | null;
  readonly currency: CurrencyCode;
  readonly principalOriginal: Money | null;
  /** Descriptive only — nothing computes a schedule from it. */
  readonly interestRate: Rate | null;
  readonly emiAmount: Money | null;
  readonly startedOn: IsoDate | null;
  readonly endsOn: IsoDate | null;
  readonly isActive: boolean;
  readonly notes: string | null;
  /**
   * For a **scheduled** liability, the outstanding in force today. For a
   * **transacted** one this is `null` — the figure lives on the account, and
   * duplicating it here would be the double count this shape exists to prevent.
   */
  readonly outstanding: Money | null;
  readonly outstandingOn: IsoDate | null;
  readonly balanceCount: number;
}

interface LiabilityRow {
  id: string;
  userId: string;
  name: string;
  kind: LiabilityKind;
  linkedAccountId: string | null;
  currencyCode: string;
  principalOriginal: string | null;
  interestRate: string | null;
  emiAmount: string | null;
  startedOn: string | null;
  endsOn: string | null;
  isActive: boolean;
  notes: string | null;
}

// -------------------------------------------------------------------- queries

export async function listLiabilities(
  ctx: ReadCtx,
  options: { readonly includeClosed?: boolean } = {},
): Promise<LiabilityView[]> {
  const rows = (await ctx.db
    .select()
    .from(liabilities)
    .where(eq(liabilities.userId, ctx.userId))
    .orderBy(asc(liabilities.name))) as LiabilityRow[];

  const visible = options.includeClosed ? rows : rows.filter((r) => r.isActive);
  if (visible.length === 0) return [];

  const [latest, accountNames] = await Promise.all([
    latestBalances(ctx, ctx.today),
    linkedAccountNames(ctx),
  ]);

  return visible.map((row) => toLiabilityView(row, latest.get(row.id), accountNames.get(row.linkedAccountId ?? '')));
}

export async function getLiability(
  ctx: ReadCtx,
  id: string,
): Promise<Result<{ liability: LiabilityView; balances: LiabilityBalanceView[] }, DomainError>> {
  const [row] = (await ctx.db
    .select()
    .from(liabilities)
    .where(eq(liabilities.id, id))
    .limit(1)) as LiabilityRow[];

  const owned = requireOwnership(row, ctx.userId, 'liability', id);
  if (!owned.ok) return owned;

  const liabilityCurrency = currency(owned.value.currencyCode.trim());
  const series = await ctx.db
    .select()
    .from(liabilityBalances)
    .where(and(eq(liabilityBalances.userId, ctx.userId), eq(liabilityBalances.liabilityId, id)))
    .orderBy(desc(liabilityBalances.asOf));

  const balances: LiabilityBalanceView[] = series.map((b) => ({
    id: b.id,
    asOf: isoDate(b.asOf),
    outstanding: Money.fromDbString(b.outstanding, liabilityCurrency),
    source: b.source,
  }));

  const inForce = balances.find((b) => b.asOf <= ctx.today) ?? null;
  const names = await linkedAccountNames(ctx);

  return ok({
    liability: toLiabilityView(
      owned.value,
      inForce === null
        ? undefined
        : { outstanding: inForce.outstanding, asOf: inForce.asOf, count: balances.length },
      names.get(owned.value.linkedAccountId ?? ''),
    ),
    balances,
  });
}

interface LatestBalance {
  readonly outstanding: Money;
  readonly asOf: IsoDate;
  readonly count: number;
}

/** The outstanding in force at `asOf` for every liability, in one pass. */
async function latestBalances(ctx: ReadCtx, asOf: IsoDate): Promise<Map<string, LatestBalance>> {
  const { rows } = await ctx.db.execute<{
    liability_id: string;
    outstanding: string;
    as_of: string;
    currency_code: string;
    n: string;
  }>(sql`
    select distinct on (b.liability_id)
           b.liability_id::text as liability_id,
           b.outstanding::text  as outstanding,
           b.as_of::text        as as_of,
           l.currency_code      as currency_code,
           (select count(*) from ${liabilityBalances} c where c.liability_id = b.liability_id)::text as n
      from ${liabilityBalances} b
      join ${liabilities} l on l.id = b.liability_id
     where b.user_id = ${ctx.userId} and b.as_of <= ${asOf}
     order by b.liability_id, b.as_of desc
  `);

  return new Map(
    rows.map((r) => [
      r.liability_id,
      {
        outstanding: Money.fromDbString(r.outstanding, currency(r.currency_code.trim())),
        asOf: isoDate(r.as_of),
        count: Number(r.n),
      },
    ]),
  );
}

async function linkedAccountNames(ctx: ReadCtx): Promise<Map<string, string>> {
  const rows = await ctx.db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(eq(accounts.userId, ctx.userId));
  return new Map(rows.map((r) => [r.id, r.name]));
}

function toLiabilityView(
  row: LiabilityRow,
  latest: LatestBalance | undefined,
  linkedAccountName: string | undefined,
): LiabilityView {
  const liabilityCurrency = currency(row.currencyCode.trim());
  const shape: 'transacted' | 'scheduled' = row.linkedAccountId === null ? 'scheduled' : 'transacted';

  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    shape,
    linkedAccountId: row.linkedAccountId,
    linkedAccountName: linkedAccountName ?? null,
    currency: liabilityCurrency,
    principalOriginal:
      row.principalOriginal === null ? null : Money.fromDbString(row.principalOriginal, liabilityCurrency),
    interestRate: row.interestRate === null ? null : Rate.fromDbString(row.interestRate),
    emiAmount: row.emiAmount === null ? null : Money.fromDbString(row.emiAmount, liabilityCurrency),
    startedOn: row.startedOn === null ? null : isoDate(row.startedOn),
    endsOn: row.endsOn === null ? null : isoDate(row.endsOn),
    isActive: row.isActive,
    notes: row.notes,
    // A transacted liability reports no outstanding of its own, by design.
    outstanding: shape === 'transacted' ? null : (latest?.outstanding ?? null),
    outstandingOn: shape === 'transacted' ? null : (latest?.asOf ?? null),
    balanceCount: latest?.count ?? 0,
  };
}

// ------------------------------------------------------------------- commands

export async function createLiability(
  ctx: WriteCtx,
  raw: unknown,
): Promise<Result<LiabilityView, DomainError>> {
  const parsed = createLiabilitySchema.safeParse(raw);
  if (!parsed.success) return err(fieldErrors(parsed.error));
  const input: CreateLiabilityInput = parsed.data;

  const liabilityCurrency = currency(input.currencyCode);

  const duplicate = await findLiabilityByName(ctx, input.name);
  if (duplicate) return err(conflict(`A liability named "${input.name}" already exists.`));

  if (input.linkedAccountId !== undefined) {
    const guard = await requireLinkableAccount(ctx, input.linkedAccountId);
    if (!guard.ok) return guard;
  }

  const money = (value: string | undefined, field: string): Result<Money | null, DomainError> => {
    if (value === undefined) return ok(null);
    const parsedValue = Money.parseUserInput(value, liabilityCurrency);
    return parsedValue.ok ? ok(parsedValue.value) : err(validationFailed({ [field]: [parsedValue.error.message] }));
  };

  const principal = money(input.principalOriginal, 'principalOriginal');
  if (!principal.ok) return principal;
  const emi = money(input.emiAmount, 'emiAmount');
  if (!emi.ok) return emi;

  let interestRate: Rate | null = null;
  if (input.interestRate !== undefined) {
    const parsedRate = Rate.parseUserInput(input.interestRate);
    if (!parsedRate.ok) return err(validationFailed({ interestRate: [parsedRate.error.message] }));
    interestRate = parsedRate.value;
  }

  const [inserted] = await ctx.tx
    .insert(liabilities)
    .values({
      userId: ctx.userId,
      name: input.name,
      kind: input.kind,
      linkedAccountId: input.linkedAccountId ?? null,
      currencyCode: liabilityCurrency,
      principalOriginal: principal.value === null ? null : toDbString(principal.value),
      interestRate: interestRate === null ? null : rToDbString(interestRate),
      emiAmount: emi.value === null ? null : toDbString(emi.value),
      startedOn: input.startedOn ?? null,
      endsOn: input.endsOn ?? null,
      notes: input.notes ?? null,
    })
    .returning();

  if (inserted === undefined) throw new Error('Insert of a liability returned no row.');

  // Scheduled shape only. The schema already rejects a balance on a transacted
  // liability; this is the other half of the same rule.
  if (input.linkedAccountId === undefined && input.openingBalance !== undefined) {
    const opening = Money.parseUserInput(input.openingBalance, liabilityCurrency);
    if (!opening.ok) return err(validationFailed({ openingBalance: [opening.error.message] }));
    await ctx.tx.insert(liabilityBalances).values({
      userId: ctx.userId,
      liabilityId: inserted.id,
      asOf: input.openingBalanceOn ?? input.startedOn ?? ctx.today,
      outstanding: toDbString(opening.value),
      source: 'manual',
    });
  }

  await ctx.audit.record({
    actor: 'user',
    action: 'liability.create',
    entityType: 'liability',
    entityId: inserted.id,
    after: inserted,
  });

  const view = await getLiability(ctx, inserted.id);
  return view.ok ? ok(view.value.liability) : view;
}

export async function updateLiability(
  ctx: WriteCtx,
  id: string,
  raw: unknown,
): Promise<Result<LiabilityView, DomainError>> {
  const parsed = updateLiabilitySchema.safeParse(raw);
  if (!parsed.success) return err(fieldErrors(parsed.error));
  const input = parsed.data;

  const [existing] = (await ctx.tx
    .select()
    .from(liabilities)
    .where(eq(liabilities.id, id))
    .limit(1)) as LiabilityRow[];
  const owned = requireOwnership(existing, ctx.userId, 'liability', id);
  if (!owned.ok) return owned;

  const liabilityCurrency = currency(owned.value.currencyCode.trim());
  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if (input.name !== undefined && input.name !== owned.value.name) {
    const duplicate = await findLiabilityByName(ctx, input.name);
    if (duplicate) return err(conflict(`A liability named "${input.name}" already exists.`));
    patch['name'] = input.name;
  }
  if (input.kind !== undefined) patch['kind'] = input.kind;
  if (input.startedOn !== undefined) patch['startedOn'] = input.startedOn || null;
  if (input.endsOn !== undefined) patch['endsOn'] = input.endsOn || null;
  if (input.notes !== undefined) patch['notes'] = input.notes || null;

  for (const [field, column] of [
    ['principalOriginal', 'principalOriginal'],
    ['emiAmount', 'emiAmount'],
  ] as const) {
    const value = input[field];
    if (value === undefined) continue;
    if (value === null || value === '') {
      patch[column] = null;
      continue;
    }
    const amount = Money.parseUserInput(value, liabilityCurrency);
    if (!amount.ok) return err(validationFailed({ [field]: [amount.error.message] }));
    patch[column] = toDbString(amount.value);
  }

  if (input.interestRate !== undefined) {
    if (input.interestRate === null || input.interestRate === '') {
      patch['interestRate'] = null;
    } else {
      const rate = Rate.parseUserInput(input.interestRate);
      if (!rate.ok) return err(validationFailed({ interestRate: [rate.error.message] }));
      patch['interestRate'] = rToDbString(rate.value);
    }
  }

  // `linked_account_id` and `currency_code` are not editable: changing the link
  // silently moves the debt between two shapes, and changing the currency
  // reinterprets the whole balance series.
  const [updated] = await ctx.tx.update(liabilities).set(patch).where(eq(liabilities.id, id)).returning();
  if (updated === undefined) throw new Error('Update of a liability returned no row.');

  await ctx.audit.record({
    actor: 'user',
    action: 'liability.update',
    entityType: 'liability',
    entityId: id,
    before: owned.value,
    after: updated,
  });

  const view = await getLiability(ctx, id);
  return view.ok ? ok(view.value.liability) : view;
}

/** Record a new outstanding figure. Scheduled liabilities only; never updates a row. */
export async function recordLiabilityBalance(
  ctx: WriteCtx,
  raw: unknown,
): Promise<Result<LiabilityBalanceView, DomainError>> {
  const parsed = recordLiabilityBalanceSchema.safeParse(raw);
  if (!parsed.success) return err(fieldErrors(parsed.error));
  const input = parsed.data;

  const [existing] = (await ctx.tx
    .select()
    .from(liabilities)
    .where(eq(liabilities.id, input.liabilityId))
    .limit(1)) as LiabilityRow[];
  const owned = requireOwnership(existing, ctx.userId, 'liability', input.liabilityId);
  if (!owned.ok) return owned;

  if (owned.value.linkedAccountId !== null) {
    return err(
      conflict(
        `${owned.value.name} takes its outstanding balance from its linked account. ` +
          'Record the repayment against that account instead — a balance here would be ignored, ' +
          'and a figure nothing reads is a second source of truth waiting to drift.',
      ),
    );
  }

  const liabilityCurrency = currency(owned.value.currencyCode.trim());
  const outstanding = Money.parseUserInput(input.outstanding, liabilityCurrency);
  if (!outstanding.ok) return err(validationFailed({ outstanding: [outstanding.error.message] }));

  const [clash] = await ctx.tx
    .select({ id: liabilityBalances.id })
    .from(liabilityBalances)
    .where(and(eq(liabilityBalances.liabilityId, input.liabilityId), eq(liabilityBalances.asOf, input.asOf)))
    .limit(1);
  if (clash) {
    return err(
      conflict(`${owned.value.name} already has a balance dated ${input.asOf}. Delete that one first.`),
    );
  }

  const [inserted] = await ctx.tx
    .insert(liabilityBalances)
    .values({
      userId: ctx.userId,
      liabilityId: input.liabilityId,
      asOf: input.asOf,
      outstanding: toDbString(outstanding.value),
      source: 'manual',
    })
    .returning();

  if (inserted === undefined) throw new Error('Insert of a liability balance returned no row.');

  await ctx.audit.record({
    actor: 'user',
    action: 'liability.record_balance',
    entityType: 'liability',
    entityId: input.liabilityId,
    after: inserted,
  });

  return ok({
    id: inserted.id,
    asOf: isoDate(inserted.asOf),
    outstanding: Money.fromDbString(inserted.outstanding, liabilityCurrency),
    source: inserted.source,
  });
}

/**
 * Close a liability.
 *
 * For a **scheduled** liability this writes a terminal `outstanding = 0` row
 * dated on the closing date **before** setting the flag (invariant I-28).
 * Without it a date-driven rule would keep the last non-zero balance in force
 * forever — the flag is not read by any calculation.
 *
 * For a **transacted** liability the account's balance must already be zero:
 * there is no balance here to terminate, and closing while the account still
 * carries a balance would hide a live debt behind an inactive label.
 */
export async function closeLiability(
  ctx: WriteCtx,
  raw: unknown,
): Promise<Result<LiabilityView, DomainError>> {
  const parsed = closeLiabilitySchema.safeParse(raw);
  if (!parsed.success) return err(fieldErrors(parsed.error));
  const input = parsed.data;

  const [existing] = (await ctx.tx
    .select()
    .from(liabilities)
    .where(eq(liabilities.id, input.liabilityId))
    .limit(1)) as LiabilityRow[];
  const owned = requireOwnership(existing, ctx.userId, 'liability', input.liabilityId);
  if (!owned.ok) return owned;

  const liabilityCurrency = currency(owned.value.currencyCode.trim());

  if (owned.value.linkedAccountId === null) {
    const [clash] = await ctx.tx
      .select({ id: liabilityBalances.id, outstanding: liabilityBalances.outstanding })
      .from(liabilityBalances)
      .where(
        and(
          eq(liabilityBalances.liabilityId, input.liabilityId),
          eq(liabilityBalances.asOf, input.closedOn),
        ),
      )
      .limit(1);

    if (clash) {
      const existingZero = isZero(Money.fromDbString(clash.outstanding, liabilityCurrency));
      if (!existingZero) {
        return err(
          conflict(
            `${owned.value.name} already has a non-zero balance dated ${input.closedOn}. ` +
              'Closing writes a zero balance on that date; delete or re-date the existing row first.',
          ),
        );
      }
    } else {
      await ctx.tx.insert(liabilityBalances).values({
        userId: ctx.userId,
        liabilityId: input.liabilityId,
        asOf: input.closedOn,
        outstanding: '0',
        source: 'close',
      });
    }
  }

  await ctx.tx
    .update(liabilities)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(liabilities.id, input.liabilityId));

  await ctx.audit.record({
    actor: 'user',
    action: 'liability.close',
    entityType: 'liability',
    entityId: input.liabilityId,
    before: { isActive: owned.value.isActive },
    after: { isActive: false, closedOn: input.closedOn },
  });

  const view = await getLiability(ctx, input.liabilityId);
  return view.ok ? ok(view.value.liability) : view;
}

export async function deleteLiability(ctx: WriteCtx, id: string): Promise<Result<void, DomainError>> {
  const [existing] = (await ctx.tx
    .select()
    .from(liabilities)
    .where(eq(liabilities.id, id))
    .limit(1)) as LiabilityRow[];
  const owned = requireOwnership(existing, ctx.userId, 'liability', id);
  if (!owned.ok) return owned;

  const [{ n } = { n: 0 }] = await ctx.tx
    .select({ n: sql<number>`count(*)::int` })
    .from(liabilityBalances)
    .where(eq(liabilityBalances.liabilityId, id));

  if (n > 1) {
    return err(
      conflict(
        `${owned.value.name} has ${n} recorded balances. Deleting them would rewrite past ` +
          'net-worth figures — close it instead, which keeps the history and stops it counting.',
      ),
    );
  }

  await ctx.tx.delete(liabilities).where(eq(liabilities.id, id));
  await ctx.audit.record({
    actor: 'user',
    action: 'liability.delete',
    entityType: 'liability',
    entityId: id,
    before: owned.value,
  });

  return ok(undefined);
}

// -------------------------------------------------------------------- guards

/**
 * Invariant **I-27**: a linked account must be one whose balance represents the
 * debt. A link to a `bank` account leaves the liability contributing nothing
 * *while the account contributes as an asset* — the debt disappears entirely.
 *
 * Cross-table, so it cannot be a `CHECK`. `verify:integrity` asserts the same
 * thing against data that is already there.
 */
async function requireLinkableAccount(
  ctx: WriteCtx,
  accountId: string,
): Promise<Result<void, DomainError>> {
  const [account] = await ctx.tx
    .select({ id: accounts.id, userId: accounts.userId, kind: accounts.kind, name: accounts.name })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);

  const owned = requireOwnership(account, ctx.userId, 'account', accountId);
  if (!owned.ok) return owned;

  if (!LINKABLE_ACCOUNT_KINDS.has(owned.value.kind)) {
    return err(
      validationFailed({
        linkedAccountId: [
          `${owned.value.name} is a ${owned.value.kind} account. A liability can only be linked to a ` +
            'credit card or a loan account — linking it to anything else would leave the debt ' +
            'counted nowhere while the account counted as an asset.',
        ],
      }),
    );
  }

  const [taken] = await ctx.tx
    .select({ id: liabilities.id, name: liabilities.name })
    .from(liabilities)
    .where(eq(liabilities.linkedAccountId, accountId))
    .limit(1);

  if (taken) {
    return err(
      conflict(
        `${owned.value.name} is already represented by the liability "${taken.name}". ` +
          'Two liabilities cannot claim one account.',
      ),
    );
  }

  return ok(undefined);
}

async function findLiabilityByName(ctx: WriteCtx, name: string): Promise<string | null> {
  const [row] = await ctx.tx
    .select({ id: liabilities.id })
    .from(liabilities)
    .where(and(eq(liabilities.userId, ctx.userId), eq(liabilities.name, name)))
    .limit(1);
  return row?.id ?? null;
}
