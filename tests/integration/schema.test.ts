import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/server/db/client';
import { categories, currencies, settings, userState, users } from '@/server/db/schema';
import { DEFAULT_CATEGORIES, seedDefaultCategories } from '@/server/db/seed';
import { closeHarness, createTestUser, truncateAll } from './harness';

beforeEach(truncateAll);
afterAll(closeHarness);

describe('migration', () => {
  it('created every Phase 2, 3 and 4 table, and nothing from a later phase', async () => {
    const result = await db().execute<{ tablename: string }>(
      sql`select tablename from pg_tables where schemaname = 'public' order by tablename`,
    );
    const tables = result.rows.map((r) => r.tablename);

    expect(tables).toEqual(
      expect.arrayContaining([
        // Phase 2 — foundation
        'audit_log',
        'auth_events',
        'currencies',
        'fx_rates',
        'jobs',
        'sessions',
        'settings',
        'user_state',
        'users',
        // Phase 3 — the money core
        'accounts',
        'budgets',
        'categories',
        'recurring_occurrences',
        'recurring_rules',
        'tags',
        'transaction_entries',
        'transaction_tags',
        'transactions',
        // Phase 4 — instruments, prices and the investment ledger
        'instruments',
        'instrument_prices',
        'instrument_quotes',
        'investment_transactions',
        'tax_lots',
        'lot_disposals',
        'positions',
        // Phase 5 — manual assets and liabilities
        'manual_assets',
        'asset_valuations',
        'liabilities',
        'liability_balances',
        // Phase 6 — market-data observations that are deliberately NOT the ledger
        'corporate_action_detections',
      ]),
    );

    // Phase 6+ tables must not exist yet — building ahead of the phase is how a
    // reviewed schema turns into an unreviewed one.
    //
    // `net_worth_snapshots` is on this list DELIBERATELY: net worth is derived on
    // demand and stores nothing, so the snapshot table is Phase 6 work if a
    // measurement ever justifies it (ADR-24). Its presence here would mean the
    // scope boundary had been crossed.
    for (const later of [
      'net_worth_snapshots',
      'ai_proposals',
      'ai_conversations',
    ]) {
      expect(tables, `${later} belongs to a later phase`).not.toContain(later);
    }
  });

  it('created the enum types, so a bad value cannot be inserted by any client', async () => {
    const result = await db().execute<{ typname: string }>(
      sql`select typname from pg_type where typtype = 'e' order by typname`,
    );
    const types = result.rows.map((r) => r.typname);
    expect(types).toEqual(
      expect.arrayContaining([
        'audit_actor',
        'auth_event_kind',
        'job_status',
        'account_kind',
        'budget_period',
        'category_kind',
        'occurrence_status',
        'record_source',
        'recurring_kind',
        'transaction_kind',
        'asset_class',
        'cost_basis_method',
        'investment_kind',
      ]),
    );
  });

  it('created the shape triggers that enforce I-1 to I-3 below the application', async () => {
    const result = await db().execute<{ tgname: string }>(
      sql`select tgname from pg_trigger where not tgisinternal order by tgname`,
    );
    expect(result.rows.map((r) => r.tgname)).toEqual([
      'categories_shape_check',
      'transaction_entries_shape_check',
      'transactions_shape_check',
    ]);
  });

  it('rejects a value outside an enum', async () => {
    await expect(
      db().execute(sql`insert into jobs (kind, status) values ('x', 'not_a_status')`),
    ).rejects.toThrow();
  });

  it('enabled citext, so email uniqueness is case-insensitive', async () => {
    await createTestUser('Case@Example.com');
    await expect(createTestUser('case@example.com')).rejects.toThrow();
  });
});

