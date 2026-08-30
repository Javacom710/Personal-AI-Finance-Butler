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

      // Claude Code's git worktrees are *complete copies of this repository*
      // nested inside it. `eslint .` walks them — flat config does not skip
      // dot-directories, and it does not read `.gitignore` — so the root lint
      // reported every file of every worktree, several times over, with each
      // copy's findings indistinguishable from the real tree's.
      //
      // Ignoring the directory rather than the file types is deliberate: the
      // copies are not source, and nothing under here should ever be linted
      // from the root. Each worktree still lints its own tree correctly,
      // because from inside one this path does not exist.
      '.claude/**',
    ],
  },

  ...nextCoreWebVitals,
  ...nextTypescript,

  // ---------------------------------------------------------------- global
  {
    // Scoped to source files, matching `eslint-config-next`'s own glob.
    //
    // Not cosmetic: since eslint-config-next 16.3.0 the config object that
    // declares the `react`, `import` and `jsx-a11y` plugins carries this same
    // `files` restriction. An unscoped rules object therefore referenced
    // `react/no-danger` for file types where the plugin was out of scope, and
    // ESLint refused to load the configuration at all — `npm run lint` failed
    // before linting a single file. The rules below only ever applied to source
    // files anyway; saying so is what makes them loadable.
    files: ['**/*.{js,jsx,mjs,ts,tsx,mts,cts}'],
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
  // The AI layer reads through ONE read-only capability, `@/server/ai-read`.
  // It has no path to the database, no path to the engine, and no path to the
  // application services — including the write helpers they re-export.
  //
  // The patterns below are written against `no-restricted-imports`' actual
  // matcher, which is the `ignore` package applied to the **raw specifier
  // string** with gitignore semantics — not minimatch, and never a resolved
  // path. The Phase 7 review's finding **F-2** was that the previous rule
  // listed only `@/`-aliased forms, so `import { db } from '../../db/client'`
  // linted clean and handed AI code the full database handle.
  //
  // Two consequences of that matcher shape drive the list:
  //   - a "directory" pattern already covers its descendants, so `@/server/db`
  //     alone blocks `@/server/db/schema/index`; the old `@/server/db/*` twin
  //     was redundant;
  //   - `**/server/db/*` does NOT catch `../../db/client`, because the pattern
  //     still requires a literal `server` segment the specifier does not have.
  //     Dropping `server/` from the relative forms is what closes it.
  //
  // ESLint alone cannot be the whole answer: this rule has no `ImportExpression`
  // listener, so a dynamic `await import('@/server/db/client')` is not checked
  // in any zone. `tests/unit/ai-boundary-source-scan.test.ts` is the second
  // mechanism and does check it, and the capability types are the third
  // (ADR-33, ADR-34).
  {
    files: ['src/server/ai/**/*.ts'],
    ignores: ['src/server/ai/provider/nvidia-build.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                // Aliased.
                '@/server/db',
                '@/server/domain',
                '@/server/services',
                '@/server/ai-read/internal',
                // Relative, at any depth. No `server/` segment: a specifier
                // climbing out of `src/server/ai/` does not contain one.
                '**/db',
                '**/db/*',
                '**/domain',
                '**/domain/*',
                '**/services',
                '**/services/*',
                '**/ai-read/internal',
              ],
              message:
                'ARCHITECTURE.md §2 / ADR-34: src/server/ai/** reads only through the @/server/ai-read capability. It has no database handle, no engine access, and no path to a write context.',
            },
            {
              group: ['drizzle-orm', 'drizzle-orm/*', 'pg'],
              message:
                'ADR-34: src/server/ai/** issues no SQL. A query belongs in an application service, behind the @/server/ai-read projection.',
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
