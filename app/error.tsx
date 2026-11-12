'use client';

/**
 * The root error boundary. It replaces the whole page, so it is reached only
 * when the error is outside the signed-in shell (login, the root layout);
 * `app/(app)/error.tsx` handles errors inside the shell and keeps navigation.
 */

import { ErrorPanel } from './_components/error-panel';

export default function ErrorBoundary(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <ErrorPanel {...props} />
    </main>
  );
}
