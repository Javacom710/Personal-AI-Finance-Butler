import 'server-only';

/**
 * Session persistence (ADR-10, SECURITY.md §1).
 *
 * The token is 32 random bytes. Only its SHA-256 is stored, so **a read of the
 * database cannot mint a session**. There is no signature to verify, no expiry
 * encoded in the token, and no denylist to maintain: revocation is a `DELETE`,
 * and it takes effect on the next request because the check is a database read.
 *
 * Split from `session-cookie.ts` on purpose: this half touches only the
 * database, so the login use case, the provisioning CLI and the integration
 * tests can all use it without dragging in `next/headers`, which only exists
 * inside a request.
 */

import { and, eq, lt, ne, sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';

import { db } from '../db/client';
import { sessions, users } from '../db/schema';

/** SECURITY.md §1 — both enforced server-side, never by cookie lifetime. */
export const ABSOLUTE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const IDLE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** A `last_seen_at` write on every request would be a write per page view for no benefit. */
export const LAST_SEEN_REFRESH_MS = 5 * 60 * 1000;

const TOKEN_BYTES = 32;

export interface RequestContext {
  readonly ip: string | null;
  readonly userAgent: string | null;
}

export interface IssuedSession {
  readonly sessionId: string;
  readonly token: string;
  readonly expiresAt: Date;
}

export interface SessionUser {
  readonly userId: string;
  readonly sessionId: string;
  readonly email: string;
}

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/** Create the row and return the token — the only moment it exists in plaintext. */
export async function createSession(userId: string, ctx: RequestContext): Promise<IssuedSession> {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(Date.now() + ABSOLUTE_LIFETIME_MS);

  const [row] = await db()
    .insert(sessions)
    .values({
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      ip: ctx.ip,
      userAgent: ctx.userAgent?.slice(0, 512) ?? null,
    })
    .returning({ id: sessions.id });

  if (!row) throw new Error('Failed to create session row.');
  return { sessionId: row.id, token, expiresAt };
}

/**
 * Resolve a raw token to a session, applying both timeouts.
 *
 * Both are checked here rather than trusted to the cookie: a cookie expiry is a
 * client-side hint, and an attacker holding a stolen token would simply not
 * honour it. An expired or idle session is deleted on the way out, so the row
 * cannot be resurrected by a clock change.
 */
export async function resolveSession(token: string, now: Date = new Date()): Promise<SessionUser | null> {
  const [row] = await db()
    .select({
      sessionId: sessions.id,
      userId: sessions.userId,
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
      email: users.email,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, hashToken(token)))
    .limit(1);

  if (!row) return null;

  const expired = row.expiresAt.getTime() <= now.getTime();
  const idle = now.getTime() - row.lastSeenAt.getTime() > IDLE_TIMEOUT_MS;

  if (expired || idle) {
    await db().delete(sessions).where(eq(sessions.id, row.sessionId));
    return null;
  }

  if (now.getTime() - row.lastSeenAt.getTime() > LAST_SEEN_REFRESH_MS) {
    await db().update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sessionId));
  }

  return { userId: row.userId, sessionId: row.sessionId, email: row.email };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await db().delete(sessions).where(eq(sessions.id, sessionId));
}

/** Called on password change and any privilege change (SECURITY.md §1). */
export async function revokeOtherSessions(userId: string, keepSessionId: string): Promise<number> {
  const removed = await db()
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)))
    .returning({ id: sessions.id });
  return removed.length;
}

export async function revokeAllSessions(userId: string): Promise<number> {
  const removed = await db()
    .delete(sessions)
    .where(eq(sessions.userId, userId))
    .returning({ id: sessions.id });
  return removed.length;
}

export async function purgeExpiredSessions(): Promise<number> {
  const removed = await db()
    .delete(sessions)
    .where(lt(sessions.expiresAt, sql`now()`))
    .returning({ id: sessions.id });
  return removed.length;
}

export interface ActiveSession {
  readonly id: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly isCurrent: boolean;
}

export async function listActiveSessions(
  userId: string,
  currentSessionId: string,
): Promise<ActiveSession[]> {
  const rows = await db()
    .select({
      id: sessions.id,
      ip: sessions.ip,
      userAgent: sessions.userAgent,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
    })
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(sql`${sessions.lastSeenAt} desc`);

  return rows.map((r) => ({ ...r, isCurrent: r.id === currentSessionId }));
}
