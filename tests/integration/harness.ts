/**
 * Shared fixtures for the integration layer.
 *
 * Truncation runs as the migration role, because the application role
 * deliberately cannot `TRUNCATE` the audit log — a restriction the tests
 * themselves verify, so the harness must not quietly hold the privilege the
 * code under test lacks.
 */

import { Pool } from 'pg';

import { createAccount } from '../../src/server/auth/account';
import { db } from '../../src/server/db/client';

let adminPool: Pool | null = null;

function admin(): Pool {
  if (!adminPool) {
    const url = process.env['TEST_DATABASE_URL'];
    if (!url) throw new Error('TEST_DATABASE_URL is not set.');
    adminPool = new Pool({ connectionString: url, max: 2 });
  }
  return adminPool;
}

/** Reference data survives — it is seeded once and is not test state. */
const PRESERVED = new Set(['currencies', '__drizzle_migrations']);

export async function truncateAll(): Promise<void> {
  const { rows } = await admin().query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public'`,
  );

  const targets = rows.map((r) => r.tablename).filter((t) => !PRESERVED.has(t));
  if (targets.length === 0) return;

  // One statement so foreign keys never block the order, and identities reset
  // so a bigserial id is comparable across test files.
  await admin().query(
    `truncate table ${targets.map((t) => `"${t}"`).join(', ')} restart identity cascade`,
  );
}

export async function closeHarness(): Promise<void> {
  if (adminPool) {
    await adminPool.end();
    adminPool = null;
  }
}

export interface TestUser {
  readonly userId: string;
  readonly email: string;
  readonly password: string;
  readonly totpSecret: string;
  readonly recoveryCodes: string[];
}

/**
 * A password long enough to satisfy the policy and varied enough not to trip
 * the low-variety check.
 *
 * It deliberately shares no substring with any fixture email local part —
 * `checkPasswordPolicy` rejects a password containing it, and an earlier
 * version of this constant ("integration-test-…" against test@example.com) hit
 * exactly that rule. Argon2 at 128 MiB costs ~340 ms per hash, so tests that do
 * not need a distinct user should reuse one.
 */
export const TEST_PASSWORD = 'quiet-harbour-morning-tide-8412';

export async function createTestUser(email = 'test@example.com'): Promise<TestUser> {
  const result = await createAccount(email, TEST_PASSWORD, { allowAdditional: true });
  if (result.status !== 'created') {
    throw new Error(`Fixture user could not be created: ${result.status}`);
  }
  return {
    userId: result.account.userId,
    email: result.account.email,
    password: TEST_PASSWORD,
    totpSecret: result.account.totpSecretBase32,
    recoveryCodes: result.account.recoveryCodes,
  };
}

export const NO_CONTEXT = { ip: '203.0.113.10', userAgent: 'vitest' } as const;

/** Convenience for assertions that need to read a table the services wrote. */
export function database() {
  return db();
}
