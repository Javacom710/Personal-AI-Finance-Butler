'use server';

import { redirect } from 'next/navigation';

import { loginSchema, secondFactorSchema } from '@/lib/schemas/auth';
import { clearChallengeCookie, readChallenge, setChallengeCookie } from '@/server/auth/challenge';
import { safeReturnTo } from '@/server/auth/guards';
import { verifyPasswordStep, verifySecondFactorStep } from '@/server/auth/login';
import { requestContext, setSessionCookie } from '@/server/auth/session-cookie';
import type { FormState } from './form-state';

/**
 * Deliberately identical wording for a wrong address and a wrong password.
 * Distinguishing them tells an attacker which half to keep guessing.
 */
const GENERIC_FAILURE = 'Email or password is incorrect.';

function minutes(seconds: number): string {
  const m = Math.max(1, Math.ceil(seconds / 60));
  return m === 1 ? '1 minute' : `${m} minutes`;
}

export async function passwordStepAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next') ?? undefined,
  });

  if (!parsed.success) {
    return { error: GENERIC_FAILURE };
  }

  const ctx = await requestContext();
  const result = await verifyPasswordStep(parsed.data.email, parsed.data.password, ctx);

  switch (result.status) {
    case 'totp_required':
      await setChallengeCookie(result.userId);
      break;
    case 'invalid_credentials':
      return { error: GENERIC_FAILURE };
    case 'locked':
      return {
        error: `Too many failed attempts. This account is locked for ${minutes(result.retryAfterSeconds)}.`,
      };
    case 'rate_limited':
      return { error: `Too many attempts. Try again in ${minutes(result.retryAfterSeconds)}.` };
    case 'totp_not_configured':
      return {
        error:
          'This account has no second factor configured and cannot sign in. Re-provision it with npm run auth:create-user.',
      };
  }

  // Outside the switch: `redirect` throws a control-flow signal, and throwing
  // from inside a `case` that a future edit wraps in a try/catch would silently
  // swallow the navigation.
  const next = safeReturnTo(parsed.data.next);
  redirect(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
}

export async function secondFactorAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const challenge = await readChallenge();
  if (!challenge) {
    return { error: 'That sign-in attempt expired. Start again.' };
  }

  const parsed = secondFactorSchema.safeParse({
    code: formData.get('code'),
    next: formData.get('next') ?? undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Enter your verification code.' };
  }

  const ctx = await requestContext();
  const result = await verifySecondFactorStep(challenge.userId, parsed.data.code, ctx);

  switch (result.status) {
    case 'ok':
      await setSessionCookie(result.session);
      await clearChallengeCookie();
      break;
    case 'invalid':
      return { error: 'That code is not valid.' };
    case 'replayed':
      return { error: 'That code has already been used. Wait for the next one.' };
    case 'rate_limited':
      return { error: `Too many attempts. Try again in ${minutes(result.retryAfterSeconds)}.` };
    case 'locked':
      return { error: `This account is locked for ${minutes(result.retryAfterSeconds)}.` };
  }

  redirect(safeReturnTo(parsed.data.next) ?? '/');
}

export async function abandonChallengeAction(): Promise<void> {
  await clearChallengeCookie();
  redirect('/login');
}
