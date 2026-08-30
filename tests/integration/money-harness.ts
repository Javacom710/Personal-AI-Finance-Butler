/**
 * Fixtures for the money integration layer.
 *
 * Everything here goes through the **application services**, not through raw
 * inserts, so a fixture that the services would reject cannot exist. The one
 * exception is `rawSql`, which the trigger tests use deliberately: their whole
 * purpose is to prove the database refuses a shape even when the service layer
 * is bypassed.
 */

import { sql } from 'drizzle-orm';
import { Pool } from 'pg';

import { isoDate, type IsoDate } from '@/lib/date';
import type { DomainError, Result } from '@/lib/result';
import { db } from '@/server/db/client';
import { categories, currencies, fxRates } from '@/server/db/schema';
import {
  createAccount,
  createReadCtx,
  createTransaction,
  createTransfer,
  withWriteCtx,
  type RequestCtx,
  type WriteCtx,
} from '@/server/services';
import { createTestUser } from './harness';

export interface MoneyFixture {
  readonly userId: string;
  readonly ctx: RequestCtx;
}

/** `today` is injected so time-dependent behaviour is testable without mocking a clock. */
export async function setupMoneyFixture(options: { readonly now?: Date } = {}): Promise<MoneyFixture> {
  const user = await createTestUser(`money-${Math.random().toString(36).slice(2, 10)}@example.com`);
  const ctx = await createReadCtx(user.userId, { now: options.now ?? new Date('2026-08-10T12:00:00Z') });
  if (!ctx.ok) throw new Error(`fixture context: ${ctx.error.message}`);
  return { userId: user.userId, ctx: ctx.value };
}

/** Rebuild the read context — needed after inserting FX rates, which are preloaded once. */
export async function refreshCtx(fixture: MoneyFixture): Promise<RequestCtx> {
  const ctx = await createReadCtx(fixture.userId, { now: fixture.ctx.now });
  if (!ctx.ok) throw new Error(`refresh context: ${ctx.error.message}`);
  return ctx.value;
}

export async function write<T>(ctx: RequestCtx, fn: (w: WriteCtx) => Promise<T>): Promise<T> {
  return withWriteCtx(ctx, fn);
}

/**
 * Unwrap a service result in a test.
 *
 * The failure message includes the field errors, not just `validation failed` —
 * without them a broken fixture reports the same sentence whatever went wrong.
 */
export function must<T>(result: Result<T, DomainError>): T {
  if (!result.ok) {
    const detail =
      result.error.code === 'validation_failed'
        ? Object.entries(result.error.fieldErrors)
            .map(([field, messages]) => `${field}: ${messages.join('; ')}`)
            .join(' | ')
        : result.error.message;
    throw new Error(`expected success, got ${result.error.code} — ${detail}`);
  }
  return result.value;
}

export interface AccountSpec {
  readonly name: string;
  readonly kind?: 'bank' | 'cash' | 'credit_card' | 'wallet' | 'brokerage' | 'loan' | 'other';
  readonly currencyCode?: string;
  readonly openingBalance?: string;
  readonly openingDate?: string;
  readonly creditLimit?: string;
}

export async function makeAccount(ctx: RequestCtx, spec: AccountSpec): Promise<string> {
  const account = await write(ctx, (w) =>
    createAccount(w, {
      name: spec.name,
      kind: spec.kind ?? 'bank',
      currencyCode: spec.currencyCode ?? 'INR',
      openingBalance: spec.openingBalance ?? '0',
      openingDate: spec.openingDate ?? '2020-01-01',
      creditLimit: spec.creditLimit,
    }),
  );
  return must(account).id;
}

/** Look a seeded category up by name, so tests read as "Food" rather than a uuid. */
export async function categoryId(ctx: RequestCtx, name: string): Promise<string> {
  const { rows } = await db().execute<{ id: string }>(
    sql`select id from ${categories} where user_id = ${ctx.userId} and name = ${name} limit 1`,
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`No seeded category named "${name}".`);
  return id;
}

