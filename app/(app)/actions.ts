'use server';

import { redirect } from 'next/navigation';

import { requireSession } from '@/server/auth/guards';
import { logout } from '@/server/auth/login';
import { clearSessionCookie, requestContext } from '@/server/auth/session-cookie';

/**
 * Sign out.
 *
 * `requireSession` runs here even though the layout already checked: a server
 * action is its own entry point and is reachable directly by POST, so it does
 * its own authentication (SECURITY.md §2).
 *
 * Logout deletes the session row. There is no denylist to maintain, because
 * there is no stateless token to deny.
 */
export async function signOutAction(): Promise<void> {
  const session = await requireSession();
  await logout(session.sessionId, session.userId, await requestContext());
  await clearSessionCookie();
  redirect('/login');
}
