'use server';

import { redirect } from 'next/navigation';

import { deleteAccount } from '@/server/auth/account-deletion';
import { requireSession } from '@/server/auth/guards';
import { MAX_PASSWORD_LENGTH } from '@/server/auth/password';
import { clearSessionCookie, requestContext } from '@/server/auth/session-cookie';
import type { DeletionFormState } from './form-state';

function minutes(seconds: number): string {
  const m = Math.max(1, Math.ceil(seconds / 60));
  return m === 1 ? '1 minute' : `${m} minutes`;
}

/**
 * A form field, bounded. An over-long value is **refused, not truncated**: a
 * truncated password would fail against the stored hash however correct the
 * typed one was. The bound on the password is the policy's own maximum.
 */
function field(value: FormDataEntryValue | null, max: number): string {
  return typeof value === 'string' && value.length <= max ? value : '';
}

/**
 * Settings → Data → Delete everything. The checks themselves live in
 * `src/server/auth/account-deletion.ts`; this only reads the form, reports the
 * outcome, and on success clears the cookie of a session that no longer exists.
 */
export async function deleteEverythingAction(_prev: DeletionFormState, formData: FormData): Promise<DeletionFormState> {
  const session = await requireSession('/settings');
  const result = await deleteAccount(
    session.userId,
    {
      password: field(formData.get('password'), MAX_PASSWORD_LENGTH),
      code: field(formData.get('code'), 20),
      confirmation: field(formData.get('confirmation'), 100),
    },
    await requestContext(),
  );

  switch (result.status) {
    case 'confirmation_mismatch':
      return { error: 'Type the phrase exactly as shown, in capitals.' };
    case 'invalid_password':
      return { error: 'That password is incorrect. Nothing was deleted.' };
    case 'invalid_code':
      return { error: 'That code is incorrect or already used. Wait for a new one. Nothing was deleted.' };
    case 'locked':
      return { error: `Too many failed attempts. Locked for ${minutes(result.retryAfterSeconds)}. Nothing was deleted.` };
    case 'rate_limited':
      return { error: `Too many attempts. Try again in ${minutes(result.retryAfterSeconds)}. Nothing was deleted.` };
    case 'deleted':
      break;
  }

  await clearSessionCookie();
  // Outside the switch, as in the login actions: `redirect` throws.
  redirect('/login?deleted=1');
}
