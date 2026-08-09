import 'server-only';

/**
 * Account lockout (SECURITY.md §1).
 *
 * Five consecutive failures lock the account for 15 minutes, doubling on each
 * further group of five, capped at 4 hours. Distinct from rate limiting: the
 * rate limit is per IP and short-lived, lockout is per account and follows the
 * account wherever the attempts come from.
 *
 * The counter resets on a successful password verification, so "consecutive"
 * genuinely means consecutive.
 */

import { eq, sql } from 'drizzle-orm';

import { db } from '../db/client';
import { users } from '../db/schema';

export const FAILURES_PER_LOCK = 5;
export const BASE_LOCK_MS = 15 * 60 * 1000;
export const MAX_LOCK_MS = 4 * 60 * 60 * 1000;

/**
 * 5 failures → 15 min, 10 → 30 min, 15 → 60 min, 20 → 120 min, 25 → 240 min,
 * and 4 hours thereafter.
 */
export function lockDurationMs(failedAttempts: number): number {
  const groups = Math.floor(failedAttempts / FAILURES_PER_LOCK);
  if (groups < 1) return 0;
  const doublings = Math.min(groups - 1, 20); // bounded so the shift cannot overflow
  return Math.min(BASE_LOCK_MS * 2 ** doublings, MAX_LOCK_MS);
}

export interface LockState {
  readonly locked: boolean;
  readonly until: Date | null;
  readonly retryAfterSeconds: number;
}

export function evaluateLock(lockedUntil: Date | null, now: Date = new Date()): LockState {
  if (!lockedUntil || lockedUntil.getTime() <= now.getTime()) {
    return { locked: false, until: null, retryAfterSeconds: 0 };
  }
  return {
    locked: true,
    until: lockedUntil,
    retryAfterSeconds: Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000),
  };
}

export interface FailureOutcome {
  readonly failedAttempts: number;
  readonly lockedUntil: Date | null;
  /** True when this particular failure crossed a threshold, so the caller can log a `lockout` event. */
  readonly justLocked: boolean;
}

export async function registerFailure(userId: string, now: Date = new Date()): Promise<FailureOutcome> {
  // Incremented in SQL rather than read-modify-written, so two concurrent
  // attempts cannot both read 4 and both write 5.
  const [row] = await db()
    .update(users)
    .set({ failedAttempts: sql`${users.failedAttempts} + 1`, updatedAt: now })
    .where(eq(users.id, userId))
    .returning({ failedAttempts: users.failedAttempts });

  const failedAttempts = row?.failedAttempts ?? 0;

  if (failedAttempts > 0 && failedAttempts % FAILURES_PER_LOCK === 0) {
    const until = new Date(now.getTime() + lockDurationMs(failedAttempts));
    await db().update(users).set({ lockedUntil: until }).where(eq(users.id, userId));
    return { failedAttempts, lockedUntil: until, justLocked: true };
  }

  return { failedAttempts, lockedUntil: null, justLocked: false };
}

/** Called after a successful password verification — the lock releases by being cleared, not by expiry alone. */
export async function clearFailures(userId: string): Promise<void> {
  await db()
    .update(users)
    .set({ failedAttempts: 0, lockedUntil: null, updatedAt: new Date() })
    .where(eq(users.id, userId));
}
