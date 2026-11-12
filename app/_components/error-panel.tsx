'use client';

/**
 * What an error boundary shows (ARCHITECTURE.md §7): a correlation ID and
 * nothing else. Stack traces stay on the server — in a financial application an
 * error message can carry an account name, an amount, or a query fragment, and
 * none of that belongs on a screen someone might screenshot.
 *
 * `digest` is the identifier Next attaches to a server error and writes to the
 * server log, so quoting it is enough to find the full trace.
 */

import { useEffect } from 'react';

export function ErrorPanel({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Client-side errors never reach the server logger otherwise.
    console.error('render error', { digest: error.digest });
  }, [error]);

  return (
    <div role="alert" className="space-y-4">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="text-sm text-ink-muted">The action could not be completed. Nothing was changed.</p>
      {error.digest ? (
        <p className="text-sm text-ink-muted">
          Reference <span className="tabular text-ink">{error.digest}</span> — quote this if you need
          to look it up in the server log.
        </p>
      ) : null}
      <div>
        <button
          type="button"
          onClick={reset}
          className="rounded-md border border-border-strong px-3 py-2 text-sm font-medium hover:bg-surface-raised"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
