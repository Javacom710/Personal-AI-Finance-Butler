import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
  '@app': fileURLToPath(new URL('./app', import.meta.url)),
  // See tests/stubs/server-only.ts for why this is replaced rather than kept.
  'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
};

/**
 * Test layers per TESTING.md §1. Each is its own project so a single layer can
 * be run alone (`npm run test:unit`) and so the integration layer's database
 * setup never slows the unit layer down.
 *
 * `passWithNoTests` is deliberately absent: TESTING.md §10 forbids it.
 */
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/setup/unit-env.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'property',
          include: ['tests/property/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/setup/unit-env.ts'],
          testTimeout: 30_000,
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['tests/setup/integration-global.ts'],
          setupFiles: ['tests/setup/integration-env.ts'],
          testTimeout: 60_000,
          hookTimeout: 60_000,
          // Integration tests share one database; running files in parallel
          // would let one file's truncation delete another file's fixtures.
          fileParallelism: false,
        },
      },
      // Performance against ARCHITECTURE.md §9 on a seeded 5-year history.
      // Opt-in (`BENCH=1 npx vitest run --project bench`): it takes minutes to
      // seed and its timings depend on the machine, so it is not a CI gate.
      ...(process.env['BENCH'] === '1'
        ? [
            {
              resolve: { alias },
              test: {
                name: 'bench',
                include: ['tests/bench/**/*.test.ts'],
                environment: 'node' as const,
                globalSetup: ['tests/setup/integration-global.ts'],
                setupFiles: ['tests/setup/integration-env.ts'],
                testTimeout: 1_800_000,
                hookTimeout: 1_800_000,
                fileParallelism: false,
              },
            },
          ]
        : []),
    ],
  },
});
