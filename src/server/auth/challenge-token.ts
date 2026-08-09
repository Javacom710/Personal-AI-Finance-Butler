import 'server-only';

/**
 * The signed token carrying a half-finished login between the password step and
 * the TOTP step.
 *
 * The password has been verified but no session exists yet — TOTP is mandatory
 * and there is no path around it (SECURITY.md §1). That intermediate state has
 * to survive one HTTP round trip, and it is carried in a short-lived
 * HMAC-signed cookie rather than a database row: it is worthless five minutes
 * later, and a table would need its own expiry sweep.
 *
 * The token proves only "this browser passed the password step for user X
 * recently". It grants nothing on its own — the TOTP step still runs, still
 * rate-limits, and still checks the replay guard.
 *
 * Kept separate from the cookie plumbing so the signing and verification can be
 * unit-tested without a request context.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from '../../lib/env';

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** Domain separation: this key signs challenges and nothing else may reuse the construction. */
const HMAC_LABEL = 'finance-os/totp-challenge/v1';

function sign(payload: string): string {
  return createHmac('sha256', Buffer.from(env().SESSION_COOKIE_SECRET, 'base64'))
    .update(`${HMAC_LABEL}.${payload}`)
    .digest('base64url');
}

export interface Challenge {
  readonly userId: string;
  readonly expiresAt: number;
}

export function encodeChallenge(userId: string, now: Date = new Date()): string {
  const payload = Buffer.from(
    JSON.stringify({ userId, expiresAt: now.getTime() + CHALLENGE_TTL_MS }),
    'utf8',
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/**
 * Returns `null` for a missing, malformed, mis-signed, or expired token — all
 * indistinguishable to the caller, which is the point.
 */
export function decodeChallenge(value: string | undefined, now: Date = new Date()): Challenge | null {
  if (!value) return null;

  const separator = value.lastIndexOf('.');
  if (separator <= 0) return null;

  const payload = value.slice(0, separator);
  const provided = Buffer.from(value.slice(separator + 1));
  const expected = Buffer.from(sign(payload));

  // Length is compared first because timingSafeEqual throws on a mismatch; the
  // length of a signature is not a secret.
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as Challenge).userId !== 'string' ||
      typeof (parsed as Challenge).expiresAt !== 'number'
    ) {
      return null;
    }
    const challenge = parsed as Challenge;
    return challenge.expiresAt <= now.getTime() ? null : challenge;
  } catch {
    return null;
  }
}
