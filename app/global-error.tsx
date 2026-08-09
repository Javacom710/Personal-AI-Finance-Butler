'use client';

/**
 * The last-resort boundary: an error thrown by the root layout itself, where
 * the normal error boundary has no shell to render into. It must therefore
 * supply its own `html` and `body`, and it cannot rely on the stylesheet having
 * loaded — hence the inline style attributes, which are the one place in the
 * codebase they are justified.
 */

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          margin: 0,
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          padding: '1.5rem',
        }}
      >
        <main style={{ maxWidth: '28rem' }}>
          <h1 style={{ fontSize: '1.125rem', margin: '0 0 0.75rem' }}>Application error</h1>
          <p style={{ margin: '0 0 0.75rem', lineHeight: 1.5 }}>
            The application failed to start rendering. Your data has not been changed.
          </p>
          {error.digest ? (
            <p style={{ margin: 0, lineHeight: 1.5 }}>
              Reference <code>{error.digest}</code>
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
