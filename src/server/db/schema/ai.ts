/**
 * AI accounting (SCHEMA.md §10, AI-SYSTEM.md §15).
 *
 * `ai_usage_daily` is the daily budget's ledger (finding B-3a, decided
 * 2026-10-26): one row per user, day, tier and model, incremented after every
 * request that reached the provider. The budget is read from it **before** a
 * request is built, so a restart cannot reset it the way an in-memory counter
 * would. It holds counts and token totals only — never a prompt, a response or
 * a figure.
 *
 * `day` is the user's own calendar day, from `settings.timezone`.
 */

import { bigint, date, integer, pgTable, primaryKey, smallint, text, uuid } from 'drizzle-orm/pg-core';

import { users } from './identity';

export const aiUsageDaily = pgTable(
  'ai_usage_daily',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    tier: smallint('tier').notNull(),
    /** The serving model, or `'none'` when every candidate failed before one served. */
    model: text('model').notNull(),
    requests: integer('requests').notNull().default(0),
    failures: integer('failures').notNull().default(0),
    fallbackRequests: integer('fallback_requests').notNull().default(0),
    promptTokens: bigint('prompt_tokens', { mode: 'number' }).notNull().default(0),
    completionTokens: bigint('completion_tokens', { mode: 'number' }).notNull().default(0),
    /** Stays 0 until `config/pricing.ts` rates are confirmed (AI-SYSTEM.md §15). */
    costMicros: bigint('cost_micros', { mode: 'number' }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day, t.tier, t.model] })],
);
