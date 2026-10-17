import { dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

import { classifyTarget, DENY_REASON, isAllowedFromAiZone } from './ai-import-boundary.mjs';

/**
 * Layer boundaries from ARCHITECTURE.md §2 are enforced here, not merely
 * documented. Each `no-restricted-imports` zone below corresponds to one
 * bullet in the "Rules" list of that section.
 *
 * Phases 3+ add `domain/`, `services/`, and `ai/`. The rules are written now so
 * that the first file placed in one of those directories is already governed.
 */

const ROOT = dirname(fileURLToPath(import.meta.url));
const toRepoRel = (absolute) => relative(ROOT, absolute).split(sep).join('/');

/**
 * The resolved-path half of the AI boundary (finding B-2, ADR-34/38). Where
 * `no-restricted-imports` below matches the raw specifier string,
 * `no-restricted-imports` cannot resolve a path, normalise `@/lib/./env`, see a
 * relative sibling like `../ai-runtime`, or look inside a dynamic `import()`.
 * This rule decides on the **resolved module** via the shared
 * `ai-import-boundary.mjs` — the same decision the I-51 source scan makes — and
 * it inspects static imports, `export … from`, dynamic `import()` and
 * `require()`. A dynamic call whose argument is not a single static string is
 * rejected rather than waved through.
 */
const aiResolvedImportRule = {
  meta: {
    type: 'problem',
    docs: { description: 'src/server/ai/** may import only its resolved allowlist (I-51).' },
    schema: [],
    messages: {
      denied: "ADR-34/38 (I-51): src/server/ai/** may not import '{{spec}}' — it reaches {{reason}}.",
      dynamic:
        'ADR-34/38 (I-51): a dynamic import/require in src/server/ai/** must take a single static string so the boundary can resolve it.',
      codeLoading:
        'ADR-34/38 (I-51): eval / Function load code the import boundary cannot see, so src/server/ai/** may not use them.',
    },
  },
  create(context) {
    const importer = toRepoRel(context.filename ?? context.getFilename());
    const check = (node, spec) => {
      if (isAllowedFromAiZone(importer, spec)) return;
      const label = classifyTarget(importer, spec);
      context.report({ node, messageId: 'denied', data: { spec, reason: DENY_REASON[label] ?? label } });
    };
    const staticStringOf = (arg) => {
      if (arg?.type === 'Literal' && typeof arg.value === 'string') return arg.value;
      if (arg?.type === 'TemplateLiteral' && arg.expressions.length === 0 && arg.quasis.length === 1)
        return arg.quasis[0].value.cooked;
      return undefined;
    };
    const checkDynamic = (node, arg) => {
      const spec = staticStringOf(arg);
      if (spec === undefined) context.report({ node, messageId: 'dynamic' });
      else check(node, spec);
    };
    return {
      ImportDeclaration: (node) => check(node, node.source.value),
      ExportNamedDeclaration: (node) => node.source && check(node, node.source.value),
      ExportAllDeclaration: (node) => node.source && check(node, node.source.value),
      // `import x = require('…')` and the type-position `import('…')`.
      TSImportEqualsDeclaration: (node) => {
        if (node.moduleReference.type === 'TSExternalModuleReference')
          checkDynamic(node, node.moduleReference.expression);
      },
      TSImportType: (node) => {
        const arg = node.argument?.type === 'TSLiteralType' ? node.argument.literal : node.argument;
        checkDynamic(node, arg);
      },
      ImportExpression: (node) => checkDynamic(node, node.source),
      CallExpression: (node) => {
        if (node.callee.type !== 'Identifier') return;
        if (node.callee.name === 'require') {
          if (node.arguments.length === 1) checkDynamic(node, node.arguments[0]);
          else context.report({ node, messageId: 'dynamic' });
        }
        if (node.callee.name === 'eval' || node.callee.name === 'Function')
          context.report({ node, messageId: 'codeLoading' });
      },
      NewExpression: (node) => {
        if (node.callee.type === 'Identifier' && node.callee.name === 'Function')
          context.report({ node, messageId: 'codeLoading' });
      },
    };
  },
};

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
  // This rule alone cannot be the whole answer: it matches raw strings and has
  // no `ImportExpression` listener, so `await import('@/server/db/client')` is
  // unchecked by it in every zone. For the AI zone the resolved-path rule below
  // (`ai-boundary/resolved-imports`) checks dynamic imports and require();
  // `tests/unit/ai-boundary-source-scan.test.ts` makes the same decision from
  // the parse tree, and the capability types are the third mechanism (ADR-33,
  // ADR-34).
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

  // The resolved-path half of the same boundary, over every AI-zone file
  // including the wire client. `no-restricted-imports` above is the raw-string
  // first net; this closes what a string match structurally cannot — path
  // normalisation, relative sibling files, and dynamic import()/require()
  // (finding B-2). The openai/drizzle/pg package bans live in the decision
  // itself, so nvidia-build.ts is governed here too.
  {
    files: ['src/server/ai/**/*.ts'],
    plugins: { 'ai-boundary': { rules: { 'resolved-imports': aiResolvedImportRule } } },
    rules: { 'ai-boundary/resolved-imports': 'error' },
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
