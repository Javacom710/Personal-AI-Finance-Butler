/**
 * Stand-in for the `server-only` marker package under the test runner.
 *
 * That package's real entry point throws unless the `react-server` export
 * condition is active, which it is inside Next and is not inside Vitest. The
 * marker exists to make a *client bundle* fail at build time; it protects
 * nothing at test time, so replacing it here removes an artificial failure
 * without weakening the guarantee. The guarantee itself is verified by
 * `npm run check:no-client-secrets`, which scans the built client output.
 */
export {};
