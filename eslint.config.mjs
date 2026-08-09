import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/**
 * Layer boundaries from ARCHITECTURE.md §2 are enforced here, not merely
 * documented. Each `no-restricted-imports` zone below corresponds to one
 * bullet in the "Rules" list of that section.
 *
 * Phases 3+ add `domain/`, `services/`, and `ai/`. The rules are written now so
 * that the first file placed in one of those directories is already governed.
 */

/** @type {import('eslint').Linter.Config[]} */
const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'src/server/db/migrations/**',
      'next-env.d.ts',
    ],
  },

  ...nextCoreWebVitals,
  ...nextTypescript,

  // ---------------------------------------------------------------- global
  {
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      // SECURITY.md §5 — output encoding is React's default escaping.
      'react/no-danger': 'error',

      // ADR-04 — floats must never carry money. parseFloat is how they get in.
      'no-restricted-globals': [
        'error',
        { name: 'parseFloat', message: 'ADR-04: money is bigint. Use Money.parseUserInput.' },
      ],

      // SECURITY.md §3 — a NEXT_PUBLIC_ variable whose name looks like a secret
      // is a secret in the client bundle. scripts/check-no-client-secrets.ts
      // checks the built output; this catches it at authoring time.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env'][property.name=/^NEXT_PUBLIC_.*(KEY|SECRET|TOKEN|PASSWORD|DSN)/i]",
          message:
            'SECURITY.md §3: a NEXT_PUBLIC_ variable must never name a credential — it ships to the browser.',
        },
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env'][property.name!=/^NODE_ENV$/]",
          message:
            'Read environment through src/lib/env.ts, which validates it with Zod and fails fast (SECURITY.md §3).',
        },
      ],
    },
  },

  // ------------------------------------------------- presentation boundary
  // app/** calls application services only. It never reaches past them into
  // the engine or the database.
  {
    files: ['app/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/server/db', '@/server/db/*', '**/server/db/*'],
              message:
                'ARCHITECTURE.md §2: app/** must not import the database layer. Call an application service.',
            },
            {
              group: ['@/server/domain', '@/server/domain/*', '**/server/domain/*'],
              message:
                'ARCHITECTURE.md §2: app/** must not import the financial engine. Call an application service.',
            },
          ],
        },
      ],
    },
  },

  // ------------------------------------------------------- engine boundary
  // The engine is pure: data in, values out. It holds no database handle, so
  // it cannot mutate even by accident.
  {
    files: ['src/server/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/server/db',
                '@/server/db/*',
                '@/server/services',
                '@/server/services/*',
                '@/server/ai',
                '@/server/ai/*',
                'server-only',
                '**/server/db/*',
                '**/server/services/*',
              ],
              message:
                'ARCHITECTURE.md §2: the financial engine is pure — no I/O, no database handle, no service imports.',
            },
            {
              group: ['pg', 'drizzle-orm', 'drizzle-orm/*', 'next/*'],
              message:
                'ARCHITECTURE.md §2: the financial engine takes data as arguments; it never queries or renders.',
            },
          ],
        },
      ],
    },
  },

  // ----------------------------------------------------------- AI boundary
  // The AI layer reads through application services. It has no path to the
  // database and no path to the engine.
  {
    files: ['src/server/ai/**/*.ts'],
    ignores: ['src/server/ai/provider/nvidia-build.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/server/db', '@/server/db/*', '@/server/domain', '@/server/domain/*'],
              message:
                'ARCHITECTURE.md §2: src/server/ai/** has no write path and no direct read path. Go through an application service.',
            },
            {
              group: ['openai'],
              message:
                'ARCHITECTURE.md §2: only src/server/ai/provider/nvidia-build.ts may import the wire client.',
            },
          ],
        },
      ],
    },
  },

  // ---------------------------------------------------------------- tests
  {
    files: ['tests/**/*.ts', 'scripts/**/*.ts', '*.config.{ts,mts,mjs}'],
    rules: {
      'no-console': 'off',
      'no-restricted-syntax': 'off',
      'no-restricted-imports': 'off',
    },
  },
];

export default config;
