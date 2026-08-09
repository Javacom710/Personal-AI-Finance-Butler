import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // The database driver and argon2 native binding must never be bundled for the
  // browser. They are server-only by construction (`import 'server-only'`), but
  // this makes a mistake a build failure rather than a runtime surprise.
  serverExternalPackages: ['pg', '@node-rs/argon2'],

  // Stack traces never reach the browser in production (ARCHITECTURE.md §7).
  productionBrowserSourceMaps: false,

  // Do not advertise the framework.
  poweredByHeader: false,

  typescript: {
    // A type error must fail the build. Never set this to true.
    ignoreBuildErrors: false,
  },
  // Next 16 no longer runs ESLint during `next build`; linting is its own CI
  // step (TESTING.md §10).
};

export default nextConfig;
