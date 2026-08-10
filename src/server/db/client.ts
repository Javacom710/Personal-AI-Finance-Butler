import 'server-only';

/**
 * The application's database handle (ARCHITECTURE.md §4).
 *
 * This pool uses `DATABASE_URL` — the *application* role, which holds DML
 * rights on data tables, INSERT and SELECT only on `audit_log`, and no DDL at
 * all (SECURITY.md §2). Migrations use a different role through a different
 * connection, created in `migrate.ts`, and the running server never holds it.
 *
 * `import 'server-only'` makes importing this from a client component a build
 * error rather than a runtime leak.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { env } from '../../lib/env';
import * as schema from './schema';

export type Database = ReturnType<typeof createDb>;

/** The handle inside `withTransaction`. Application services are the only layer that holds one. */
export type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Either handle. Used by helpers that must work both standalone and inside a
 * transaction — a seed run from a script, and the same seed run as part of
 * account provisioning.
 */
export type DbExecutor = Database | DbTransaction;

function createDb(connectionString: string) {
  const pool = new Pool({
    connectionString,
    // A single-user application does not need a large pool; a small one makes
    // connection exhaustion from a leak obvious immediately rather than at load.
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  pool.on('error', (error) => {
    // An idle client erroring must not take the process down. Logged directly
    // rather than through src/server/log.ts to avoid a cycle: the logger reads
    // the environment, and a pool error can occur while that is still resolving.
    console.error(JSON.stringify({ level: 'error', msg: 'pg pool error', error: error.message }));
  });

  return drizzle(pool, { schema, casing: 'snake_case' });
}

/**
 * Cached across hot reloads. Without this, `next dev` opens a new pool on every
 * file change and exhausts the server's connection limit within a few edits.
 */
const globalForDb = globalThis as unknown as { __financeOsDb?: Database };

export function db(): Database {
  if (!globalForDb.__financeOsDb) {
    globalForDb.__financeOsDb = createDb(env().DATABASE_URL);
  }
  return globalForDb.__financeOsDb;
}

/**
 * Close the pool and let the process exit naturally.
 *
 * For CLI scripts only. The server never calls this — its pool lives as long as
 * it does. Without it a script has to `process.exit()`, which discards whatever
 * is still buffered on stdout.
 */
export async function closeDb(): Promise<void> {
  const existing = globalForDb.__financeOsDb;
  if (!existing) return;
  globalForDb.__financeOsDb = undefined;
  await (existing.$client as unknown as { end(): Promise<void> }).end();
}

/**
 * The transaction boundary. Application services are the only layer permitted
 * to open one (ARCHITECTURE.md §2) — the engine has no database handle, and
 * presentation calls services.
 */
export async function withTransaction<T>(
  fn: (tx: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db().transaction(fn);
}
