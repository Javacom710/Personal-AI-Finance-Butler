import type { Metadata } from 'next';

import { EmptyState, PageHeader } from '../../_components/page-shell';
import { requireSession } from '@/server/auth/guards';

export const metadata: Metadata = { title: 'AI' };

export default async function AiPage() {
  await requireSession('/ai');

  return (
    <>
      <PageHeader
        title="AI"
        description="Ask about your finances, and record transactions in plain language."
      />

      <EmptyState title="Not connected" arriving="Phases 7–9 — AI infrastructure, evaluation, features">
        <p>
          The assistant reads through a restricted set of tools that call the same application
          services the interface does, so it is subject to the same authorization. It has no write
          path: model output becomes a proposal you confirm, and the confirmation runs the ordinary
          code path with the ordinary validation.
        </p>
        <p className="mt-3">
          Turning AI off in Settings removes every byte of egress and leaves every other feature
          working.
        </p>
      </EmptyState>
    </>
  );
}
