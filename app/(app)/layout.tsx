import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { LOGIN_PATH, optionalSession, safeReturnTo } from '@/server/auth/guards';
import { BottomNav, SidebarNav } from '../_components/nav';
import { SignOutButton } from './_sign-out';

/**
 * The authenticated shell.
 *
 * `optionalSession` is checked here and every unauthenticated request is sent
 * to login, so no route in this segment renders without a session
 * (SECURITY.md §2). Individual route handlers and server actions still call
 * `requireSession` themselves — a layout guard covers rendering, not every way
 * into the segment, and "the layout checked" is not something a server action
 * can rely on.
 *
 * Authorization is a different question and is not answered here (SECURITY.md
 * §0): it belongs to the application services that arrive in Phase 3.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await optionalSession();

  if (!session) {
    // `x-pathname` is set by proxy.ts; a layout has no other way to know the
    // path it is rendering. Still passed through `safeReturnTo` — the header is
    // ours, but validating at the point of use costs nothing and survives a
    // future change to where the value comes from.
    const target = safeReturnTo((await headers()).get('x-pathname'));
    redirect(target ? `${LOGIN_PATH}?next=${encodeURIComponent(target)}` : LOGIN_PATH);
  }

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-border bg-surface-sunken md:flex">
        <div className="flex items-center gap-2 px-5 py-4">
          <span className="text-sm font-semibold tracking-tight">Finance OS</span>
        </div>

        <SidebarNav />

        <div className="mt-auto space-y-2 border-t border-border p-4">
          <p className="truncate text-xs text-ink-faint" title={session.email}>
            {session.email}
          </p>
          <SignOutButton />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 md:hidden">
          <span className="text-sm font-semibold tracking-tight">Finance OS</span>
          <SignOutButton compact />
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-6 pb-24 md:px-8 md:pb-10">
          {children}
        </main>
      </div>

      <BottomNav />
    </div>
  );
}
