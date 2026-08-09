'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { abandonChallengeAction, passwordStepAction, secondFactorAction } from './actions';
import { EMPTY_STATE, type FormState } from './form-state';

const FIELD =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent';

const LABEL = 'block text-xs font-medium text-ink-muted';

function Submit({ children }: { children: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink disabled:opacity-60"
    >
      {pending ? 'Working…' : children}
    </button>
  );
}

function ErrorNotice({ state }: { state: FormState }) {
  if (!state.error) return null;
  return (
    // `role="alert"` so the message is announced rather than only seen.
    <p role="alert" className="rounded-md border border-negative/40 bg-negative/10 px-3 py-2 text-sm text-negative">
      {state.error}
    </p>
  );
}

export function PasswordForm({ next }: { next: string | null }) {
  const [state, action] = useActionState(passwordStepAction, EMPTY_STATE);

  return (
    <form action={action} className="space-y-4">
      <ErrorNotice state={state} />

      {next ? <input type="hidden" name="next" value={next} /> : null}

      <div className="space-y-1.5">
        <label htmlFor="email" className={LABEL}>
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          className={FIELD}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className={LABEL}>
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={FIELD}
        />
      </div>

      <Submit>Continue</Submit>
    </form>
  );
}

export function SecondFactorForm({ next }: { next: string | null }) {
  const [state, action] = useActionState(secondFactorAction, EMPTY_STATE);

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4">
        <ErrorNotice state={state} />

        {next ? <input type="hidden" name="next" value={next} /> : null}

        <div className="space-y-1.5">
          <label htmlFor="code" className={LABEL}>
            Verification code
          </label>
          <input
            id="code"
            name="code"
            type="text"
            inputMode="text"
            autoComplete="one-time-code"
            required
            autoFocus
            placeholder="000000"
            className={`${FIELD} tabular tracking-[0.3em]`}
          />
          <p className="text-xs text-ink-faint">
            The 6-digit code from your authenticator app, or one of your recovery codes.
          </p>
        </div>

        <Submit>Sign in</Submit>
      </form>

      <form action={abandonChallengeAction}>
        <button type="submit" className="text-xs text-ink-muted underline underline-offset-4">
          Start over
        </button>
      </form>
    </div>
  );
}
