/**
 * Least-privilege grants for the application role (SECURITY.md §2, §10).
 *
 * Two properties are enforced here rather than trusted:
 *
 * 1. **The application cannot run DDL.** It owns nothing and is granted nothing
 *    beyond DML, so a SQL-injection or a stray `drop` in application code
 *    cannot alter the schema.
 * 2. **`audit_log` is append-only.** The role has INSERT and SELECT and
 *    nothing else, so the audit trail cannot be rewritten by the process that
 *    writes it. Retention is a separate maintenance job run as the owner.
 *
 * Re-applied after every migration, because a newly created table starts with
 * no grants at all. `ALTER DEFAULT PRIVILEGES` covers tables created later in
 * the same session; running this explicitly covers the ones already there.
 */

import { sql } from 'drizzle-orm';

/** Tables the application may read but never write. Reference data is seeded, not user-edited. */
const READ_ONLY_TABLES = ['currencies'] as const;

/** Tables the application may append to but never modify or delete from. */
const APPEND_ONLY_TABLES = ['audit_log'] as const;

interface Executor {
  execute(query: ReturnType<typeof sql>): Promise<unknown>;
}

/**
 * Quote a Postgres identifier. The role name comes from a connection string,
 * so it is interpolated into DDL — where bind parameters are not permitted.
 * Doubling embedded quotes is the only correct escape.
 */
function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(name)) {
    throw new Error(
      `Refusing to build a GRANT for the unusual role name ${JSON.stringify(name)}. ` +
        'Use a plain identifier for the application role.',
    );
  }
  return `"${name.replace(/"/g, '""')}"`;
}

export async function applyGrants(database: Executor, appRole: string): Promise<void> {
  const role = quoteIdent(appRole);

  const statements: string[] = [
    `GRANT USAGE ON SCHEMA public TO ${role}`,

    // Start from the broad grant, then take rights away. Expressed in this
    // order so that a table added in a later phase is covered by default and
    // has to be named explicitly to become more permissive.
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`,

    // No DDL, ever.
    `REVOKE CREATE ON SCHEMA public FROM ${role}`,
  ];

  for (const table of READ_ONLY_TABLES) {
    statements.push(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ${quoteIdent(table)} FROM ${role}`);
  }

  for (const table of APPEND_ONLY_TABLES) {
    statements.push(`REVOKE UPDATE, DELETE, TRUNCATE ON ${quoteIdent(table)} FROM ${role}`);
  }

  // Tables created by future migrations inherit the same shape without anyone
  // having to remember to re-run this.
  statements.push(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${role}`,
  );

  for (const statement of statements) {
    await database.execute(sql.raw(statement));
  }
}
