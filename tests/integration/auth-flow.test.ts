import { Secret, TOTP } from 'otpauth';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createAccount } from '@/server/auth/account';
import { recordAuthEvent } from '@/server/auth/events';
import { verifyPasswordStep, verifySecondFactorStep, logout } from '@/server/auth/login';
import { hashToken, resolveSession, revokeSession, ABSOLUTE_LIFETIME_MS, IDLE_TIMEOUT_MS } from '@/server/auth/session-store';
import { db } from '@/server/db/client';
import { authEvents, sessions, settings, userState, users } from '@/server/db/schema';
import { NO_CONTEXT, TEST_PASSWORD, closeHarness, createTestUser, truncateAll } from './harness';

beforeEach(truncateAll);
afterAll(closeHarness);

function totpCode(secret: string, email: string, at = new Date()): string {
  return new TOTP({
    issuer: 'Finance OS',
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate({ timestamp: at.getTime() });
}

describe('account provisioning', () => {
  it('creates the user with settings and cache-version rows in one transaction', async () => {
    const user = await createTestUser();

    const [settingsRow] = await db().select().from(settings).where(eq(settings.userId, user.userId));
    const [stateRow] = await db().select().from(userState).where(eq(userState.userId, user.userId));

    expect(settingsRow?.baseCurrency).toBe('INR');
    expect(settingsRow?.timezone).toBe('Asia/Kolkata');
    expect(stateRow?.moneyLedgerVersion).toBe(0n);
    expect(stateRow?.investmentLedgerVersion).toBe(0n);
  });

  it('enrols TOTP at creation, so no account can exist password-only', async () => {
    const user = await createTestUser();
    const [row] = await db().select().from(users).where(eq(users.id, user.userId));
    expect(row?.totpEnabled).toBe(true);
    expect(row?.totpSecretEnc).not.toBeNull();
    expect(row?.totpRecoveryHashes).toHaveLength(10);
  });

  it('never stores the password or the TOTP secret in plaintext', async () => {
    const user = await createTestUser();
    const [row] = await db().select().from(users).where(eq(users.id, user.userId));

    expect(row?.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(row?.passwordHash).not.toContain(TEST_PASSWORD);

    const ciphertext = row?.totpSecretEnc?.toString('utf8') ?? '';
    expect(ciphertext).not.toContain(user.totpSecret);
  });

  it('refuses a second account unless explicitly allowed', async () => {
    await createTestUser('first@example.com');
    const result = await createAccount('second@example.com', TEST_PASSWORD);
    expect(result.status).toBe('already_provisioned');
  });

  it('rejects a weak password before writing anything', async () => {
    const result = await createAccount('weak@example.com', 'short', { allowAdditional: true });
    expect(result.status).toBe('weak_password');
    expect(await db().select().from(users)).toHaveLength(0);
  });
});

describe('login: password step', () => {
  it('requires a second factor rather than issuing a session', async () => {
    const user = await createTestUser();
    const result = await verifyPasswordStep(user.email, user.password, NO_CONTEXT);

    expect(result.status).toBe('totp_required');
    // No session exists yet — the password alone buys nothing.
    expect(await db().select().from(sessions)).toHaveLength(0);
  });

  it('rejects a wrong password', async () => {
    const user = await createTestUser();
    const result = await verifyPasswordStep(user.email, 'not-the-password-at-all', NO_CONTEXT);
    expect(result.status).toBe('invalid_credentials');
  });

  it('gives the same answer for an unknown address as for a wrong password', async () => {
    await createTestUser();
    const unknown = await verifyPasswordStep('nobody@example.com', 'whatever-password', NO_CONTEXT);
    expect(unknown.status).toBe('invalid_credentials');
  });

  it('matches the email case-insensitively', async () => {
    const user = await createTestUser('Person@Example.com');
    const result = await verifyPasswordStep('person@example.com', user.password, NO_CONTEXT);
    expect(result.status).toBe('totp_required');
  });

  it('records every attempt, successful or not', async () => {
    const user = await createTestUser();
    await verifyPasswordStep(user.email, 'wrong-password-here', NO_CONTEXT);
    await verifyPasswordStep('nobody@example.com', 'wrong-password-here', NO_CONTEXT);

    const events = await db().select().from(authEvents);
    expect(events.filter((e) => e.kind === 'login_failure')).toHaveLength(2);
    // The attempt against an unknown address carries no user id.
    expect(events.filter((e) => e.userId === null)).toHaveLength(1);
  });
});

describe('login: second factor', () => {
  it('issues a session for a valid TOTP code', async () => {
    const user = await createTestUser();
    const result = await verifySecondFactorStep(
      user.userId,
      totpCode(user.totpSecret, user.email),
      NO_CONTEXT,
    );

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    const rows = await db().select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(user.userId);

    // SECURITY.md §1: the token is never stored, only its SHA-256.
    const stored = rows[0]!.tokenHash;
    expect(stored.equals(hashToken(result.session.token))).toBe(true);
    expect(stored.toString('utf8')).not.toContain(result.session.token);
    expect(stored.length).toBe(32);
  });

  it('sets the absolute lifetime to 30 days', async () => {
    const user = await createTestUser();
    const result = await verifySecondFactorStep(
      user.userId,
      totpCode(user.totpSecret, user.email),
      NO_CONTEXT,
    );
    if (result.status !== 'ok') throw new Error('expected a session');

    const drift = Math.abs(
      result.session.expiresAt.getTime() - (Date.now() + ABSOLUTE_LIFETIME_MS),
    );
    expect(drift).toBeLessThan(10_000);
  });

  it('rejects a wrong code and writes no session', async () => {
    const user = await createTestUser();
    const result = await verifySecondFactorStep(user.userId, '000000', NO_CONTEXT);
    expect(result.status).toBe('invalid');
    expect(await db().select().from(sessions)).toHaveLength(0);
  });

  it('rejects a code replayed within its window', async () => {
    const user = await createTestUser();
    const code = totpCode(user.totpSecret, user.email);

    expect((await verifySecondFactorStep(user.userId, code, NO_CONTEXT)).status).toBe('ok');

    const replay = await verifySecondFactorStep(user.userId, code, NO_CONTEXT);
    expect(replay.status).toBe('replayed');
    // The replay must not have produced a second session.
    expect(await db().select().from(sessions)).toHaveLength(1);
  });

  it('persists the consumed step, so a restart does not reopen the replay window', async () => {
    const user = await createTestUser();
    await verifySecondFactorStep(user.userId, totpCode(user.totpSecret, user.email), NO_CONTEXT);

    const [row] = await db().select().from(users).where(eq(users.id, user.userId));
    expect(row?.lastTotpStep).not.toBeNull();
  });

  it('accepts a recovery code and consumes exactly one', async () => {
    const user = await createTestUser();
    const result = await verifySecondFactorStep(user.userId, user.recoveryCodes[3]!, NO_CONTEXT);

    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.recoveryCodesRemaining).toBe(9);

    const [row] = await db().select().from(users).where(eq(users.id, user.userId));
    expect(row?.totpRecoveryHashes).toHaveLength(9);
  });

  it('will not accept the same recovery code twice', async () => {
    const user = await createTestUser();
    const code = user.recoveryCodes[0]!;

    expect((await verifySecondFactorStep(user.userId, code, NO_CONTEXT)).status).toBe('ok');
    expect((await verifySecondFactorStep(user.userId, code, NO_CONTEXT)).status).toBe('invalid');
  });
});

describe('session lifecycle', () => {
  async function signIn(email = 'session@example.com') {
    const user = await createTestUser(email);
    const result = await verifySecondFactorStep(
      user.userId,
      totpCode(user.totpSecret, user.email),
      NO_CONTEXT,
    );
    if (result.status !== 'ok') throw new Error('expected a session');
    return { user, session: result.session };
  }

  it('resolves a valid token to the user', async () => {
    const { user, session } = await signIn();
    const resolved = await resolveSession(session.token);
    expect(resolved?.userId).toBe(user.userId);
    expect(resolved?.email).toBe(user.email);
  });

  it('resolves an unknown token to null', async () => {
    await signIn();
    expect(await resolveSession('not-a-real-token')).toBeNull();
  });

  it('revokes immediately, because the check is a database read', async () => {
    const { session } = await signIn();
    expect(await resolveSession(session.token)).not.toBeNull();

    await revokeSession(session.sessionId);
    expect(await resolveSession(session.token)).toBeNull();
  });

  it('rejects a session past its absolute expiry and deletes the row', async () => {
    const { session } = await signIn();
    await db()
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.id, session.sessionId));

    expect(await resolveSession(session.token)).toBeNull();
    expect(await db().select().from(sessions)).toHaveLength(0);
  });

  it('rejects a session idle beyond the timeout, even though it has not expired', async () => {
    const { session } = await signIn();
    await db()
      .update(sessions)
      .set({ lastSeenAt: new Date(Date.now() - IDLE_TIMEOUT_MS - 60_000) })
      .where(eq(sessions.id, session.sessionId));

    expect(await resolveSession(session.token)).toBeNull();
  });

  it('refreshes last_seen_at once the throttle window has passed', async () => {
    const { session } = await signIn();
    const stale = new Date(Date.now() - 10 * 60 * 1000);
    await db().update(sessions).set({ lastSeenAt: stale }).where(eq(sessions.id, session.sessionId));

    await resolveSession(session.token);

    const [row] = await db().select().from(sessions).where(eq(sessions.id, session.sessionId));
    expect(row!.lastSeenAt.getTime()).toBeGreaterThan(stale.getTime());
  });

  it('logout deletes the row and records the event', async () => {
    const { user, session } = await signIn();
    await logout(session.sessionId, user.userId, NO_CONTEXT);

    expect(await resolveSession(session.token)).toBeNull();
    const events = await db().select().from(authEvents);
    expect(events.some((e) => e.kind === 'logout')).toBe(true);
  });

  it('two logins produce two independent sessions', async () => {
    const user = await createTestUser();
    const first = await verifySecondFactorStep(user.userId, user.recoveryCodes[0]!, NO_CONTEXT);
    const second = await verifySecondFactorStep(user.userId, user.recoveryCodes[1]!, NO_CONTEXT);
    if (first.status !== 'ok' || second.status !== 'ok') throw new Error('expected two sessions');

    expect(first.session.token).not.toBe(second.session.token);
    expect(await db().select().from(sessions)).toHaveLength(2);

    await revokeSession(first.session.sessionId);
    expect(await resolveSession(first.session.token)).toBeNull();
    expect(await resolveSession(second.session.token)).not.toBeNull();
  });
});

