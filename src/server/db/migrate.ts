/**
 * Apply migrations, then re-apply the privilege grants.
 *
 * A library, not a CLI: the command lives in `scripts/db-migrate.ts`. Keeping
 * the entry point out of here means this module reads no environment and prints
 * nothing, so the integration harness can call it directly.
 *
 * Always run with the **migration** role, which is the only role holding DDL
 * rights. The application process never holds this connection string
 * (SECURITY.md §2).
 */

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { applyGrants } from './grants';

export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * @param connectionString the migration role
 * @param appRole the application role to re-grant, or `null` to skip. A newly
 *   created table starts with no grants at all, so this runs after every migration.
 */
export async function runMigrations(connectionString: string, appRole: string | null): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 });
  const database = drizzle(pool);

  try {
    await migrate(database, { migrationsFolder: MIGRATIONS_DIR });
    if (appRole) await applyGrants(database, appRole);
  } finally {
    await pool.end();
  }
}

/** Extract the role name from a connection string, so grants never hard-code it. */
export function roleFromUrl(connectionString: string): string | null {
  try {
    const parsed = new URL(connectionString);
    return parsed.username ? decodeURIComponent(parsed.username) : null;
  } catch {
    return null;
  }
}
