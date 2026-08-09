/**
 * Reverse the most recently applied migration.
 *
 * Destructive by nature — "roll back the last migration" on live data means
 * dropping the tables it created — so it refuses to run in production without
 * an explicit acknowledgement.
 *
 *   npm run db:rollback
 *   npm run db:rollback -- --database-url=postgres://…
 */

import { loadDotEnv } from '../src/lib/env';
import { rollbackLast } from '../src/server/db/rollback';

async function main(): Promise<void> {
  loadDotEnv();

  if (process.env['NODE_ENV'] === 'production' && !process.argv.includes('--yes-i-am-sure')) {
    throw new Error(
      'Refusing to roll back in production without --yes-i-am-sure. Verify a backup restore first (DEPLOYMENT.md).',
    );
  }

  const override = process.argv
    .find((a) => a.startsWith('--database-url='))
    ?.slice('--database-url='.length);

  const url = override ?? process.env['DATABASE_MIGRATION_URL'];
  if (!url) throw new Error('DATABASE_MIGRATION_URL is not set — see .env.example');

  const result = await rollbackLast(url);
  console.log(result.rolledBack ? `Rolled back: ${result.rolledBack}` : 'Nothing to roll back.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