describe('lockout', () => {
  it('locks the account after five consecutive failures and releases on expiry', async () => {
    const user = await createTestUser();

    for (let i = 0; i < 4; i += 1) {
      const result = await verifyPasswordStep(user.email, 'wrong-password-value', NO_CONTEXT);
      expect(result.status).toBe('invalid_credentials');
    }

    const fifth = await verifyPasswordStep(user.email, 'wrong-password-value', NO_CONTEXT);
    expect(fifth.status).toBe('locked');

    // Even the correct password is refused while the lock is in force.
    const correct = await verifyPasswordStep(user.email, user.password, NO_CONTEXT);
    expect(correct.status).toBe('locked');

    // Releasing only the lock is not enough, and that is not a bug: the
    // per-account rate limit (5 failures / 15 min) is a second, independent
    // gate. Both are in force after five failures.
    await db()
      .update(users)
      .set({ lockedUntil: new Date(Date.now() - 1000) })
      .where(eq(users.id, user.userId));

    const stillLimited = await verifyPasswordStep(user.email, user.password, NO_CONTEXT);
    expect(stillLimited.status).toBe('rate_limited');

    // Fifteen minutes passing clears both, because both windows are 15 minutes.
    await db().update(authEvents).set({ createdAt: new Date(Date.now() - 20 * 60 * 1000) });

    const afterRelease = await verifyPasswordStep(user.email, user.password, NO_CONTEXT);
    expect(afterRelease.status).toBe('totp_required');
  });

  it('resets the failure count after a correct password', async () => {
    const user = await createTestUser();
    await verifyPasswordStep(user.email, 'wrong-password-value', NO_CONTEXT);
    await verifyPasswordStep(user.email, 'wrong-password-value', NO_CONTEXT);
    await verifyPasswordStep(user.email, user.password, NO_CONTEXT);

    const [row] = await db().select().from(users).where(eq(users.id, user.userId));
    expect(row?.failedAttempts).toBe(0);
  });

  it('writes a lockout event when the threshold is crossed', async () => {
    const user = await createTestUser();
    for (let i = 0; i < 5; i += 1) {
      await verifyPasswordStep(user.email, 'wrong-password-value', NO_CONTEXT);
    }
    const events = await db().select().from(authEvents);
    expect(events.some((e) => e.kind === 'lockout')).toBe(true);
  });
});

