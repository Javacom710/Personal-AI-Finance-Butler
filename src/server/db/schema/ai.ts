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

import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

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

/**
 * Phase 8 evaluation results (SCHEMA.md §10, [ADR-44](../../../../docs/DECISIONS.md)):
 * one row per model, suite and run, written by `npm run ai:eval`.
 *
 * Stored rather than kept only as report files so the runtime can layer the
 * measurements over the declared capability matrix, and so Settings → AI can
 * show which model serves each tier and on what evidence.
 *
 * **Not user-owned.** It describes models, not finances: no `user_id`, so it
 * survives a user deletion and is excluded from data export. `detail` holds
 * counts and case ids, never a prompt or a model's output.
 */
export const aiModelEvaluations = pgTable(
  'ai_model_evaluations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    model: text('model').notNull(),
    tier: smallint('tier').notNull(),
    /** The suite's own version: bumped when its cases or scoring change. */
    evalVersion: integer('eval_version').notNull(),
    suite: text('suite').notNull(),
    casesTotal: integer('cases_total').notNull(),
    casesPassed: integer('cases_passed').notNull(),
    /** Pass rate over answered cases, 0..1. */
    score: numeric('score', { precision: 5, scale: 4 }).notNull(),
    p50LatencyMs: integer('p50_latency_ms'),
    p95LatencyMs: integer('p95_latency_ms'),
    detail: jsonb('detail').notNull().default(sql`'{}'::jsonb`),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('ai_model_evaluations_model_eval_version_suite_run_at_key').on(t.model, t.evalVersion, t.suite, t.runAt),
    index('ai_model_eval_latest_idx').on(t.model, t.suite, t.runAt.desc()),
    check('ai_model_evaluations_tier_check', sql`${t.tier} BETWEEN 1 AND 5`),
    check('ai_model_evaluations_score_check', sql`${t.score} >= 0 AND ${t.score} <= 1`),
    check('ai_model_evaluations_cases_check', sql`${t.casesPassed} >= 0 AND ${t.casesPassed} <= ${t.casesTotal}`),
  ],
);