describe('constraints', () => {
  it('enforces the fiscal-month range', async () => {
    const user = await createTestUser();
    await expect(
      db()
        .update(settings)
        .set({ fiscalYearStartMonth: 13 })
        .where(sql`${settings.userId} = ${user.userId}`),
    ).rejects.toThrow();
  });

  it('enforces a positive FX rate', async () => {
    await expect(
      db().execute(
        sql`insert into fx_rates (base_code, quote_code, as_of, rate, source)
            values ('USD', 'INR', '2026-08-09', -1, 'test')`,
      ),
    ).rejects.toThrow();
  });

  it('cascades a user deletion to every user-owned row', async () => {
    const user = await createTestUser();

    const before = await db().select().from(settings);
    expect(before).toHaveLength(1);

    await db().delete(users).where(sql`${users.id} = ${user.userId}`);

    expect(await db().select().from(settings)).toHaveLength(0);
    expect(await db().select().from(userState)).toHaveLength(0);
  });

  it('keeps reference data out of the cascade', async () => {
    const user = await createTestUser();
    await db().delete(users).where(sql`${users.id} = ${user.userId}`);
    expect(await db().select().from(currencies)).toHaveLength(12);
  });
});

describe('numeric fidelity', () => {
  /**
   * The round-trip that ADR-04 exists to guarantee. A float column would lose
   * the fourth decimal place here; NUMERIC(20,10) read back as a string does not.
   */
  it('round-trips a NUMERIC(20,10) rate without loss', async () => {
    await db().execute(
      sql`insert into fx_rates (base_code, quote_code, as_of, rate, source)
          values ('USD', 'INR', '2026-08-09', 83.2512345678, 'test')`,
    );

    const result = await db().execute<{ rate: string }>(
      sql`select rate from fx_rates where base_code = 'USD' and quote_code = 'INR'`,
    );

    expect(result.rows[0]?.rate).toBe('83.2512345678');
  });

  it('rejects a rate with more precision than the column holds, rather than rounding it silently', async () => {
    // NUMERIC(20,10) rounds the 11th decimal; assert the stored value is the
    // rounded one and that nothing beyond scale survives.
    await db().execute(
      sql`insert into fx_rates (base_code, quote_code, as_of, rate, source)
          values ('EUR', 'INR', '2026-08-09', 1.00000000005, 'test')`,
    );
    const result = await db().execute<{ rate: string }>(
      sql`select rate from fx_rates where base_code = 'EUR'`,
    );
    expect(result.rows[0]?.rate).toBe('1.0000000001');
  });
});

describe('seed', () => {
  it('loaded the reference currencies with their display scales', async () => {
    const rows = await db().select().from(currencies);
    expect(rows).toHaveLength(12);

    const jpy = rows.find((r) => r.code === 'JPY');
    const inr = rows.find((r) => r.code === 'INR');
    expect(jpy?.minorUnits).toBe(0);
    expect(inr?.minorUnits).toBe(2);
    expect(inr?.symbol).toBe('₹');
  });

  it('gives a new account its default categories, so the first transaction needs no setup', async () => {
    const user = await createTestUser('categories@example.com');

    const rows = await db()
      .select({ name: categories.name, kind: categories.kind, parentId: categories.parentId })
      .from(categories)
      .where(sql`${categories.userId} = ${user.userId}`);

    const childCount = DEFAULT_CATEGORIES.reduce((n, c) => n + (c.children?.length ?? 0), 0);
    // Every default must land. `ON CONFLICT DO NOTHING` makes re-seeding safe
    // and would also swallow a duplicate name, so the count is asserted rather
    // than assumed — a missing category is invisible until it is needed.
    expect(rows.length).toBe(DEFAULT_CATEGORIES.length + childCount);
    expect(rows.some((r) => r.name === 'Food' && r.parentId === null)).toBe(true);
    // The parents matter, not only the leaves: "how much did I spend on food?"
    // needs a Food parent for Groceries and Dining to roll up into.
    expect(rows.some((r) => r.name === 'Dining' && r.parentId !== null)).toBe(true);
    expect(rows.some((r) => r.name === 'Salary' && r.kind === 'income')).toBe(true);
  });

  it('is idempotent per user — re-seeding creates no duplicates', async () => {
    const user = await createTestUser('reseed@example.com');
    const before = await categoryCount(user.userId);

    await seedDefaultCategories(db(), user.userId);
    expect(await categoryCount(user.userId)).toBe(before);
  });
});

async function categoryCount(userId: string): Promise<number> {
  const [row] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(categories)
    .where(sql`${categories.userId} = ${userId}`);
  return row?.n ?? 0;
}
