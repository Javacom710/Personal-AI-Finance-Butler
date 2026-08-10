import 'server-only';

/**
 * The service context — and the write boundary (FINANCIAL-DOMAIN.md §11,
 * ADR-21).
 *
 * ```ts
 * listTransactions (ctx: ReadCtx,  q)     // queries
 * createTransaction(ctx: WriteCtx, input) // commands
 * ```
 *
 * A caller that can only construct a `ReadCtx` — no `tx`, no `audit` —
 * **cannot call a command at all**: it is a type error caught by `tsc`, not a
 * lint rule and not a review comment. The AI tool layer of Phase 7 is exactly
 * such a caller, which is what makes "the AI cannot write" a structural claim
 * rather than a hopeful one.
 *
 * `now` is injected rather than read from the clock inside a calculation, so
 * every time-dependent result is testable without mocking a global.
 *
 * `db` is deliberately the same field on both: inside `withWriteCtx` it *is* the
 * transaction handle. A read performed during a command therefore sees the
 * command's own uncommitted writes, and no call site has to remember to pick
 * between two handles.
 */

import { eq } from 'drizzle-orm';

import { todayIn, type IsoDate } from '../../lib/date';
import { currency, type CurrencyCode } from '../../lib/decimal/money';
import { notFound, type DomainError, type Result } from '../../lib/result';
import { db, type DbExecutor, type DbTransaction } from '../db/client';
import { settings, userState } from '../db/schema';
import { createAuditWriter, type AuditWriter } from './_audit';
import { createFxLookup, type FxLookup } from './_fx';
import { sql } from 'drizzle-orm';

export interface ReadCtx {
  readonly userId: string;
  /** Injected. No calculation calls `new Date()` (FINANCIAL-DOMAIN.md §10.1). */
  readonly now: Date;
  /** "Today" in the user's timezone, not the server's. */
  readonly today: IsoDate;

  readonly base: CurrencyCode;
  readonly locale: string;
  readonly timezone: string;
  readonly fiscalYearStartMonth: number;

  readonly fx: FxLookup;
  readonly db: DbExecutor;
}

export interface WriteCtx extends ReadCtx {
  readonly tx: DbTransaction;
  readonly audit: AuditWriter;
}

export interface UserSettings {
  readonly base: CurrencyCode;
  readonly locale: string;
  readonly timezone: string;
  readonly fiscalYearStartMonth: number;
}

export async function loadSettings(
  executor: DbExecutor,
  userId: string,
): Promise<Result<UserSettings, DomainError>> {
  const [row] = await executor
    .select({
      baseCurrency: settings.baseCurrency,
      locale: settings.locale,
      timezone: settings.timezone,
      fiscalYearStartMonth: settings.fiscalYearStartMonth,
    })
    .from(settings)
    .where(eq(settings.userId, userId))
    .limit(1);

  if (!row) {
    return { ok: false, error: notFound('settings', userId) };
  }

  return {
    ok: true,
    value: {
      base: currency(row.baseCurrency.trim()),
      locale: row.locale,
      timezone: row.timezone,
      fiscalYearStartMonth: row.fiscalYearStartMonth,
    },
  };
}

/**
 * Build a read context for a request.
 *
 * The FX lookup is loaded once here rather than per query, so the engine can
 * stay synchronous: a pure calculation must not await a rate lookup mid-sum.
 */
export async function createReadCtx(
  userId: string,
  options: { readonly now?: Date; readonly executor?: DbExecutor } = {},
): Promise<Result<ReadCtx, DomainError>> {
  const executor = options.executor ?? db();
  const loaded = await loadSettings(executor, userId);
  if (!loaded.ok) return loaded;

  const now = options.now ?? new Date();
  const fx = await createFxLookup(executor, loaded.value.base);

  return {
    ok: true,
    value: {
      userId,
      now,
      today: todayIn(loaded.value.timezone, now),
      base: loaded.value.base,
      locale: loaded.value.locale,
      timezone: loaded.value.timezone,
      fiscalYearStartMonth: loaded.value.fiscalYearStartMonth,
      fx,
      db: executor,
    },
  };
}

/**
 * Open the transaction boundary. **Application services are the only layer
 * permitted to call this** (ARCHITECTURE.md §2) — the engine holds no database
 * handle, so it cannot write even by accident.
 *
 * The whole use case runs inside one transaction: the rows, the audit entry and
 * the `money_ledger_version` bump commit together or not at all. A failed write
 * therefore leaves no orphan entry, no bumped version and no audit row.
 */
export async function withWriteCtx<T>(
  ctx: ReadCtx,
  fn: (write: WriteCtx) => Promise<T>,
  options: { readonly requestId?: string } = {},
): Promise<T> {
  return db().transaction(async (tx) => {
    const write: WriteCtx = {
      ...ctx,
      db: tx,
      tx,
      audit: createAuditWriter(tx, ctx.userId, options.requestId ?? null),
    };
    return fn(write);
  });
}

/**
 * Bump `money_ledger_version` (ARCHITECTURE.md §6).
 *
 * Called inside every ledger mutation, in the same transaction as the mutation
 * itself. Derived artefacts record the version they were computed from, so a
 * counter that moved without the data — or data that moved without the counter —
 * would leave a stale cache that looks fresh.
 */
export async function bumpMoneyLedgerVersion(ctx: WriteCtx): Promise<bigint> {
  const [row] = await ctx.tx
    .update(userState)
    .set({ moneyLedgerVersion: sql`${userState.moneyLedgerVersion} + 1` })
    .where(eq(userState.userId, ctx.userId))
    .returning({ version: userState.moneyLedgerVersion });

  if (!row) {
    throw new Error(
      `No user_state row for ${ctx.userId}. Every account is provisioned with one; ` +
        'its absence means a half-created user.',
    );
  }
  return row.version;
}

export async function currentMoneyLedgerVersion(ctx: ReadCtx): Promise<bigint> {
  const [row] = await ctx.db
    .select({ version: userState.moneyLedgerVersion })
    .from(userState)
    .where(eq(userState.userId, ctx.userId))
    .limit(1);
  return row?.version ?? 0n;
}
