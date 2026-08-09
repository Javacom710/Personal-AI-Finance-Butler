import 'server-only';

/**
 * The authentication audit trail, and the substrate the auth rate limits are
 * computed from (SECURITY.md §1, §6).
 *
 * Every attempt writes a row. That serves three purposes at once: Settings →
 * Security can show recent activity, an investigation can reconstruct what
 * happened, and the rate limiter can count attempts in a window without a
 * second store. No Redis, per `CLAUDE.md <technology>` — the data was already
 * being written.
 */

import { and, count, eq, gte, isNull, sql } from 'drizzle-orm';

import { db } from '../db/client';
import { authEvents } from '../db/schema';
import type { RequestContext } from './session-store';

export type AuthEventKind =
  | 'login_success'
  | 'login_failure'
  | 'totp_failure'
  | 'logout'
  | 'password_change'
  | 'lockout'
  | 'session_revoked';

export async function recordAuthEvent(
  kind: AuthEventKind,
  userId: string | null,
  ctx: RequestContext,
): Promise<void> {
  await db().insert(authEvents).values({
    kind,
    userId,
    ip: ctx.ip,
    userAgent: ctx.userAgent?.slice(0, 512) ?? null,
  });
}

/** Count events of the given kinds for one IP within the window. */
export async function countByIp(
  kinds: readonly AuthEventKind[],
  ip: string | null,
  windowMs: number,
): Promise<number> {
  if (!ip) return 0;
  const since = new Date(Date.now() - windowMs);

  const [row] = await db()
    .select({ n: count() })
    .from(authEvents)
    .where(
      and(eq(authEvents.ip, ip), gte(authEvents.createdAt, since), sql`${authEvents.kind} in ${kindList(kinds)}`),
    );

  return row?.n ?? 0;
}

/** Count events of the given kinds for one account within the window. */
export async function countByUser(
  kinds: readonly AuthEventKind[],
  userId: string,
  windowMs: number,
): Promise<number> {
  const since = new Date(Date.now() - windowMs);

  const [row] = await db()
    .select({ n: count() })
    .from(authEvents)
    .where(
      and(
        eq(authEvents.userId, userId),
        gte(authEvents.createdAt, since),
        sql`${authEvents.kind} in ${kindList(kinds)}`,
      ),
    );

  return row?.n ?? 0;
}

/**
 * Attempts against addresses that do not exist. They carry no `user_id`, so
 * they are invisible to the per-account limit and would otherwise be
 * unlimited — an attacker enumerating addresses never triggers a per-account
 * counter, because no account is ever named.
 */
export async function countAnonymousFailures(ip: string | null, windowMs: number): Promise<number> {
  if (!ip) return 0;
  const since = new Date(Date.now() - windowMs);

  const [row] = await db()
    .select({ n: count() })
    .from(authEvents)
    .where(
      and(
        eq(authEvents.ip, ip),
        isNull(authEvents.userId),
        gte(authEvents.createdAt, since),
        eq(authEvents.kind, 'login_failure'),
      ),
    );

  return row?.n ?? 0;
}

export interface RecentAuthEvent {
  readonly kind: AuthEventKind;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly createdAt: Date;
}

export async function recentEventsForUser(userId: string, limit = 20): Promise<RecentAuthEvent[]> {
  return db()
    .select({
      kind: authEvents.kind,
      ip: authEvents.ip,
      userAgent: authEvents.userAgent,
      createdAt: authEvents.createdAt,
    })
    .from(authEvents)
    .where(eq(authEvents.userId, userId))
    .orderBy(sql`${authEvents.createdAt} desc`)
    .limit(limit);
}

/** Build a bound `in (...)` list. Kind values are a closed enum, never user input. */
function kindList(kinds: readonly AuthEventKind[]) {
  return sql`(${sql.join(
    kinds.map((k) => sql`${k}::auth_event_kind`),
    sql`, `,
  )})`;
}
