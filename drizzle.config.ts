import { defineConfig } from 'drizzle-kit';

// Migrations are generated and applied as the migration role, which is the only
// role holding DDL rights (SECURITY.md §2). The application role in
// DATABASE_URL cannot create or alter a table.
process.loadEnvFile?.('.env');

const url = process.env.DATABASE_MIGRATION_URL;
if (!url) {
  throw new Error('DATABASE_MIGRATION_URL is not set — see .env.example');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema/index.ts',
  out: './src/server/db/migrations',
  dbCredentials: { url },
  casing: 'snake_case',
  strict: true,
  verbose: true,
});
