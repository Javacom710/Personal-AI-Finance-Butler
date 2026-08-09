/**
 * Reference data (SCHEMA.md §2).
 *
 * `currencies` is seeded and shared; it carries no `user_id` because ISO 4217
 * is not a user's opinion. `fx_rates` uses a composite natural key — a rate is
 * identified by what it converts and the day it was true, so a surrogate id
 * would only permit duplicates.
 */

import { char, check, date, numeric, pgTable, primaryKey, smallint, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const currencies = pgTable('currencies', {
  code: char('code', { length: 3 }).primaryKey(),

  /** Display scale only — INR 2, JPY 0. Arithmetic is always at MONEY_SCALE = 4 (ADR-04). */
  minorUnits: smallint('minor_units').notNull(),
  symbol: text('symbol').notNull(),
  name: text('name').notNull(),
});

export const fxRates = pgTable(
  'fx_rates',
  {
    baseCode: char('base_code', { length: 3 })
      .notNull()
      .references(() => currencies.code),
    quoteCode: char('quote_code', { length: 3 })
      .notNull()
      .references(() => currencies.code),

    /** The calendar day the rate was true. Lookup is exact, else most recent earlier, else missing. */
    asOf: date('as_of').notNull(),

    /** 1 base = `rate` quote. NUMERIC(20,10), read as a string into `Rate`. */
    rate: numeric('rate', { precision: 20, scale: 10 }).notNull(),

    source: text('source').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.baseCode, t.quoteCode, t.asOf] }),
    check('fx_rates_rate_positive', sql`${t.rate} > 0`),
  ],
);
