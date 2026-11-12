'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { deleteEverythingAction } from './actions';
import { EMPTY_DELETION_STATE } from './form-state';

const FIELD =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent';
const LABEL = 'block text-xs font-medium text-ink-muted';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md border border-negative px-3 py-1.5 text-sm font-medium text-negative disabled:opacity-60"
    >
      {pending ? 'Deleting…' : 'Delete everything permanently'}
    </button>
  );
}

/**
 * Collapsed by default, so the destructive form is never one stray tap away.
 * Every field is required; the server checks them again regardless.
 */
export function DeleteEverythingForm({ phrase }: { phrase: string }) {
  const [state, action] = useActionState(deleteEverythingAction, EMPTY_DELETION_STATE);

  return (
    <details className="rounded-lg border border-negative/40 px-4 py-3 text-sm" open={state.error !== null}>
      <summary className="cursor-pointer font-medium text-negative">Delete everything</summary>
      <form action={action} className="mt-3 space-y-3">
        <p className="text-ink-muted">
          Permanently deletes this account and every record in it: accounts, transactions, budgets,
          investments, assets, liabilities, AI conversations, the audit log and all sessions. It cannot
          be undone. Export your data first if you want a copy.
        </p>
        {state.error ? (
          <p role="alert" className="rounded-md border border-negative/40 bg-negative/10 px-3 py-2 text-negative">
            {state.error}
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label htmlFor="delete-password" className={LABEL}>Password</label>
            <input id="delete-password" name="password" type="password" autoComplete="current-password" required className={FIELD} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="delete-code" className={LABEL}>Authenticator code</label>
            <input id="delete-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required className={`${FIELD} tabular`} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="delete-confirmation" className={LABEL}>
              Type <span className="font-mono text-ink">{phrase}</span>
            </label>
            <input id="delete-confirmation" name="confirmation" autoComplete="off" spellCheck={false} required className={FIELD} />
          </div>
        </div>
        <Submit />
      </form>
    </details>
  );
}
