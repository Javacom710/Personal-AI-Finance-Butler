import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { roleFromUrl, runMigrations } from '@/server/db/migrate';
import { rollbackLast } from '@/server/db/rollback';
import { seed } from '@/server/db/seed';
import { closeHarness } from './harness';

afterAll(closeHarness);

const migrationUrl = process.env['TEST_DATABASE_URL']!;
const appUrl = process.env['TEST_DATABASE_APP_URL']!;

/**
 * A stable fingerprint of the schema: every column, every constraint, every
 * trigger and every function, in a deterministic order.
 *
 * Columns alone would miss a trigger or a `CHECK` that a down migration failed
 * to remove — and half the invariants in this schema *are* triggers and checks.
 */
async function schemaFingerprint(): Promise<string> {
  const pool = new Pool({ connectionString: migrationUrl, max: 1 });
  try {
    const columns = await pool.query<{ signature: string }>(
      `select 'col ' || table_name || '.' || column_name || ':' || data_type ||
              coalesce(':' || numeric_precision || ',' || numeric_scale, '') ||
              ':' || is_nullable as signature
         from information_schema.columns
        where table_schema = 'public'
        order by table_name, ordinal_position`,
    );

    const constraints = await pool.query<{ signature: string }>(
      `select 'con ' || conrelid::regclass::text || '.' || conname || ':' ||
              pg_get_constraintdef(oid) as signature
         from pg_constraint
        where connamespace = 'public'::regnamespace
        order by conrelid::regclass::text, conname`,
    );

    const triggers = await pool.query<{ signature: string }>(
      `select 'trg ' || tgrelid::regclass::text || '.' || tgname as signature
         from pg_trigger
        where not tgisinternal
        order by tgrelid::regclass::text, tgname`,
    );

    const functions = await pool.query<{ signature: string }>(
      `select 'fn ' || proname as signature ${OUR_FUNCTIONS} order by proname`,
    );

    return [...columns.rows, ...constraints.rows, ...triggers.rows, ...functions.rows]
      .map((r) => r.signature)
      .join('\n');
  } finally {
    await pool.end();
  }
}

/**
 * Functions the migrations created, excluding the ones an extension brought
 * with it. `citext` installs about fifty into `public`, and they are not ours
 * to drop — the down migration deliberately leaves the extension in place.
 */
const OUR_FUNCTIONS = `
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and not exists (
     select 1 from pg_depend d
      where d.objid = p.oid and d.deptype = 'e'
   )`;

async function functionCount(): Promise<number> {
  const pool = new Pool({ connectionString: migrationUrl, max: 1 });
  try {
    const { rows } = await pool.query<{ n: string }>(`select count(*) as n ${OUR_FUNCTIONS}`);
    return Number(rows[0]?.n ?? 0);
  } finally {
    await pool.end();
  }
}

async function tableCount(): Promise<number> {
  const pool = new Pool({ connectionString: migrationUrl, max: 1 });
  try {
    const { rows } = await pool.query<{ n: string }>(
      `select count(*) as n from pg_tables where schemaname = 'public'`,
    );
    return Number(rows[0]?.n ?? 0);
  } finally {
    await pool.end();
  }
}

/** Every migration in the journal, newest last. */
const MIGRATIONS = ['0000_phase2_foundation', '0001_phase3_financial_core'] as const;

/**
 * ROADMAP Phase 2: "migrations apply and roll back cleanly".
 *
 * The assertion that matters is the fingerprint comparison: a down migration
 * that drops eight of nine tables would still "run cleanly", and only a
 * before/after schema comparison catches it.
 *
 * Phase 3 adds functions and triggers, which no column fingerprint would see —
 * so the fingerprint now covers them too. A `check_transaction_shape()` left
 * behind by an incomplete rollback is exactly the kind of residue that makes a
 * re-migration fail on a different machine than the one it was tested on.
 */
describe('migrate and roll back', () => {
  it('rolls back every migration, newest first, and re-applies to an identical schema', async () => {
    const before = await schemaFingerprint();
    expect(before.length).toBeGreaterThan(0);

    for (const tag of [...MIGRATIONS].reverse()) {
      const rolledBack = await rollbackLast(migrationUrl);
      expect(rolledBack.rolledBack).toBe(tag);
    }

    // Only Drizzle's own journal table remains, and it lives in its own schema,
    // so `public` should be empty — of tables, functions and triggers alike.
    expect(await tableCount()).toBe(0);
    expect(await functionCount()).toBe(0);

    await runMigrations(migrationUrl, roleFromUrl(appUrl));
    await seed(migrationUrl);

    expect(await schemaFingerprint()).toBe(before);
  });

  it('reports nothing to roll back once the journal is empty', async () => {
    for (const _ of MIGRATIONS) await rollbackLast(migrationUrl);
    const extra = await rollbackLast(migrationUrl);
    expect(extra.rolledBack).toBeNull();

    // Leave the database as the other test files expect to find it.
    await runMigrations(migrationUrl, roleFromUrl(appUrl));
    await seed(migrationUrl);
  });

  it('is idempotent: re-running migrations changes nothing', async () => {
    const before = await schemaFingerprint();
    await runMigrations(migrationUrl, roleFromUrl(appUrl));
    expect(await schemaFingerprint()).toBe(before);
  });

  it('has an idempotent seed', async () => {
    const pool = new Pool({ connectionString: migrationUrl, max: 1 });
    try {
      await seed(migrationUrl);
      await seed(migrationUrl);
      const { rows } = await pool.query<{ n: string }>('select count(*) as n from currencies');
      expect(Number(rows[0]!.n)).toBe(12);
    } finally {
      await pool.end();
    }
  });
});
