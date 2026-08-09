/**
 * Postgres ENUM types (SCHEMA.md, Conventions): "a bad value cannot be
 * inserted from any client" — including from psql, a restore, or a future
 * script that bypasses the application.
 *
 * Only the enums Phase 2 needs are defined here. Money, investment and AI
 * enums arrive with the tables that use them.
 */

import { pgEnum } from 'drizzle-orm/pg-core';

/** SCHEMA.md §1 */
export const authEventKind = pgEnum('auth_event_kind', [
  'login_success',
  'login_failure',
  'totp_failure',
  'logout',
  'password_change',
  'lockout',
  'session_revoked',
]);

/** SCHEMA.md §11 — who caused a mutation. `ai_confirmed` is a user confirming an AI proposal. */
export const auditActor = pgEnum('audit_actor', ['user', 'system', 'ai_confirmed']);

/** SCHEMA.md §11 */
export const jobStatus = pgEnum('job_status', ['pending', 'running', 'done', 'failed']);
