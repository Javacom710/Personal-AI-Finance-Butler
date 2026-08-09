import 'server-only';

/**
 * Account provisioning.
 *
 * There is deliberately **no web registration endpoint**. This is a private,
 * single-user application (`CLAUDE.md <user_model>`), so a signup route would
 * be an unauthenticated write path that exists only to be attacked. The account
 * is created from the host with `npm run auth:create-user`, which means the only
 * unauthenticated endpoint the application exposes is login itself.
 *
 * TOTP is enrolled during creation, not deferred, so an account cannot exist in
 * a password-only state (SECURITY.md §1).
 */

import { eq, sql } from 'drizzle-orm';

import { db } from '../db/client';
import { settings, users, userState } from '../db/schema';
import { encryptSecret } from './crypto';
import { checkPasswordPolicy, hashPassword, verifyPassword, type PasswordPolicyFailure } from './password';
import { revokeOtherSessions } from './session-store';
import { generateRecoveryCodes, generateTotpSecret } from './totp';

export interface CreatedAccount {
  readonly userId: string;
  readonly email: string;
  /** Shown once. Never retrievable afterwards — only its ciphertext is stored. */
  readonly totpSecretBase32: string;
  readonly totpUri: string;
  /** Shown once. Only Argon2id hashes are stored. */
  readonly recoveryCodes: string[];
}

export type CreateAccountResult =
  | { readonly status: 'created'; readonly account: CreatedAccount }
  | { readonly status: 'email_taken' }
  | { readonly status: 'weak_password'; readonly failure: PasswordPolicyFailure }
  | { readonly status: 'already_provisioned' };

/**
 * Create the single user, with its settings and cache-version rows.
 *
 * Refuses if a user already exists unless `allowAdditional` is set: silently
 * creating a second account in a single-user application is more likely to be a
 * mistake than an intention.
 */
export async function createAccount(
  email: string,
  password: string,
  options: { readonly baseCurrency?: string; readonly allowAdditional?: boolean } = {},
): Promise<CreateAccountResult> {
  const normalisedEmail = email.trim();

  const policyFailure = checkPasswordPolicy(password, normalisedEmail);
  if (policyFailure) return { status: 'weak_password', failure: policyFailure };

  if (!options.allowAdditional && (await userCount()) > 0) {
    return { status: 'already_provisioned' };
  }

  const [duplicate] = await db()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalisedEmail))
    .limit(1);
  if (duplicate) return { status: 'email_taken' };

  const enrolment = generateTotpSecret(normalisedEmail);
  const recovery = await generateRecoveryCodes();
  const passwordHash = await hashPassword(password);

  // One transaction: a user without settings or without a `user_state` row
  // would be a half-provisioned account that every later phase has to defend
  // against.
  const account = await db().transaction(async (tx) => {
    const [created] = await tx
      .insert(users)
      .values({
        email: normalisedEmail,
        passwordHash,
        totpSecretEnc: encryptSecret(enrolment.secretBase32),
        totpEnabled: true,
        totpRecoveryHashes: recovery.hashes,
      })
      .returning({ id: users.id });

    if (!created) throw new Error('Failed to insert user row.');

    await tx.insert(settings).values({
      userId: created.id,
      baseCurrency: options.baseCurrency ?? 'INR',
    });
    await tx.insert(userState).values({ userId: created.id });

    return created;
  });

  return {
    status: 'created',
    account: {
      userId: account.id,
      email: normalisedEmail,
      totpSecretBase32: enrolment.secretBase32,
      totpUri: enrolment.uri,
      recoveryCodes: recovery.plaintext,
    },
  };
}

export type ChangePasswordResult =
  | { readonly status: 'changed'; readonly sessionsRevoked: number }
  | { readonly status: 'incorrect_password' }
  | { readonly status: 'weak_password'; readonly failure: PasswordPolicyFailure };

/**
 * Change a password. Requires the current one and revokes every other session
 * (SECURITY.md §1) — a password change is worthless if a stolen session survives it.
 */
export async function changePassword(
  userId: string,
  currentSessionId: string,
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResult> {
  const [user] = await db()
    .select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) return { status: 'incorrect_password' };

  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    return { status: 'incorrect_password' };
  }

  const policyFailure = checkPasswordPolicy(newPassword, user.email);
  if (policyFailure) return { status: 'weak_password', failure: policyFailure };

  await db()
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() })
    .where(eq(users.id, userId));

  const sessionsRevoked = await revokeOtherSessions(userId, currentSessionId);
  return { status: 'changed', sessionsRevoked };
}

export async function userCount(): Promise<number> {
  const [row] = await db().select({ n: sql<number>`count(*)::int` }).from(users);
  return row?.n ?? 0;
}
