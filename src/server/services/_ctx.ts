import 'server-only';

/**
 * The service context — and the write boundary (FINANCIAL-DOMAIN.md §11,
 * ADR-21).
 *
 * ```ts
 * listTransactions (ctx: ReadCtx,    q)     // queries
 * createTransaction(ctx: WriteCtx,   input) // commands
 * withWriteCtx     (ctx: RequestCtx, fn)    // the escalation, and its gate
 * ```
 *
 * **Three types, because two were not enough** ([ADR-33](../../../docs/DECISIONS.md#adr-33--the-transaction-opener-is-a-capability-carried-on-the-context-not-an-ambient-import)).
 *
 * A caller holding a `ReadCtx` cannot call a command: no `tx`, no `audit`, so it
 * is a type error caught by `tsc`. That much was always true. What was **not**
 * true — and what the Phase 7 review found as **F-1** — is that such a caller
 * could simply *manufacture* the missing fields:
 *
 * ```ts
 * withWriteCtx(readCtx, (write) => createTransaction(write, …))  // compiled clean
 * ```
 *
 * because `withWriteCtx` took a `ReadCtx` and opened the transaction itself, by
 * calling `db()` as an ambient import. Any `ReadCtx` holder was therefore one
 * line away from a `WriteCtx`, and the documented guarantee that "the AI layer
 * holds only a `ReadCtx`, so a write from AI code does not compile" was false.
 *
 * The fix is to make opening a transaction a **capability carried on the
 * context** rather than a function anyone can reach: `RequestCtx` is a `ReadCtx`
 * that additionally holds `beginTransaction`, and `withWriteCtx` requires one.
 * The capability is granted by `createReadCtx`, which is the request context of
 * a *user-initiated* action. A context built for the AI layer is an
 * {@link ../ai-read/index.AiReadCtx}, which carries no capability, no database
 * handle, and is not a `ReadCtx` at all — so both the escalation and the raw
 * query are rejected by `tsc`, not by a lint rule and not by a review comment.
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

/**
 * Opens the write transaction. Injected rather than imported so that holding
 * one is a *capability*, and lacking one is a compile error (ADR-33).
 */
export type TransactionOpener = <T>(fn: (tx: DbTransaction) => Promise<T>) => Promise<T>;

/**
 * The request context of a **user-initiated action**: everything a `ReadCtx`
 * has, plus the capability to open the write transaction.
 *
 * Granted by `createReadCtx` and by nothing else. `withWriteCtx` requires it, so
 * a context that lacks `beginTransaction` cannot escalate — which is the whole
 * of finding **F-1**'s fix. Nothing else about the type is special: it is not a
 * phantom brand but a real, used field, so the guarantee cannot be lost to a
 * refactor that "tidies away an unused property".
 */
export interface RequestCtx extends ReadCtx {
  readonly beginTransaction: TransactionOpener;
}

export interface WriteCtx extends RequestCtx {
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
): Promise<Result<RequestCtx, DomainError>> {
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
      // The capability, granted here and nowhere else. `db()` rather than
      // `executor` deliberately: a transaction must run on the pool, not on
      // whatever handle a caller happened to pass for reading.
      beginTransaction: (fn) => db().transaction(fn),
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
 *
 * **Takes a `RequestCtx`, not a `ReadCtx`** (ADR-33). The transaction is opened
 * through the capability the context carries, so a caller that was handed only
 * read access cannot reach this function's effect by calling it — the argument
 * does not type-check. This is finding **F-1**.
 */
export async function withWriteCtx<T>(
  ctx: RequestCtx,
  fn: (write: WriteCtx) => Promise<T>,
  options: { readonly requestId?: string } = {},
): Promise<T> {
  return ctx.beginTransaction(async (tx) => {
    const write: WriteCtx = {
      ...ctx,
      db: tx,
      tx,
      audit: createAuditWriter(tx, ctx.userId, options.requestId ?? null),
    };
    return fn(write);
  });
}

/** Carries a domain error out of a transaction so the transaction rolls back with it. */
class CommandFailed extends Error {
  constructor(readonly domainError: DomainError) {
    super(domainError.message);
    this.name = 'CommandFailed';
  }
}

/**
 * `withWriteCtx` for a command that returns a `Result` — **and rolls back when
 * the result is an error.**
 *
 * Returning an error value from inside an open transaction does **not** undo the
 * writes already made in it: the callback resolved, so the driver commits. That
 * is fine for a command that fails before writing anything, and wrong for one
 * that fails after — which is exactly the shape of an investment mutation, where
 * the row is inserted and the ledger version bumped *before* the rebuild can
 * discover an oversell.
 *
 * Phase 3 met the same problem inside `postOccurrence` and solved it with a
 * savepoint (D-21). This is the general form: the error is thrown so the
 * transaction unwinds, then caught here and returned as the value the caller
 * expected. TESTING.md §4's requirement — *"a failed write inside an application
 * service rolls back completely: no orphan entries, no bumped `ledger_version`,
 * no audit row"* — is a property of this function rather than of each service.
 */
export async function withWriteCtxResult<T>(
  ctx: RequestCtx,
  fn: (write: WriteCtx) => Promise<Result<T, DomainError>>,
  options: { readonly requestId?: string } = {},
): Promise<Result<T, DomainError>> {
  try {
    return await withWriteCtx(
      ctx,
      async (write) => {
        const result = await fn(write);
        if (!result.ok) throw new CommandFailed(result.error);
        return result;
      },
      options,
    );
  } catch (error) {
    if (error instanceof CommandFailed) return { ok: false, error: error.domainError };
    throw error;
  }
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

/**
 * Bump `investment_ledger_version` — the investment ledger's counterpart.
 *
 * Bumped by any change to `investment_transactions`, and by a change to an
 * instrument's `cost_basis_method`, which rewrites derived history just as a
 * trade does (ARCHITECTURE.md §6).
 *
 * The returned version is stamped onto every `positions` row the same
 * transaction rebuilds. That stamp is **provenance, not staleness**: nothing
 * compares it against this counter to decide whether to rebuild, because the
 * counter is global per user and every position but the rebuilt one would look
 * stale forever. Correctness comes from the rebuild sharing this transaction.
 */
export async function bumpInvestmentLedgerVersion(ctx: WriteCtx): Promise<bigint> {
  const [row] = await ctx.tx
    .update(userState)
    .set({ investmentLedgerVersion: sql`${userState.investmentLedgerVersion} + 1` })
    .where(eq(userState.userId, ctx.userId))
    .returning({ version: userState.investmentLedgerVersion });

  if (!row) {
    throw new Error(
      `No user_state row for ${ctx.userId}. Every account is provisioned with one; ` +
        'its absence means a half-created user.',
    );
  }
  return row.version;
}

export async function currentInvestmentLedgerVersion(ctx: ReadCtx): Promise<bigint> {
  const [row] = await ctx.db
    .select({ version: userState.investmentLedgerVersion })
    .from(userState)
    .where(eq(userState.userId, ctx.userId))
    .limit(1);
  return row?.version ?? 0n;
}
