/**
 * Shown inside the app shell while a page's data loads, so navigation responds
 * at once and the layout does not jump when the page arrives. Neutral blocks
 * only: a placeholder figure in a financial application could be read as a
 * real one. The pulse is off when the user prefers reduced motion.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-6">
      <span className="sr-only">Loading…</span>
      <div aria-hidden="true" className="space-y-2 border-b border-border pb-4">
        <div className="h-6 w-40 rounded bg-surface-sunken motion-safe:animate-pulse" />
        <div className="h-4 w-64 max-w-full rounded bg-surface-sunken motion-safe:animate-pulse" />
      </div>
      <div aria-hidden="true" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-lg bg-surface-sunken motion-safe:animate-pulse" />
        ))}
      </div>
      <div aria-hidden="true" className="h-64 rounded-lg bg-surface-sunken motion-safe:animate-pulse" />
    </div>
  );
}
