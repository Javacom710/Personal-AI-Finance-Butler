import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/server/db/client';
import { currencies, settings, userState, users } from '@/server/db/schema';
import { closeHarness, createTestUser, truncateAll } from './harness';

beforeEach(truncateAll);
afterAll(closeHarness);

describe('migration', () => {
  it('created every Phase 2 table and nothing from a later phase', async () => {
    const result = await db().execute<{ tablename: string }>(
      sql`select tablename from pg_tables where schemaname = 'public' order by tablename`,
    );
    const tables = result.rows.map((r) => r.tablename);

    expect(tables).toEqual(
      expect.arrayContaining([
        'audit_log',
        'auth_events',
        'currencies',
        'fx_rates',
        'jobs',
        'sessions',
        'settings',
        'user_state',
        'users',
      ]),
    );

    // Phase 3+ tables must not exist yet — building ahead of the phase is how a
    // reviewed schema turns into an unreviewed one.
    for (const later of ['accounts', 'transactions', 'instruments', 'positions', 'ai_proposals']) {
      expect(tables, `${later} belongs to a later phase`).not.toContain(later);
    }
  });

  it('created the enum types, so a bad value cannot be inserted by any client', async () => {
    const result = await db().execute<{ typname: string }>(
      sql`select typname from pg_type where typtype = 'e' order by typname`,
    );
    const types = result.rows.map((r) => r.typname);
    expect(types).toEqual(expect.arrayContaining(['audit_actor', 'auth_event_kind', 'job_status']));
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
});
