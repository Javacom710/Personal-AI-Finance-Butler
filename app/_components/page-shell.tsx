/**
 * Shared page furniture.
 *
 * Every area page uses these, so heading level, spacing and empty-state voice
 * stay identical across the six areas without each page re-deciding them
 * (ARCHITECTURE.md §8: consistent typography, spacing, hierarchy).
 */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-sm text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * The empty state carries real information: what this area will hold, and which
 * phase builds it. During construction that is the honest thing to show — a
 * fake chart with placeholder numbers in a financial application is worse than
 * an empty screen.
 */
export function EmptyState({
  title,
  children,
  arriving,
}: {
  title: string;
  children: React.ReactNode;
  arriving?: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border-strong bg-surface-sunken px-6 py-10 text-center">
      <h2 className="text-sm font-medium text-ink">{title}</h2>
      <div className="mx-auto mt-2 max-w-prose text-sm text-ink-muted">{children}</div>
      {arriving ? (
        <p className="mt-4 inline-block rounded-full border border-border bg-surface px-3 py-1 text-xs text-ink-faint">
          {arriving}
        </p>
      ) : null}
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{title}</h2>
      {children}
    </section>
  );
}
