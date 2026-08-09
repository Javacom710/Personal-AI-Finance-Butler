/**
 * Roll back the most recently applied migration.
 *
 * drizzle-kit has no down-migration support, so each forward migration has a
 * hand-written reverse under `migrations/down/`, reviewed in the same change
 * (SCHEMA.md §13). This applies the newest one inside a transaction and removes
 * its row from Drizzle's journal, so a subsequent `db:migrate` re-applies it.
 *
 * A library, not a CLI: the command — including its production guard — lives in
 * `scripts/db-rollback.ts`.
 */

import { Pool } from 'pg';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const DOWN_DIR = path.join(MIGRATIONS_DIR, 'down');

interface Journal {
  readonly entries: { readonly idx: number; readonly tag: string }[];
}

export interface RollbackResult {
  /** The migration tag that was reversed, or `null` if there was nothing applied. */
  readonly rolledBack: string | null;
}

export async function rollbackLast(connectionString: string): Promise<RollbackResult> {
  const journalRaw = await fs.readFile(path.join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8');
  const journal = JSON.parse(journalRaw) as Journal;

  const pool = new Pool({ connectionString, max: 1 });
  try {
    const applied = await pool.query<{ id: string }>(
      'select id from drizzle.__drizzle_migrations order by created_at desc limit 1',
    );
    const newest = applied.rows[0];
    if (!newest) return { rolledBack: null };

    const entry = journal.entries.at(-1);
    if (!entry) {
      throw new Error('Migration journal is empty but the database reports an applied migration.');
    }

    const downFile = path.join(DOWN_DIR, `${entry.tag}.down.sql`);
    let downSql: string;
    try {
      downSql = await fs.readFile(downFile, 'utf8');
    } catch {
      throw new Error(
        `No down migration for "${entry.tag}". Expected ${downFile}. ` +
          'Every forward migration must ship with its reverse (SCHEMA.md §13).',
      );
    }

    const statements = downSql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const client = await pool.connect();
    try {
      // One transaction: a half-reversed migration is worse than none.
      await client.query('BEGIN');
      for (const statement of statements) await client.query(statement);
      await client.query('delete from drizzle.__drizzle_migrations where id = $1', [newest.id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return { rolledBack: entry.tag };
  } finally {
    await pool.end();
  }
}
