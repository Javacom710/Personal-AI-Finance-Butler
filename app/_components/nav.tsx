'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Primary navigation — six areas, and no more (ARCHITECTURE.md §1).
 *
 * Sidebar from `md` upward, a bottom bar below it. The same list drives both,
 * so a seventh item cannot appear on one and not the other.
 *
 * Icons are inline SVG rather than an icon package: six glyphs do not justify a
 * dependency, and inline paths cost no extra request under a CSP that forbids
 * external sources.
 */

interface NavItem {
  readonly href: string;
  readonly label: string;
  /** Shortened for the bottom bar, where horizontal room is scarce. */
  readonly short: string;
  readonly path: string;
}

const ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Overview', short: 'Overview', path: 'M3 11.5 12 4l9 7.5M6 10v10h12V10' },
  { href: '/money', label: 'Money', short: 'Money', path: 'M3 7h18v10H3zM3 11h18M7 15h3' },
  {
    href: '/investments',
    label: 'Investments',
    short: 'Invest',
    path: 'M4 19h16M6 16V9m5 7V5m5 11v-4',
  },
  {
    href: '/net-worth',
    label: 'Net Worth',
    short: 'Worth',
    path: 'M4 18 9 12l4 3 7-8M14 7h6v6',
  },
  { href: '/ai', label: 'AI', short: 'AI', path: 'M5 5h14v10H9l-4 4z' },
  {
    href: '/settings',
    label: 'Settings',
    short: 'Settings',
    path: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM4 12h2m12 0h2M12 4v2m0 12v2M6.3 6.3l1.4 1.4m8.6 8.6 1.4 1.4m0-11.4-1.4 1.4M7.7 16.3l-1.4 1.4',
  },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Glyph({ path }: { path: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5 shrink-0"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="flex flex-col gap-0.5 p-2">
      {ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={[
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              active
                ? 'bg-surface-raised font-medium text-ink'
                : 'text-ink-muted hover:bg-surface-raised hover:text-ink',
            ].join(' ')}
          >
            <Glyph path={item.path} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-6 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={[
              'flex flex-col items-center gap-1 py-2 text-[0.625rem] transition-colors',
              active ? 'text-accent' : 'text-ink-muted',
            ].join(' ')}
          >
            <Glyph path={item.path} />
            <span>{item.short}</span>
          </Link>
        );
      })}
    </nav>
  );
}
