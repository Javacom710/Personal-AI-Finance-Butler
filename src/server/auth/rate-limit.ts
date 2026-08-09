import 'server-only';

/**
 * Authentication rate limits (SECURITY.md §6).
 *
 * Backed by Postgres — specifically by `auth_events`, which is already written
 * on every attempt. Counting rows in a time window is the whole mechanism; no
 * separate store, no Redis, and nothing to keep in sync with the audit trail.
 *
 * Limits enforced here:
 *
 * | Endpoint     | Limit                                  |
 * |--------------|----------------------------------------|
 * | Login        | 10 / 15 min per IP, 5 / 15 min per account |
 * | TOTP verify  | 5 / 15 min per account                 |
 *
 * The AI, export and general authenticated limits in SECURITY.md §6 belong to
 * endpoints that do not exist yet; they arrive with them.
 */

import { countAnonymousFailures, countByIp, countByUser } from './events';

export const WINDOW_MS = 15 * 60 * 1000;

export const LOGIN_PER_IP = 10;
export const LOGIN_PER_ACCOUNT = 5;
export const TOTP_PER_ACCOUNT = 5;

export interface RateLimitVerdict {
  readonly allowed: boolean;
  /** Seconds the client should wait, for the `Retry-After` header. */
  readonly retryAfterSeconds: number;
}

const ALLOWED: RateLimitVerdict = { allowed: true, retryAfterSeconds: 0 };

function denied(): RateLimitVerdict {
  return { allowed: false, retryAfterSeconds: Math.ceil(WINDOW_MS / 1000) };
}

/**
 * Checked **before** the password is verified, so a rate-limited attempt costs
 * no Argon2 work. That matters: a 310 ms hash is itself a denial-of-service
 * lever if an attacker can force one per request.
 */
export async function checkLoginRateLimit(ip: string | null): Promise<RateLimitVerdict> {
  const attempts = await countByIp(['login_success', 'login_failure'], ip, WINDOW_MS);
  if (attempts >= LOGIN_PER_IP) return denied();

  // Attempts against non-existent addresses carry no user_id and would slip
  // past the per-account limit entirely.
  const anonymous = await countAnonymousFailures(ip, WINDOW_MS);
  if (anonymous >= LOGIN_PER_IP) return denied();

  return ALLOWED;
}

/** Checked once the address resolves to an account, before verifying the password. */
export async function checkAccountLoginRateLimit(userId: string): Promise<RateLimitVerdict> {
  const failures = await countByUser(['login_failure'], userId, WINDOW_MS);
  return failures >= LOGIN_PER_ACCOUNT ? denied() : ALLOWED;
}

export async function checkTotpRateLimit(userId: string): Promise<RateLimitVerdict> {
  const failures = await countByUser(['totp_failure'], userId, WINDOW_MS);
  return failures >= TOTP_PER_ACCOUNT ? denied() : ALLOWED;
}
