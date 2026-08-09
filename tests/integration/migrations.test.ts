import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { roleFromUrl, runMigrations } from '@/server/db/migrate';
import { rollbackLast } from '@/server/db/rollback';
import { seed } from '@/server/db/seed';
import { closeHarness } from './harness';

afterAll(closeHarness);

const migrationUrl = process.env['TEST_DATABASE_URL']!;
const appUrl = process.env['TEST_DATABASE_APP_URL']!;

/** A stable fingerprint of the schema: every column of every table, in order. */
async function schemaFingerprint(): Promise<string> {
  const pool = new Pool({ connectionString: migrationUrl, max: 1 });
  try {
    const { rows } = await pool.query<{ signature: string }>(
      `select table_name || '.' || column_name || ':' || data_type ||
              coalesce(':' || numeric_precision || ',' || numeric_scale, '') ||
              ':' || is_nullable as signature
         from information_schema.columns
        where table_schema = 'public'
        order by table_name, ordinal_position`,
    );
    return rows.map((r) => r.signature).join('\n');
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

/**
 * ROADMAP Phase 2: "migrations apply and roll back cleanly".
 *
 * The assertion that matters is the fingerprint comparison: a down migration
 * that drops eight of nine tables would still "run cleanly", and only a
 * before/after schema comparison catches it.
 */
describe('migrate and roll back', () => {
  it('rolls back to an empty schema and re-applies to an identical one', async () => {
    const before = await schemaFingerprint();
    expect(before.length).toBeGreaterThan(0);

    const rolledBack = await rollbackLast(migrationUrl);
    expect(rolledBack.rolledBack).toBe('0000_phase2_foundation');

    // Only Drizzle's own journal table remains, and it lives in its own schema,
    // so `public` should be empty.
    expect(await tableCount()).toBe(0);

    await runMigrations(migrationUrl, roleFromUrl(appUrl));
    await seed(migrationUrl);

    expect(await schemaFingerprint()).toBe(before);
  });

  it('reports nothing to roll back once the journal is empty', async () => {
    // Roll back the only migration, then try again.
    await rollbackLast(migrationUrl);
    const second = await rollbackLast(migrationUrl);
    expect(second.rolledBack).toBeNull();

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
