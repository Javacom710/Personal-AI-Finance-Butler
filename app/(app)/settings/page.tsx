import type { Metadata } from 'next';

import { EmptyState, PageHeader, Section } from '../../_components/page-shell';
import { requireSession } from '@/server/auth/guards';
import { listActiveSessions } from '@/server/auth/session-store';
import { recentEventsForUser } from '@/server/auth/events';

export const metadata: Metadata = { title: 'Settings' };

const EVENT_LABEL: Record<string, string> = {
  login_success: 'Signed in',
  login_failure: 'Failed sign-in',
  totp_failure: 'Failed second factor',
  logout: 'Signed out',
  password_change: 'Password changed',
  lockout: 'Account locked',
  session_revoked: 'Session revoked',
};

function when(value: Date): string {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(value);
}

export default async function SettingsPage() {
  const session = await requireSession('/settings');

  // Both of these exist today because authentication exists today. The rest of
  // Settings arrives with the features it configures.
  const [active, events] = await Promise.all([
    listActiveSessions(session.userId, session.sessionId),
    recentEventsForUser(session.userId, 10),
  ]);

  return (
    <>
      <PageHeader title="Settings" description="Security, preferences, and your data." />

      <Section title="Account">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-ink-muted">Email</dt>
          <dd>{session.email}</dd>
          <dt className="text-ink-muted">Second factor</dt>
          <dd>Enabled — required at every sign-in</dd>
        </dl>
      </Section>

      <Section title="Active sessions">
        <ul className="divide-y divide-border rounded-lg border border-border">
          {active.map((s) => (
            <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="truncate">
                  {s.userAgent ?? 'Unknown client'}
                  {s.isCurrent ? (
                    <span className="ml-2 rounded-full border border-border bg-surface-raised px-2 py-0.5 text-xs text-ink-muted">
                      this device
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-ink-faint">
                  {s.ip ?? 'no address'} · last seen {when(s.lastSeenAt)}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <p className="text-xs text-ink-faint">
          Revoking an individual session, changing your password, and exporting or deleting your data
          arrive with the Settings work in Phase 10.
        </p>
      </Section>

      <Section title="Recent security activity">
        <ul className="divide-y divide-border rounded-lg border border-border">
          {events.map((e, i) => (
            <li key={`${e.createdAt.toISOString()}-${i}`} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-sm">
              <span>{EVENT_LABEL[e.kind] ?? e.kind}</span>
              <span className="text-xs text-ink-faint">
                {e.ip ?? 'no address'} · {when(e.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Everything else">
        <EmptyState title="Preferences, providers and data" arriving="Phases 3, 6, 7 and 10">
          <p>
            Base currency, locale, timezone and fiscal year exist as settings from day one and are
            editable once the screens that read them exist. Market-data providers arrive in Phase 6,
            AI configuration and its daily budget in Phase 7, and export, backup status and complete
            deletion in Phase 10.
          </p>
        </EmptyState>
      </Section>
    </>
  );
}
