/**
 * Idempotent seed (SCHEMA.md §13).
 *
 * Running this twice must leave the database in the same state as running it
 * once — it is executed on every deploy, and a seed that duplicates rows is a
 * data-integrity bug waiting for the second deploy.
 *
 * Currencies are global reference data and are seeded by the `seed()` command.
 * Default **categories** are user-owned, so they are seeded when the account is
 * provisioned rather than by a global command — see `seedDefaultCategories`.
 *
 * A library, not a CLI: the command lives in `scripts/db-seed.ts`.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';

import type { DbExecutor } from './client';
import * as schema from './schema';
import { categories, currencies } from './schema';

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
  /** Default categories added to accounts that were missing them. */
  readonly categories: number;
}

export async function seed(connectionString: string): Promise<SeedResult> {
  const pool = new Pool({ connectionString, max: 1 });
  // Built with the same schema and casing as `db()` so the handle is the one
  // `seedDefaultCategories` expects, whether it is called from here or from
  // inside an account-provisioning transaction.
  const database = drizzle(pool, { schema, casing: 'snake_case' });

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

    // Top up the default categories for every existing account. New accounts
    // get them at provisioning; an account created before Phase 3 has none, and
    // without this the money pages have no category to offer. Idempotent, so
    // an account that already has them is untouched.
    const users = await database.execute<{ id: string }>(sql`select id from users`);
    let categoriesAdded = 0;
    for (const user of users.rows) {
      categoriesAdded += await seedDefaultCategories(database, user.id);
    }

    return { currencies: CURRENCY_SEED.length, categories: categoriesAdded };
  } finally {
    await pool.end();
  }
}

// ------------------------------------------------------- default categories

/**
 * The default category set (FINANCIAL-DOMAIN.md §5). Editable by the user once
 * created — these are a starting point, not a fixed taxonomy.
 *
 * The parents matter, not only the leaves. `CLAUDE.md`'s own worked example is
 * "how much did I spend on food in July?" — if `Groceries` and `Dining` were
 * top-level siblings, that question would have no category to resolve to and
 * answering it would mean summing rows, which is precisely the arithmetic the
 * engine exists to own.
 */
export const DEFAULT_CATEGORIES: readonly {
  readonly name: string;
  readonly kind: 'income' | 'expense';
  readonly children?: readonly string[];
}[] = [
  { name: 'Salary', kind: 'income' },
  { name: 'Business', kind: 'income' },
  { name: 'Interest', kind: 'income' },
  { name: 'Dividend', kind: 'income' },
  { name: 'Rental', kind: 'income' },
  { name: 'Other Income', kind: 'income' },

  { name: 'Food', kind: 'expense', children: ['Groceries', 'Dining'] },
  { name: 'Housing', kind: 'expense', children: ['Rent', 'Maintenance'] },
  { name: 'Transport', kind: 'expense', children: ['Fuel', 'Public transport', 'Cabs'] },
  { name: 'Utilities', kind: 'expense' },
  { name: 'Health', kind: 'expense' },
  { name: 'Insurance', kind: 'expense' },
  { name: 'Education', kind: 'expense' },
  { name: 'Shopping', kind: 'expense' },
  { name: 'Entertainment', kind: 'expense' },
  { name: 'Travel', kind: 'expense' },
  { name: 'Personal', kind: 'expense' },
  // "Business expenses", not "Business": the unique key is
  // `(user_id, parent_id, name)` and does **not** include `kind`, so a
  // top-level income "Business" and a top-level expense "Business" cannot
  // coexist. FINANCIAL-DOMAIN.md §5's example list names both; taking it
  // literally silently dropped one under `ON CONFLICT DO NOTHING`, leaving an
  // account with a category it was told it had. Renamed rather than widening a
  // reviewed constraint — and the user can rename it back to anything unused.
  { name: 'Business expenses', kind: 'expense' },
  { name: 'Fees & Charges', kind: 'expense' },
  { name: 'Taxes', kind: 'expense' },
  { name: 'Gifts & Donations', kind: 'expense' },
  { name: 'Other', kind: 'expense' },
];

/**
 * Seed one user's default categories. Idempotent: `ON CONFLICT DO NOTHING`
 * against `(user_id, parent_id, name)`, so running it against an account that
 * already has them changes nothing and it can be re-run after the user has
 * deleted some. Parents are inserted first because a child needs its parent id.
 */
export async function seedDefaultCategories(database: DbExecutor, userId: string): Promise<number> {
  assertNoDuplicateTopLevelNames();

  const insertedParents = await database
    .insert(categories)
    .values(
      DEFAULT_CATEGORIES.map((c, index) => ({
        userId,
        name: c.name,
        kind: c.kind,
        sortOrder: index,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: categories.id, name: categories.name, kind: categories.kind });

  const byKey = new Map(insertedParents.map((row) => [`${row.kind}:${row.name}`, row.id]));

  const children = DEFAULT_CATEGORIES.flatMap((c) => {
    const parentId = byKey.get(`${c.kind}:${c.name}`);
    if (parentId === undefined) return [];
    return (c.children ?? []).map((child, index) => ({
      userId,
      name: child,
      kind: c.kind,
      parentId,
      sortOrder: index,
    }));
  });

  const insertedChildren =
    children.length === 0
      ? []
      : await database
          .insert(categories)
          .values(children)
          .onConflictDoNothing()
          .returning({ id: categories.id });

  return insertedParents.length + insertedChildren.length;
}

/**
 * Refuse to seed a list that would silently lose a row.
 *
 * `ON CONFLICT DO NOTHING` is what makes re-seeding safe, and it is also what
 * would swallow a duplicate name in this constant — the account would come out
 * missing a category nobody noticed was missing. Checked here rather than only
 * in a test, because a seed runs on every deploy and a test does not.
 */
function assertNoDuplicateTopLevelNames(): void {
  const seen = new Set<string>();
  for (const category of DEFAULT_CATEGORIES) {
    // The unique key is (user_id, parent_id, name) with NULLS NOT DISTINCT, so
    // two top-level categories collide on name alone, whatever their kind.
    if (seen.has(category.name)) {
      throw new Error(
        `DEFAULT_CATEGORIES has two top-level categories named "${category.name}". ` +
          'The unique key does not include `kind`, so one of them would be dropped silently.',
      );
    }
    seen.add(category.name);

    const children = new Set<string>();
    for (const child of category.children ?? []) {
      if (children.has(child)) {
        throw new Error(`DEFAULT_CATEGORIES has two "${child}" children under "${category.name}".`);
      }
      children.add(child);
    }
  }
}
