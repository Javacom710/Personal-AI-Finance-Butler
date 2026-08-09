import 'server-only';

/**
 * Liveness and readiness, as a server-side function rather than inline in the
 * route handler.
 *
 * `app/**` must not import `src/server/db/**` (ARCHITECTURE.md §2), and the
 * health route is not an exception: it reaches the database the same way every
 * other entry point will, through a function on this side of the boundary.
 * Today that is this module; from Phase 3 it is the application services.
 */

import { sql } from 'drizzle-orm';

import { db } from './db/client';

export type HealthStatus = 'ok' | 'degraded';

export async function checkDatabase(): Promise<HealthStatus> {
  try {
    await db().execute(sql`select 1`);
    return 'ok';
  } catch {
    // The reason is deliberately not returned to the caller: a health endpoint
    // is unauthenticated, and a connection error string names the host, the
    // database and the role.
    return 'degraded';
  }
}
