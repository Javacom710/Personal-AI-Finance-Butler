import { signOutAction } from './actions';

/**
 * A plain form posting to a server action — no client JavaScript, which means
 * it also works with scripting unavailable and needs no nonce.
 */
export function SignOutButton({ compact = false }: { compact?: boolean }) {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className={
          compact
            ? 'rounded-md border border-border px-2 py-1 text-xs text-ink-muted hover:bg-surface-raised hover:text-ink'
            : 'w-full rounded-md border border-border px-3 py-1.5 text-xs text-ink-muted hover:bg-surface-raised hover:text-ink'
        }
      >
        Sign out
      </button>
    </form>
  );
}
