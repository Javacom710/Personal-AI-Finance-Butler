/**
 * Apply the idempotent seed.
 *
 *   npm run db:seed
 *   npm run db:seed -- --database-url=postgres://…
 */

import { loadDotEnv } from '../src/lib/env';
import { seed } from '../src/server/db/seed';

async function main(): Promise<void> {
  loadDotEnv();

  const override = process.argv
    .find((a) => a.startsWith('--database-url='))
    ?.slice('--database-url='.length);

  const url = override ?? process.env['DATABASE_MIGRATION_URL'];
  if (!url) throw new Error('DATABASE_MIGRATION_URL is not set — see .env.example');

  const result = await seed(url);
  console.log(`Seed complete: ${result.currencies} currencies.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
