import 'server-only';

/**
 * The login use case (SECURITY.md §1).
 *
 * Two steps, in this order, with no way around either:
 *
 *   password  →  TOTP  →  session
 *
 * Order matters for what an attacker learns. Rate limits are checked before any
 * Argon2 work; an unknown address still pays the cost of a dummy verification
 * so response time does not enumerate accounts; and the failure returned to the
 * caller is the same shape whether the address was wrong, the password was
 * wrong, or the account does not exist.
 */

import { eq } from 'drizzle-orm';

import { db } from '../db/client';
import { users } from '../db/schema';
import { log } from '../log';
import { recordAuthEvent } from './events';
import { decryptSecret } from './crypto';
import { clearFailures, evaluateLock, registerFailure } from './lockout';
import { performDummyVerify, verifyPassword } from './password';
import { checkAccountLoginRateLimit, checkLoginRateLimit, checkTotpRateLimit } from './rate-limit';
import {
  createSession,
  purgeExpiredSessions,
  revokeSession,
  type IssuedSession,
  type RequestContext,
} from './session-store';
import { consumeRecoveryCode, verifyTotp } from './totp';

export type PasswordStepResult =
  | { readonly status: 'totp_required'; readonly userId: string }
  | { readonly status: 'invalid_credentials' }
  | { readonly status: 'locked'; readonly retryAfterSeconds: number }
  | { readonly status: 'rate_limited'; readonly retryAfterSeconds: number }
  /** The account exists but has no second factor. Cannot occur through the provisioning path. */
  | { readonly status: 'totp_not_configured' };

export async function verifyPasswordStep(
  email: string,
  password: string,
  ctx: RequestContext,
): Promise<PasswordStepResult> {
  const ipLimit = await checkLoginRateLimit(ctx.ip);
  if (!ipLimit.allowed) {
    log.warn('login rate limited by ip', { ip: ctx.ip });
    return { status: 'rate_limited', retryAfterSeconds: ipLimit.retryAfterSeconds };
  }

  const [user] = await db()
    .select({
      id: users.id,
      passwordHash: users.passwordHash,
      totpEnabled: users.totpEnabled,
      lockedUntil: users.lockedUntil,
    })
    .from(users)
    .where(eq(users.email, email.trim()))
    .limit(1);

  if (!user) {
    // Do the work anyway. Returning early here is the classic account-enumeration
    // oracle: ~310 ms for a real address, microseconds for an invented one.
    await performDummyVerify(password);
    await recordAuthEvent('login_failure', null, ctx);
    return { status: 'invalid_credentials' };
  }

  const lock = evaluateLock(user.lockedUntil);
  if (lock.locked) {
    await recordAuthEvent('login_failure', user.id, ctx);
    return { status: 'locked', retryAfterSeconds: lock.retryAfterSeconds };
  }

  const accountLimit = await checkAccountLoginRateLimit(user.id);
  if (!accountLimit.allowed) {
    return { status: 'rate_limited', retryAfterSeconds: accountLimit.retryAfterSeconds };
  }

  const passwordOk = await verifyPassword(user.passwordHash, password);
  if (!passwordOk) {
    const outcome = await registerFailure(user.id);
    await recordAuthEvent('login_failure', user.id, ctx);
    if (outcome.justLocked) {
      await recordAuthEvent('lockout', user.id, ctx);
      log.warn('account locked after consecutive failures', { userId: user.id });
      return {
        status: 'locked',
        retryAfterSeconds: Math.ceil(((outcome.lockedUntil?.getTime() ?? 0) - Date.now()) / 1000),
      };
    }
    return { status: 'invalid_credentials' };
  }

  if (!user.totpEnabled) {
    // Mandatory second factor: a password-only account cannot receive a session.
    log.error('account has no second factor configured', { userId: user.id });
    return { status: 'totp_not_configured' };
  }

  // The password was right, so the consecutive-failure count has served its
  // purpose. An active lock was already rejected above, so this releases
  // nothing that was still in force.
  await clearFailures(user.id);

  return { status: 'totp_required', userId: user.id };
}

export type SecondFactorResult =
  | {
      readonly status: 'ok';
      readonly session: IssuedSession;
      readonly recoveryCodesRemaining?: number;
    }
  | { readonly status: 'invalid' }
  | { readonly status: 'replayed' }
  | { readonly status: 'rate_limited'; readonly retryAfterSeconds: number }
  | { readonly status: 'locked'; readonly retryAfterSeconds: number };

/**
 * Verify the second factor and issue a session.
 *
 * Accepts either a 6-digit TOTP code or one of the ten single-use recovery
 * codes. A consumed recovery code is removed from the row, which is what makes
 * "single use" true even if the same code is submitted twice — the second
 * attempt finds it gone.
 */
export async function verifySecondFactorStep(
  userId: string,
  code: string,
  ctx: RequestContext,
): Promise<SecondFactorResult> {
  const limit = await checkTotpRateLimit(userId);
  if (!limit.allowed) {
    return { status: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds };
  }

  const [user] = await db()
    .select({
      id: users.id,
      email: users.email,
      totpSecretEnc: users.totpSecretEnc,
      totpEnabled: users.totpEnabled,
      totpRecoveryHashes: users.totpRecoveryHashes,
      lastTotpStep: users.lastTotpStep,
      lockedUntil: users.lockedUntil,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || !user.totpEnabled || !user.totpSecretEnc) {
    return { status: 'invalid' };
  }

  const lock = evaluateLock(user.lockedUntil);
  if (lock.locked) return { status: 'locked', retryAfterSeconds: lock.retryAfterSeconds };

  const secret = decryptSecret(user.totpSecretEnc);
  const result = verifyTotp(secret, user.email, code, user.lastTotpStep);

  if (result.ok) {
    await db().update(users).set({ lastTotpStep: result.step }).where(eq(users.id, user.id));
    return { status: 'ok', session: await completeLogin(user.id, ctx) };
  }

  if (result.reason === 'replayed') {
    await recordAuthEvent('totp_failure', user.id, ctx);
    log.warn('totp code replayed', { userId: user.id });
    return { status: 'replayed' };
  }

  // Not a valid TOTP code — it may still be a recovery code.
  const recovery = await consumeRecoveryCode(user.totpRecoveryHashes, code);
  if (recovery.matched) {
    await db()
      .update(users)
      .set({ totpRecoveryHashes: recovery.remainingHashes, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    log.warn('recovery code used', { userId: user.id, remaining: recovery.remainingHashes.length });
    return {
      status: 'ok',
      session: await completeLogin(user.id, ctx),
      recoveryCodesRemaining: recovery.remainingHashes.length,
    };
  }

  await registerFailure(user.id);
  await recordAuthEvent('totp_failure', user.id, ctx);
  return { status: 'invalid' };
}

async function completeLogin(userId: string, ctx: RequestContext): Promise<IssuedSession> {
  await clearFailures(userId);
  const session = await createSession(userId, ctx);
  await recordAuthEvent('login_success', userId, ctx);

  // Opportunistic housekeeping: login is infrequent, and this keeps the table
  // from accumulating rows that no longer authenticate anything.
  await purgeExpiredSessions().catch(() => 0);

  log.info('login succeeded', { userId });
  return session;
}

export async function logout(sessionId: string, userId: string, ctx: RequestContext): Promise<void> {
  await revokeSession(sessionId);
  await recordAuthEvent('logout', userId, ctx);
}
