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

/**
 * The AI zone's import ban, shared by every file in it including the wire
 * client (ADR-38). Deny `@/server/**`, re-admit exactly `@/server/ai-read`,
 * then re-deny the bridge inside it; name every sibling directory again in its
 * relative form, because a specifier climbing out of `src/server/ai/` carries
 * no `server` segment for a `**\/server\/...` pattern to match.
 */
const aiZonePatterns = [
  {
    group: [
      // Everything under src/server, then the one re-admission.
      '@/server/**',
      '!@/server/ai-read',
      '@/server/ai-read/internal',
      // The redacting logger is deliberately re-admitted: AI-SYSTEM.md §15 wants
      // Phase 7 to reuse it rather than build a parallel redactor. It exports
      // `redact` and `log` only — it reads LOG_LEVEL but re-exports nothing from
      // the environment. `health.ts` stays closed: it executes SQL.
      '!@/server/log',
      // Relative escapes: every sibling of src/server/ai/, at any depth.
      '**/auth',
      '**/auth/*',
      '**/db',
      '**/db/*',
      '**/domain',
      '**/domain/*',
      '**/jobs',
      '**/jobs/*',
      '**/market-data',
      '**/market-data/*',
      '**/services',
      '**/services/*',
      '**/ai-read/internal',
      '**/health',
      // The presentation layer: `'use server'` actions build a WriteCtx from a
      // session and take a form, so importing one is a write path that no
      // capability check can see.
      '@app/*',
      '**/app/*',
      // The validated environment carries DATABASE_URL, APP_ENCRYPTION_KEY,
      // SESSION_COOKIE_SECRET and every provider credential. Tier lists are
      // *passed into* config/, never read by it (AI-SYSTEM.md §12).
      '@/lib/env',
      '**/lib/env',
    ],
    message:
      'ARCHITECTURE.md §2 / ADR-38: src/server/ai/** may import @/server/ai-read and @/lib/** only. No database, engine, service, job, auth, market-data, server action, or environment access.',
  },
  {
    group: ['drizzle-orm', 'drizzle-orm/*', 'pg'],
    message:
      'ADR-34: src/server/ai/** issues no SQL. A query belongs in an application service, behind the @/server/ai-read projection.',
  },
];

/** Only `nvidia-build.ts` may import the wire client. */
const wireClientPattern = {
  group: ['openai'],
  message:
    'ARCHITECTURE.md §2: only src/server/ai/provider/nvidia-build.ts may import the wire client.',
};

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
  // Everything else under `src/server/` is closed to it, and so are the
  // presentation layer and the validated environment.
  //
  // **An allowlist, not a denylist** ([ADR-38](docs/DECISIONS.md)). The first
  // version of this rule enumerated the modules it knew were dangerous — `db`,
  // `domain`, `services` — which meant every directory nobody had thought of
  // was permitted by default. The adversarial review found seven such routes,
  // and two of them were complete defeats of the write boundary:
  //
  //   - `app/(app)/money/actions.ts` exports `'use server'` actions that take a
  //     form, not a context, and build a `WriteCtx` internally. Calling one
  //     mutates the ledger with the session's own authority, with no write
  //     capability ever passing through AI code;
  //   - `@/server/jobs` exports `enqueue` / `runDueJobs`, whose handlers do the
  //     same thing one level of indirection further away.
  //
  // Denying `@/server/**` and re-admitting exactly `@/server/ai-read` is what
  // makes a *new* directory closed on the day it is created rather than on the
  // day someone remembers to add it here.
  //
  // The patterns are written against `no-restricted-imports`' actual matcher,
  // which is the `ignore` package applied to the **raw specifier string** with
  // gitignore semantics — not minimatch, and never a resolved path. Two
  // consequences drive their shape:
  //   - a "directory" pattern already covers its descendants, and a later
  //     pattern can re-deny inside a negation, which is how `ai-read/internal`
  //     stays closed while `ai-read` opens;
  //   - `**/server/db/*` does NOT catch `../../db/client` — that pattern needs a
  //     literal `server` segment the specifier does not have. A relative
  //     specifier climbing out of `src/server/ai/` never contains one, so every
  //     sibling directory is named again without it.
  //
  // ESLint cannot be the whole answer: this rule has no `ImportExpression`
  // listener, so `await import('@/server/db/client')` is unchecked in every
  // zone. `tests/unit/ai-boundary-source-scan.test.ts` is the second mechanism
  // and does check it; the capability types are the third (ADR-33, ADR-34).
  {
    files: ['src/server/ai/**/*.ts'],
    ignores: ['src/server/ai/provider/nvidia-build.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...aiZonePatterns, wireClientPattern] },
      ],
    },
  },

  // The wire client is the ONE file allowed to import `openai`. It is not
  // otherwise privileged: every import ban above still applies to it.
  //
  // This is a separate config object because `ignores` on the object above
  // removes that object *entirely* for the named file — rules and all. Before
  // the adversarial review the two were combined, so the single exemption
  // intended to permit `openai` also handed `nvidia-build.ts` the database,
  // the services and the engine. Splitting them is what makes the exemption
  // exactly one import wide.
  {
    files: ['src/server/ai/provider/nvidia-build.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: aiZonePatterns }],
    },
  },

  // ------------------------------------------------ AI read capability
  // `src/server/ai-read/**` is the bridge, and the only module outside the AI
  // zone that exists for it. It may call application services — that is its
  // whole job — but it must never reach a write helper or the database, because
  // it is the one place holding a real `ReadCtx` on the AI layer's behalf.
  //
  // `importNames` bans the write surface by name while leaving queries
  // importable, which a path-only rule cannot express. It is belt to the type
  // system's braces: `withWriteCtx` needs a `RequestCtx` and a `ReadCtx` is not
  // one, so a write here would not compile either (ADR-33).
  {
    files: ['src/server/ai-read/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/server/services', '**/services', '**/services/*'],
              importNames: [
                'withWriteCtx',
                'withWriteCtxResult',
                'WriteCtx',
                'RequestCtx',
                'createReadCtx',
              ],
              message:
                'ADR-35: the AI read capability is read-only. It holds a ReadCtx to project queries with, and has no business naming the write boundary.',
            },
            {
              group: [
                '@/server/db',
                '@/server/domain',
                '**/db',
                '**/db/*',
                '**/domain',
                '**/domain/*',
                'drizzle-orm',
                'drizzle-orm/*',
                'pg',
              ],
              message:
                'ADR-21: the AI read capability projects application services. It issues no SQL and imports no engine module directly.',
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
