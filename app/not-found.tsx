import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6">
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="text-sm text-ink-muted">That page does not exist.</p>
      <Link href="/" className="text-sm font-medium text-accent underline underline-offset-4">
        Back to overview
      </Link>
    </main>
  );
}
