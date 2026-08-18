/**
 * Per-user settings and cache versioning (SCHEMA.md §3).
 *
 * Base currency, locale and timezone are settings rows from day one, never
 * constants (D-6). `user_state` holds the two counters that invalidate every
 * derived artefact in the system (ARCHITECTURE.md §6); they live in their own
 * table so that bumping a version does not contend with a settings update.
 */

import { bigint, boolean, char, check, integer, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { currencies } from './reference';
import { users } from './identity';

export const settings = pgTable(
  'settings',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),

    baseCurrency: char('base_currency', { length: 3 })
      .notNull()
      .references(() => currencies.code),

    locale: text('locale').notNull().default('en-IN'),
    timezone: text('timezone').notNull().default('Asia/Kolkata'),

    /** 4 = April, the Indian fiscal year. User-editable. */
    fiscalYearStartMonth: smallint('fiscal_year_start_month').notNull().default(4),

    /** When false, no financial data leaves for any AI provider and every other feature still works. */
    aiEnabled: boolean('ai_enabled').notNull().default(true),
    // Defaults are written as SQL literals rather than JS bigints: drizzle-kit
    // serialises its snapshot with JSON.stringify, which cannot encode a BigInt.
    aiDailyBudgetMicros: bigint('ai_daily_budget_micros', { mode: 'bigint' })
      .notNull()
      .default(sql`200000000`),

    /**
     * Staleness is computed from these, never stored as a boolean (SCHEMA.md §5).
     *
     * Two thresholds, because two kinds of instrument age differently
     * ([ADR-28](../../../../docs/DECISIONS.md#adr-28--staleness-is-measured-in-trading-sessions-not-wall-clock-hours)).
     * `_hours` governs **continuously-traded** instruments only. Applying it to
     * an end-of-day close marks Friday's price stale on Saturday and keeps it
     * stale until Monday's close lands — every equity, every ETF, every mutual
     * fund, every week — and a warning that fires when nothing is wrong is one
     * the user learns to ignore.
     */
    priceStaleAfterHours: integer('price_stale_after_hours').notNull().default(24),
    /** Completed trading sessions before a session-traded price is `stale`. */
    priceStaleAfterSessions: integer('price_stale_after_sessions').notNull().default(3),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('settings_fiscal_month_range', sql`${t.fiscalYearStartMonth} between 1 and 12`),
    check('settings_ai_budget_non_negative', sql`${t.aiDailyBudgetMicros} >= 0`),
    check('settings_price_stale_positive', sql`${t.priceStaleAfterHours} > 0`),
    check('settings_price_stale_sessions_positive', sql`${t.priceStaleAfterSessions} > 0`),
  ],
);

export const userState = pgTable('user_state', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),

  /** Bumped by any change to transactions, entries, or an account's opening balance. */
  moneyLedgerVersion: bigint('money_ledger_version', { mode: 'bigint' }).notNull().default(sql`0`),

  /** Bumped by any change to investment transactions or an instrument's cost-basis method. */
  investmentLedgerVersion: bigint('investment_ledger_version', { mode: 'bigint' })
    .notNull()
    .default(sql`0`),
});
