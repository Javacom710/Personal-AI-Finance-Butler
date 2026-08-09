/**
 * Identity and session (SCHEMA.md §1).
 *
 * The property that matters here: **the session token itself is never stored**,
 * only its SHA-256. A read of this database cannot mint a session.
 */

import { relations } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { authEventKind } from './enums';
import { bytea, citext, inet } from './_types';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** citext: two accounts cannot differ only by case (see _types.ts). */
    email: citext('email').notNull(),

    /** Argon2id. Parameters and the measured cost are recorded in src/server/auth/password.ts. */
    passwordHash: text('password_hash').notNull(),

    /** AES-256-GCM ciphertext of the TOTP secret. The key lives only in APP_ENCRYPTION_KEY. */
    totpSecretEnc: bytea('totp_secret_enc'),
    totpEnabled: boolean('totp_enabled').notNull().default(false),

    /** Argon2id hashes of ten single-use recovery codes, shown once at enrolment. */
    totpRecoveryHashes: text('totp_recovery_hashes').array().notNull().default([]),

    /**
     * The last TOTP time-step consumed by a successful verification.
     *
     * SECURITY.md §1 requires that "a used TOTP code is rejected for its
     * remaining window". Because verification accepts ±1 step of drift, knowing
     * only *when* a login succeeded is not enough to identify which code was
     * used — the step itself has to be recorded. Persisted rather than held in
     * memory so a process restart does not reopen the replay window.
     *
     * Not present in the original SCHEMA.md §1 sketch; added here because the
     * control it implements is specified and has nowhere else to live.
     */
    lastTotpStep: bigint('last_totp_step', { mode: 'bigint' }),

    failedAttempts: integer('failed_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_email_uniq').on(t.email)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** SHA-256 of the cookie token. The token is never stored (SECURITY.md §1). */
    tokenHash: bytea('token_hash').notNull(),

    /** Absolute expiry, enforced server-side rather than by cookie lifetime. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    /** Drives the idle timeout, which is separate from the absolute one. */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),

    ip: inet('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_uniq').on(t.tokenHash),
    index('sessions_user_expires_idx').on(t.userId, t.expiresAt),
  ],
);

/**
 * Every authentication attempt, successful or not (SECURITY.md §1).
 *
 * This table is also the substrate for login and TOTP rate limiting: the limits
 * in SECURITY.md §6 are counts of rows in a time window, per IP and per
 * account. That is why the two indexes below exist and why they are ordered
 * with `created_at` descending — they are the rate-limit query's access path,
 * not decoration.
 */
export const authEvents = pgTable(
  'auth_events',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),

    /** Nullable: a login attempt for an address that does not exist has no user. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    kind: authEventKind('kind').notNull(),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('auth_events_ip_time_idx').on(t.ip, t.createdAt.desc()),
    index('auth_events_user_time_idx').on(t.userId, t.createdAt.desc()),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  authEvents: many(authEvents),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const authEventsRelations = relations(authEvents, ({ one }) => ({
  user: one(users, { fields: [authEvents.userId], references: [users.id] }),
}));
