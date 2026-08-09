import 'server-only';

/**
 * The request-bound half of session handling: cookies and client metadata.
 *
 * Everything here needs `next/headers`, which only exists inside a request.
 * Keeping it separate from `session-store.ts` means the login use case and the
 * provisioning CLI can create and revoke sessions without a request context.
 */

import { cookies, headers } from 'next/headers';

import { env } from '../../lib/env';
import { resolveSession, type IssuedSession, type RequestContext, type SessionUser } from './session-store';

/**
 * `__Host-` requires Secure and forbids a Domain attribute, which is exactly the
 * scoping wanted — but browsers only accept it on a secure origin. Over plain
 * http on a development machine the cookie would be silently dropped and login
 * would appear to "not work", so the prefix follows the origin scheme.
 * Production is https, and therefore always gets it.
 */
export function cookieIsSecure(): boolean {
  return env().APP_ORIGIN.startsWith('https://') || env().NODE_ENV === 'production';
}

export function sessionCookieName(): string {
  return cookieIsSecure() ? '__Host-fos_session' : 'fos_session';
}

export async function setSessionCookie(issued: IssuedSession): Promise<void> {
  const store = await cookies();
  store.set(sessionCookieName(), issued.token, {
    httpOnly: true,
    secure: cookieIsSecure(),
    sameSite: 'lax',
    path: '/',
    // Deliberately no `domain`: `__Host-` forbids it, and a host-only cookie
    // cannot be read by a sibling subdomain.
    expires: issued.expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(sessionCookieName(), '', {
    httpOnly: true,
    secure: cookieIsSecure(),
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(sessionCookieName())?.value;
  if (!token) return null;
  return resolveSession(token);
}

/**
 * The client's address and user agent, as seen through the reverse proxy.
 *
 * `x-forwarded-for` is trustworthy only because Caddy sets it and the app is
 * not reachable directly (DEPLOYMENT.md). Taking the first entry is correct for
 * that topology; a different proxy chain would need this revisited.
 */
export async function requestContext(): Promise<RequestContext> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null;
  return {
    ip: ip && ip.length > 0 ? ip : null,
    userAgent: h.get('user-agent'),
  };
}
