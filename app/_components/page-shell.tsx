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

/**
 * Every width class the bar below can use, written out literally.
 *
 * **A `style={{ width }}` attribute does not work in this application.** The CSP
 * in `proxy.ts` sets `style-src 'self' 'nonce-…'`, and an inline style attribute
 * falls back to that directive — so the browser blocks it and the bar renders at
 * zero width with a console violation, silently, in production. Tailwind needs
 * each class to appear in the source to emit it, hence the literal list.
 *
 * The step is 2%, and the bar is decoration: the exact figure is always printed
 * beside it, so a slice of 3.4% shows a bar at 4% and the number as "3.4%".
 */
const BAR_WIDTHS = [
  'w-[0%]', 'w-[2%]', 'w-[4%]', 'w-[6%]', 'w-[8%]', 'w-[10%]',
  'w-[12%]', 'w-[14%]', 'w-[16%]', 'w-[18%]', 'w-[20%]',
  'w-[22%]', 'w-[24%]', 'w-[26%]', 'w-[28%]', 'w-[30%]',
  'w-[32%]', 'w-[34%]', 'w-[36%]', 'w-[38%]', 'w-[40%]',
  'w-[42%]', 'w-[44%]', 'w-[46%]', 'w-[48%]', 'w-[50%]',
  'w-[52%]', 'w-[54%]', 'w-[56%]', 'w-[58%]', 'w-[60%]',
  'w-[62%]', 'w-[64%]', 'w-[66%]', 'w-[68%]', 'w-[70%]',
  'w-[72%]', 'w-[74%]', 'w-[76%]', 'w-[78%]', 'w-[80%]',
  'w-[82%]', 'w-[84%]', 'w-[86%]', 'w-[88%]', 'w-[90%]',
  'w-[92%]', 'w-[94%]', 'w-[96%]', 'w-[98%]', 'w-full',
] as const;

/**
 * A proportion bar — an allocation weight, a budget's utilisation.
 *
 * `fraction` is 0…1 and is clamped, so a budget at 130% fills the bar rather
 * than overflowing its container.
 */
export function ProportionBar({
  fraction,
  label,
  tone = 'accent',
  className = 'w-full',
}: {
  fraction: number;
  /** Announced to a screen reader; the bar itself is `role="img"`. */
  label: string;
  tone?: 'accent' | 'negative';
  className?: string;
}) {
  const clamped = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  const width = BAR_WIDTHS[Math.round(clamped * (BAR_WIDTHS.length - 1))] ?? BAR_WIDTHS[0];

  return (
    <div
      className={`h-1.5 overflow-hidden rounded-full bg-surface-sunken ${className}`}
      role="img"
      aria-label={label}
    >
      <div className={`h-full ${tone === 'negative' ? 'bg-negative' : 'bg-accent'} ${width}`} />
    </div>
  );
}
