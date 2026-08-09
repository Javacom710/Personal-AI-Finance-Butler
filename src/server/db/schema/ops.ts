/**
 * Audit and jobs (SCHEMA.md §11).
 *
 * `audit_log` is append-only — not by convention but at the grant level: the
 * application role holds INSERT and SELECT on it and nothing else
 * (SECURITY.md §2, §10). Retention is an explicit maintenance job, never an
 * application delete.
 *
 * `jobs` is a Postgres-backed queue claimed with `FOR UPDATE SKIP LOCKED`
 * (ADR-14). The table ships in Phase 2; the runner and its handlers arrive in
 * Phase 3 with the first job that needs them.
 */

import { bigserial, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { auditActor, jobStatus } from './enums';
import { users } from './identity';

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),

    /** Nullable so a system action with no user still records. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),

    actor: auditActor('actor').notNull(),

    /** 'transaction.create', 'account.update', 'session.revoke', … */
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),

    before: jsonb('before'),
    after: jsonb('after'),

    /** Ties an audit row to the log lines and the error the user was shown. */
    requestId: text('request_id'),
  },
  (t) => [index('audit_log_entity_idx').on(t.entityType, t.entityId, t.at.desc())],
);

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** 'recurring.post', 'prices.refresh', 'networth.snapshot', 'backup.verify' */
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull().default({}),

    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
    status: jobStatus('status').notNull().default('pending'),

    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    lastError: text('last_error'),

    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: text('locked_by'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    // Partial index: the claim query only ever looks at pending rows, and a
    // completed job table can grow large without slowing the claim down.
    index('jobs_claim_idx')
      .on(t.status, t.runAfter)
      .where(sql`${t.status} = 'pending'`),
  ],
);
