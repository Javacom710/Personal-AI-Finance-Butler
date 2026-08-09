/**
 * Apply migrations and re-apply the privilege grants.
 *
 *   npm run db:migrate
 *   npm run db:migrate -- --database-url=postgres://…
 */

import { loadDotEnv } from '../src/lib/env';
import { roleFromUrl, runMigrations } from '../src/server/db/migrate';

async function main(): Promise<void> {
  loadDotEnv();

  const override = process.argv
    .find((a) => a.startsWith('--database-url='))
    ?.slice('--database-url='.length);

  const url = override ?? process.env['DATABASE_MIGRATION_URL'];
  if (!url) throw new Error('DATABASE_MIGRATION_URL is not set — see .env.example');

  const appRole = roleFromUrl(process.env['DATABASE_URL'] ?? '');
  const migratorRole = roleFromUrl(url);

  // If these are the same role, the separation SECURITY.md §2 describes does not
  // exist — the application could run DDL and rewrite the audit log. Saying
  // nothing would be worse than the risk.
  if (appRole && migratorRole && appRole === migratorRole) {
    console.warn(
      `WARNING: DATABASE_URL and DATABASE_MIGRATION_URL use the same role (${appRole}).\n` +
        'The application can then run DDL and rewrite the audit log. See SECURITY.md §2.',
    );
  }

  await runMigrations(url, appRole);
  console.log(`Migrations applied.${appRole ? ` Grants re-applied for role "${appRole}".` : ''}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
