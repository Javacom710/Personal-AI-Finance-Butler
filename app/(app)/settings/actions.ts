'use server';

import { redirect } from 'next/navigation';

import { deleteAccount } from '@/server/auth/account-deletion';
import { requireSession } from '@/server/auth/guards';
import { clearSessionCookie, requestContext } from '@/server/auth/session-cookie';
import type { DeletionFormState } from './form-state';

function minutes(seconds: number): string {
  const m = Math.max(1, Math.ceil(seconds / 60));
  return m === 1 ? '1 minute' : `${m} minutes`;
}

function text(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.slice(0, 200) : '';
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
      password: text(formData.get('password')),
      code: text(formData.get('code')),
      confirmation: text(formData.get('confirmation')),
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
