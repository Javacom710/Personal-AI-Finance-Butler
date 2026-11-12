import { beforeEach, expect, it, vi } from 'vitest';

/**
 * The Settings deletion action passes the form through to `deleteAccount`
 * without altering it. A truncated password would fail against the stored hash
 * however correct the typed one was, and each attempt would count toward the
 * lockout — so an over-long field is refused, never cut short.
 */

const mocks = vi.hoisted(() => ({ deleteAccount: vi.fn(), clearSessionCookie: vi.fn(), redirect: vi.fn() }));

vi.mock('@/server/auth/account-deletion', () => ({ deleteAccount: mocks.deleteAccount }));
vi.mock('@/server/auth/guards', () => ({ requireSession: async () => ({ userId: 'user-1' }) }));
vi.mock('@/server/auth/session-cookie', () => ({
  clearSessionCookie: mocks.clearSessionCookie,
  requestContext: async () => ({ ip: null, userAgent: null }),
}));
vi.mock('@/server/auth/password', () => ({ MAX_PASSWORD_LENGTH: 1024 }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

import { deleteEverythingAction } from '@app/(app)/settings/actions';

function form(password: string): FormData {
  const data = new FormData();
  data.set('password', password);
  data.set('code', '123456');
  data.set('confirmation', 'DELETE EVERYTHING');
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.deleteAccount.mockResolvedValue({ status: 'invalid_password' });
});

it('passes a long password through whole, up to the policy maximum', async () => {
  const password = 'p'.repeat(1024);
  await deleteEverythingAction({ error: null }, form(password));
  expect(mocks.deleteAccount.mock.calls[0]![1].password).toBe(password);
});

it('refuses a password beyond the maximum rather than truncating it', async () => {
  await deleteEverythingAction({ error: null }, form('p'.repeat(1025)));
  expect(mocks.deleteAccount.mock.calls[0]![1].password).toBe('');
});

it('clears the cookie and redirects only on success', async () => {
  const failed = await deleteEverythingAction({ error: null }, form('right-length'));
  expect(failed.error).toMatch(/Nothing was deleted/);
  expect(mocks.clearSessionCookie).not.toHaveBeenCalled();

  mocks.deleteAccount.mockResolvedValue({ status: 'deleted' });
  await deleteEverythingAction({ error: null }, form('right-length'));
  expect(mocks.clearSessionCookie).toHaveBeenCalledOnce();
  expect(mocks.redirect).toHaveBeenCalledWith('/login?deleted=1');
});
