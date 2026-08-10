/**
 * One-time setup for the integration layer: build the test database.
 *
 * Runs migrations and the seed against `TEST_DATABASE_URL` using the migration
 * role, then re-applies the grants for the application role. The tests
 * themselves connect as the **application** role, so anything they do is
 * subject to the same privileges production runs under — which is how a missing
 * grant becomes a failing test instead of a production incident.
 *
 * TESTING.md §1 prefers `testcontainers`. Docker is not present on this machine,
 * so this targets a dedicated `financeos_test` database on the local PostgreSQL
 * service instead (decision D-23). The two paths differ only in where the
 * connection string points.
 *
 * Nothing here starts the database: it is a Windows service with `Automatic`
 * start, so it is already running.
 */

import { loadDotEnv } from '../../src/lib/env';
import { roleFromUrl, runMigrations } from '../../src/server/db/migrate';
import { seed } from '../../src/server/db/seed';

export default async function setup(): Promise<void> {
  loadDotEnv();

  const migrationUrl = process.env['TEST_DATABASE_URL'];
  const appUrl = process.env['TEST_DATABASE_APP_URL'];

  if (!migrationUrl || !appUrl) {
    throw new Error(
      'Integration tests need TEST_DATABASE_URL and TEST_DATABASE_APP_URL. See .env.example.\n' +
        'They must point at a database used only by tests — the harness truncates every table.',
    );
  }

  // A guard, not a nicety: the harness truncates. Pointing this at the
  // development database would delete real data.
  if (!/financeos_test/.test(migrationUrl) || !/financeos_test/.test(appUrl)) {
    throw new Error(
      'Refusing to run: the integration database name must contain "financeos_test". ' +
        'The harness truncates every table between test files.',
    );
  }

  await runMigrations(migrationUrl, roleFromUrl(appUrl));
  await seed(migrationUrl);
}
