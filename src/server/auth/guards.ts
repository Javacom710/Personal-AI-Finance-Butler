import 'server-only';

/**
 * Authentication guards (SECURITY.md §0, §2).
 *
 * These answer **"who are you?"** and nothing else. They do not answer "may you
 * touch this account?" — that is authorization, it is per entity, and it lives
 * in the application services that arrive in Phase 3. Passing `requireSession`
 * proves only that a request belongs to a known user.
 *
 * Every entry point calls this explicitly. It is not inherited implicitly from
 * a parent layout, because "I assumed the layout checked" is how an unguarded
 * server action ships.
 */

import { redirect } from 'next/navigation';

import { safeReturnTo } from '../../lib/safe-redirect';
import { getSession } from './session-cookie';
import type { SessionUser } from './session-store';

export { safeReturnTo };

export const LOGIN_PATH = '/login';

/**
 * Require a session, or redirect to login.
 *
 * `returnTo` carries the path the user was trying to reach so they land back
 * there after authenticating. It is validated as a same-site absolute path
 * before use.
 */
export async function requireSession(returnTo?: string): Promise<SessionUser> {
  const session = await getSession();
  if (session) return session;

  const target = safeReturnTo(returnTo);
  redirect(target ? `${LOGIN_PATH}?next=${encodeURIComponent(target)}` : LOGIN_PATH);
}

/** For entry points that want to branch rather than redirect, such as the login page itself. */
export async function optionalSession(): Promise<SessionUser | null> {
  return getSession();
}