describe('rate limiting', () => {
  it('refuses further login attempts from an IP past the window limit', async () => {
    const user = await createTestUser();
    const ctx = { ip: '198.51.100.42', userAgent: 'vitest' };

    // Seed the window directly, so the test measures the limiter rather than
    // spending ten Argon2 hashes to get there.
    for (let i = 0; i < 10; i += 1) {
      await recordAuthEvent('login_failure', null, ctx);
    }

    const result = await verifyPasswordStep(user.email, user.password, ctx);
    expect(result.status).toBe('rate_limited');
  });

  it('scopes the limit per IP, so one client cannot lock out another', async () => {
    const user = await createTestUser();
    const noisy = { ip: '198.51.100.42', userAgent: 'vitest' };
    const quiet = { ip: '203.0.113.7', userAgent: 'vitest' };

    for (let i = 0; i < 10; i += 1) await recordAuthEvent('login_failure', null, noisy);

    expect((await verifyPasswordStep(user.email, user.password, noisy)).status).toBe('rate_limited');
    expect((await verifyPasswordStep(user.email, user.password, quiet)).status).toBe('totp_required');
  });

  it('limits second-factor attempts per account', async () => {
    const user = await createTestUser();
    for (let i = 0; i < 5; i += 1) {
      await recordAuthEvent('totp_failure', user.userId, NO_CONTEXT);
    }

    const result = await verifySecondFactorStep(
      user.userId,
      totpCode(user.totpSecret, user.email),
      NO_CONTEXT,
    );
    expect(result.status).toBe('rate_limited');
  });

  it('ignores events outside the window', async () => {
    const user = await createTestUser();
    const ctx = { ip: '198.51.100.99', userAgent: 'vitest' };

    for (let i = 0; i < 10; i += 1) await recordAuthEvent('login_failure', null, ctx);
    // Age every event past the 15-minute window.
    await db().update(authEvents).set({ createdAt: new Date(Date.now() - 20 * 60 * 1000) });

    const result = await verifyPasswordStep(user.email, user.password, ctx);
    expect(result.status).toBe('totp_required');
  });
});

