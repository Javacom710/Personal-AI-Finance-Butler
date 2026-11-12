import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';

import { ErrorPanel } from '@app/_components/error-panel';
import AppErrorBoundary from '@app/(app)/error';
import Loading from '@app/(app)/loading';

/** Phase 10: loading and error states inside the signed-in shell (ARCHITECTURE.md §7–8). */

const sensitive = Object.assign(new Error('HDFC Savings balance 412022.37 failed for account 50100xxxx'), {
  digest: 'abc123digest',
});

it('shows a reference, never the error message, which can carry financial detail', () => {
  const html = renderToStaticMarkup(createElement(ErrorPanel, { error: sensitive, reset: () => {} }));
  expect(html).toContain('abc123digest');
  expect(html).toContain('Nothing was changed');
  expect(html).not.toMatch(/HDFC|412022|50100/);
  expect(html).toContain('role="alert"');
});

it('renders the in-shell boundary with the same panel and a retry control', () => {
  const html = renderToStaticMarkup(createElement(AppErrorBoundary, { error: sensitive, reset: () => {} }));
  expect(html).toContain('Try again');
  expect(html).not.toMatch(/HDFC|412022/);
});

it('announces loading to assistive technology and shows no placeholder figures', () => {
  const html = renderToStaticMarkup(createElement(Loading));
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain('Loading…');
  expect(html).not.toMatch(/[₹$]|\d{3,}/);
  expect(html).toContain('motion-safe:animate-pulse');
});
