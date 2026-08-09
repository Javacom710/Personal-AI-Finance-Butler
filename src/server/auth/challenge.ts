import 'server-only';

/**
 * Cookie plumbing for the TOTP challenge. The signing and verification live in
 * `challenge-token.ts`, which has no request dependency and is unit-tested
 * directly.
 */

import { cookies } from 'next/headers';

import { env } from '../../lib/env';
import { CHALLENGE_TTL_MS, decodeChallenge, encodeChallenge, type Challenge } from './challenge-token';

export type { Challenge };

function isSecure(): boolean {
  return env().APP_ORIGIN.startsWith('https://') || env().NODE_ENV === 'production';
}

function cookieName(): string {
  return isSecure() ? '__Host-fos_challenge' : 'fos_challenge';
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: isSecure(),
    sameSite: 'lax' as const,
    path: '/',
  };
}

export async function setChallengeCookie(userId: string): Promise<void> {
  const store = await cookies();
  store.set(cookieName(), encodeChallenge(userId), {
    ...cookieOptions(),
    maxAge: Math.floor(CHALLENGE_TTL_MS / 1000),
  });
}

export async function readChallenge(): Promise<Challenge | null> {
  const store = await cookies();
  return decodeChallenge(store.get(cookieName())?.value);
}

export async function clearChallengeCookie(): Promise<void> {
  const store = await cookies();
  store.set(cookieName(), '', { ...cookieOptions(), maxAge: 0 });
}