describe('full sign-in workflow', () => {
  it('password, then TOTP, then a working session — and nothing skippable', async () => {
    const user = await createTestUser('workflow@example.com');

    // 1. Password alone gets no session.
    const step1 = await verifyPasswordStep(user.email, user.password, NO_CONTEXT);
    expect(step1.status).toBe('totp_required');
    expect(await db().select().from(sessions)).toHaveLength(0);

    // 2. A wrong second factor still gets no session.
    expect((await verifySecondFactorStep(user.userId, '111111', NO_CONTEXT)).status).toBe('invalid');
    expect(await db().select().from(sessions)).toHaveLength(0);

    // 3. The right code issues one.
    const step2 = await verifySecondFactorStep(
      user.userId,
      totpCode(user.totpSecret, user.email),
      NO_CONTEXT,
    );
    expect(step2.status).toBe('ok');
    if (step2.status !== 'ok') return;

    // 4. The token authenticates.
    expect((await resolveSession(step2.session.token))?.userId).toBe(user.userId);

    // 5. Sign-out ends it.
    await logout(step2.session.sessionId, user.userId, NO_CONTEXT);
    expect(await resolveSession(step2.session.token)).toBeNull();

    // 6. The whole sequence is on the record.
    const kinds = (await db().select().from(authEvents).orderBy(sql`${authEvents.id}`)).map(
      (e) => e.kind,
    );
    expect(kinds).toContain('totp_failure');
    expect(kinds).toContain('login_success');
    expect(kinds).toContain('logout');
  });
});
