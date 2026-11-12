import 'server-only';

/**
 * Settings → Data → Delete everything ([SECURITY.md §9](../../../docs/SECURITY.md#9-data-export-backup-and-deletion)).
 *
 * The one irreversible action in the application, so it asks for everything at
 * once and checks it in the cheapest-first order:
 *
 *   confirmation phrase → rate limit and lock → password → TOTP code → delete
 *
 * A session alone is not enough: a laptop left signed in must not be able to
 * erase the ledger. The password and a **fresh TOTP code** are required, the
 * same factors as signing in. A recovery code is not accepted here — it is the
 * way back into an account, not a way to destroy one.
 *
 * A wrong password or code counts toward the same lockout and rate limits as
 * login, so this form cannot be used to guess either.
 *
 * ## Why not one statement
 *
 * SECURITY.md first described this as `DELETE FROM users WHERE id = $1`, relying
 * on every user-owned table cascading from `users`. They do — but six foreign
 * keys *between* the user's own tables are `ON DELETE RESTRICT` (entries and
 * investment transactions → accounts, transactions → categories, child →
 * parent category, investment transactions → instruments, a liability → its
 * linked account). `RESTRICT` is checked row by row, so the cascade fails the
 * first time it reaches an account before that account's entries.
 *
 * Those constraints are deliberate and stay as they are. Instead the rows that
 * hold a restricting reference are deleted first, in {@link deleteInOrder},
 * and then the user row, whose cascade takes everything else — the ledger,
 * investments, assets, AI conversations, sessions, the audit log and the auth
 * trail. **One transaction: all or nothing.**
 * `tests/integration/account-deletion.test.ts` asserts that no row survives in
 * any table, and fails if a future constraint breaks this order.
 *
 * What remains is one line in the operational log, outside the user tables,
 * with the user id and nothing else: the record that the deletion happened.
 */

import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';

import { db } from '../db/client';
import { users } from '../db/schema';
import { log } from '../log';
import { decryptSecret } from './crypto';
import { recordAuthEvent } from './events';
import { evaluateLock, registerFailure } from './lockout';
import { verifyPassword } from './password';
import { checkAccountLoginRateLimit, checkTotpRateLimit } from './rate-limit';
import type { RequestContext } from './session-store';
import { verifyTotp } from './totp';

/** Typed exactly. Long enough not to be typed by accident, short enough to type. */
export const DELETION_PHRASE = 'DELETE EVERYTHING';

export interface DeletionRequest {
  readonly password: string;
  readonly code: string;
  readonly confirmation: string;
}

export type DeletionResult =
  | { readonly status: 'deleted' }
  | { readonly status: 'confirmation_mismatch' }
  | { readonly status: 'invalid_password' }
  | { readonly status: 'invalid_code' }
  | { readonly status: 'rate_limited'; readonly retryAfterSeconds: number }
  | { readonly status: 'locked'; readonly retryAfterSeconds: number };

export async function deleteAccount(
  userId: string,
  request: DeletionRequest,
  ctx: RequestContext,
): Promise<DeletionResult> {
  // Before any Argon2 work, and before anything is recorded.
  if (request.confirmation.trim() !== DELETION_PHRASE) return { status: 'confirmation_mismatch' };

  for (const verdict of [await checkAccountLoginRateLimit(userId), await checkTotpRateLimit(userId)]) {
    if (!verdict.allowed) return { status: 'rate_limited', retryAfterSeconds: verdict.retryAfterSeconds };
  }

  const [user] = await db()
    .select({
      email: users.email,
      passwordHash: users.passwordHash,
      totpSecretEnc: users.totpSecretEnc,
      totpEnabled: users.totpEnabled,
      lastTotpStep: users.lastTotpStep,
      lockedUntil: users.lockedUntil,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  // The session resolved a moment ago, so a missing row means it was deleted
  // concurrently. Nothing is left to delete.
  if (!user) return { status: 'deleted' };

  const lock = evaluateLock(user.lockedUntil);
  if (lock.locked) return { status: 'locked', retryAfterSeconds: lock.retryAfterSeconds };

  if (!(await verifyPassword(user.passwordHash, request.password))) {
    await registerFailure(userId);
    await recordAuthEvent('login_failure', userId, ctx);
    return { status: 'invalid_password' };
  }

  if (!user.totpEnabled || !user.totpSecretEnc) return { status: 'invalid_code' };
  const totp = verifyTotp(decryptSecret(user.totpSecretEnc), user.email, request.code, user.lastTotpStep);
  if (!totp.ok) {
    await registerFailure(userId);
    await recordAuthEvent('totp_failure', userId, ctx);
    return { status: 'invalid_code' };
  }

  // Claim the code atomically, before deleting. `verifyTotp` compared it with
  // the step read at the top; a sign-in may have used the same code while the
  // password was being hashed. The update succeeds only if the stored step is
  // still older, so a code is spent exactly once — and one seen during a
  // deletion that then fails cannot be replayed either.
  const claimed = await db()
    .update(users)
    .set({ lastTotpStep: totp.step })
    .where(and(eq(users.id, userId), or(isNull(users.lastTotpStep), lt(users.lastTotpStep, totp.step))))
    .returning({ id: users.id });
  if (claimed.length === 0) {
    await registerFailure(userId);
    await recordAuthEvent('totp_failure', userId, ctx);
    return { status: 'invalid_code' };
  }

  await deleteInOrder(userId);

  // The terminal record. The user id only: no email, nothing about what was held.
  log.info('account deleted', { userId });
  return { status: 'deleted' };
}

/**
 * Every row the user owns, in an order no `RESTRICT` key can refuse.
 *
 * 1. `transactions` — their entries and tags cascade; a recurring occurrence
 *    keeps its row and loses the link (`SET NULL`).
 * 2. `investment_transactions` — tax lots and disposals cascade; a corporate
 *    action detection loses its link.
 * 3. `liabilities` — balances cascade; the link to an account goes with it.
 * 4. `categories`, leaves first, because a child restricts its parent and a
 *    hierarchy has no fixed depth.
 * 5. `users` — cascades to every remaining user-owned table.
 */
async function deleteInOrder(userId: string): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.execute(sql`delete from transactions where user_id = ${userId}`);
    await tx.execute(sql`delete from investment_transactions where user_id = ${userId}`);
    await tx.execute(sql`delete from liabilities where user_id = ${userId}`);

    for (;;) {
      const leaves = await tx.execute(sql`
        delete from categories c
         where c.user_id = ${userId}
           and not exists (select 1 from categories child where child.parent_id = c.id)
      `);
      if ((leaves.rowCount ?? 0) === 0) break;
    }

    await tx.execute(sql`delete from ${users} where id = ${userId}`);
  });
}
