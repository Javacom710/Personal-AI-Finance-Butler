'use client';

/**
 * Errors inside the signed-in shell. Rendered within the app layout, so the
 * navigation stays and the user can leave the failed page without reloading.
 */

import { ErrorPanel } from '../_components/error-panel';

export default function AppErrorBoundary(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="max-w-md py-6">
      <ErrorPanel {...props} />
    </div>
  );
}
