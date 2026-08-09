/**
 * Idempotent seed (SCHEMA.md §13).
 *
 * Running this twice must leave the database in the same state as running it
 * once — it is executed on every deploy, and a seed that duplicates rows is a
 * data-integrity bug waiting for the second deploy.
 *
 * Phase 2 seeds reference currencies only. Default categories arrive in Phase 3,
 * with the table that holds them.
 *
 * A library, not a CLI: the command lives in `scripts/db-seed.ts`.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';

import { currencies } from './schema';

/**
 * `minor_units` is the *display* scale — arithmetic is always at scale 4
 * (ADR-04). JPY has 0, which is why this is data rather than an assumption.
 */
export const CURRENCY_SEED = [
  { code: 'INR', minorUnits: 2, symbol: '₹', name: 'Indian Rupee' },
  { code: 'USD', minorUnits: 2, symbol: '$', name: 'US Dollar' },
  { code: 'EUR', minorUnits: 2, symbol: '€', name: 'Euro' },
  { code: 'GBP', minorUnits: 2, symbol: '£', name: 'Pound Sterling' },
  { code: 'JPY', minorUnits: 0, symbol: '¥', name: 'Japanese Yen' },
  { code: 'CHF', minorUnits: 2, symbol: 'CHF', name: 'Swiss Franc' },
  { code: 'AUD', minorUnits: 2, symbol: 'A$', name: 'Australian Dollar' },
  { code: 'CAD', minorUnits: 2, symbol: 'C$', name: 'Canadian Dollar' },
  { code: 'SGD', minorUnits: 2, symbol: 'S$', name: 'Singapore Dollar' },
  { code: 'HKD', minorUnits: 2, symbol: 'HK$', name: 'Hong Kong Dollar' },
  { code: 'AED', minorUnits: 2, symbol: 'AED', name: 'UAE Dirham' },
  { code: 'CNY', minorUnits: 2, symbol: '¥', name: 'Chinese Yuan' },
] as const;

export interface SeedResult {
  readonly currencies: number;
}

export async function seed(connectionString: string): Promise<SeedResult> {
  const pool = new Pool({ connectionString, max: 1 });
  const database = drizzle(pool);

  try {
    // Upsert rather than insert-if-absent: a corrected symbol or name should
    // propagate on the next run, and the row count stays constant either way.
    await database
      .insert(currencies)
      .values(CURRENCY_SEED.map((c) => ({ ...c })))
      .onConflictDoUpdate({
        target: currencies.code,
        set: {
          minorUnits: sql`excluded.minor_units`,
          symbol: sql`excluded.symbol`,
          name: sql`excluded.name`,
        },
      });

    return { currencies: CURRENCY_SEED.length };
  } finally {
    await pool.end();
  }
}
