import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Finance OS',
    template: '%s · Finance OS',
  },
  description: 'Private personal finance and investment management.',
  // A private financial application has no business being indexed, and no
  // business being installed as anything but a plain page.
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-surface text-ink antialiased">{children}</body>
    </html>
  );
}
