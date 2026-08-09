import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { readChallenge } from '@/server/auth/challenge';
import { optionalSession, safeReturnTo } from '@/server/auth/guards';
import { PasswordForm, SecondFactorForm } from './_forms';

export const metadata: Metadata = { title: 'Sign in' };

/**
 * Which step to show is decided by the **challenge cookie**, not by a query
 * parameter — the cookie is the only evidence the password step was actually
 * completed, and a URL is user-editable.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await optionalSession();
  const params = await searchParams;
  const nextParam = typeof params['next'] === 'string' ? params['next'] : null;
  const next = safeReturnTo(nextParam);

  if (session) redirect(next ?? '/');

  const challenge = await readChallenge();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 px-6 py-12">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight">Finance OS</h1>
        <p className="text-sm text-ink-muted">
          {challenge ? 'Enter your second factor to finish signing in.' : 'Sign in to continue.'}
        </p>
      </div>

      {challenge ? <SecondFactorForm next={next} /> : <PasswordForm next={next} />}

      <p className="text-xs text-ink-faint">
        This is a private, single-user application. There is no sign-up, and no way to skip the
        second factor.
      </p>
    </main>
  );
}