export interface EntrySpec {
  readonly kind: 'income' | 'expense';
  readonly accountId: string;
  readonly categoryId: string;
  readonly amount: string;
  readonly bookedOn: string;
  readonly description?: string;
  readonly tags?: readonly string[];
}

export async function record(ctx: RequestCtx, spec: EntrySpec): Promise<string> {
  const result = await write(ctx, (w) =>
    createTransaction(w, {
      kind: spec.kind,
      accountId: spec.accountId,
      categoryId: spec.categoryId,
      amount: spec.amount,
      bookedOn: spec.bookedOn,
      description: spec.description ?? `${spec.kind} on ${spec.bookedOn}`,
      tags: spec.tags ?? [],
    }),
  );
  return must(result).id;
}

export interface TransferSpec {
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly amount?: string;
  readonly fromAmount?: string;
  readonly toAmount?: string;
  readonly bookedOn: string;
  readonly description?: string;
  readonly tags?: readonly string[];
}

export async function transfer(ctx: RequestCtx, spec: TransferSpec) {
  const result = await write(ctx, (w) =>
    createTransfer(w, {
      fromAccountId: spec.fromAccountId,
      toAccountId: spec.toAccountId,
      amount: spec.amount,
      fromAmount: spec.fromAmount,
      toAmount: spec.toAmount,
      bookedOn: spec.bookedOn,
      description: spec.description ?? 'Transfer',
      tags: spec.tags ?? [],
    }),
  );
  return must(result);
}

/**
 * Insert an FX rate.
 *
 * Written with the migration role because `currencies` and `fx_rates` are
 * reference data the application role may only read — the same restriction
 * production runs under.
 */
export async function addFxRate(
  base: string,
  quote: string,
  asOf: string,
  rate: string,
): Promise<void> {
  await adminExecute(
    `insert into fx_rates (base_code, quote_code, as_of, rate, source)
     values ($1, $2, $3, $4, 'test')
     on conflict (base_code, quote_code, as_of) do update set rate = excluded.rate`,
    [base, quote, asOf, rate],
  );
}

let adminPool: Pool | null = null;

async function adminExecute(text: string, values: unknown[] = []): Promise<{ rows: unknown[] }> {
  if (!adminPool) {
    const url = process.env['TEST_DATABASE_URL'];
    if (!url) throw new Error('TEST_DATABASE_URL is not set.');
    adminPool = new Pool({ connectionString: url, max: 2 });
  }
  return adminPool.query(text, values);
}

/**
 * Raw SQL as the migration role — for the trigger tests, which bypass the
 * services on purpose.
 *
 * Send **one statement per call**. A multi-statement string containing
 * `begin; … commit;` whose middle statement fails leaves the pooled connection
 * in an aborted transaction, still holding its locks, and the next `TRUNCATE`
 * then waits on it until the suite times out.
 */
export async function rawSql(text: string, values: unknown[] = []): Promise<{ rows: unknown[] }> {
  return adminExecute(text, values);
}

/**
 * The money tables, emptied between tests.
 *
 * Distinct from `truncateAll` because provisioning a user costs eleven Argon2id
 * hashes at 128 MiB — roughly three seconds. Keeping identity, settings and the
 * seeded categories in place turns a per-test cost into a per-file one.
 */
const MONEY_TABLES = [
  'transaction_tags',
  'transaction_entries',
  'transactions',
  'recurring_occurrences',
  'recurring_rules',
  'budgets',
  'tags',
  'accounts',
  'fx_rates',
  'audit_log',
  'jobs',
] as const;

export async function truncateMoney(): Promise<void> {
  await adminExecute(
    `truncate table ${MONEY_TABLES.map((t) => `"${t}"`).join(', ')} restart identity cascade`,
  );
}

export async function closeMoneyHarness(): Promise<void> {
  if (adminPool) {
    await adminPool.end();
    adminPool = null;
  }
}

export const iso = (s: string): IsoDate => isoDate(s);

export { currencies, fxRates };
