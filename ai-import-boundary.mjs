/**
 * The AI import boundary, as a resolved-path decision — the single source of
 * truth shared by ESLint (`eslint.config.mjs`) and the source scan
 * (`tests/unit/ai-boundary-source-scan.test.ts`). Invariant **I-51**, ADR-34,
 * ADR-38.
 *
 * ## Why this file exists (finding B-2)
 *
 * The first enforcement matched the **raw specifier string** with gitignore
 * semantics and never resolved a path. Three whole classes of bypass followed,
 * every one demonstrated against the reconciled tree:
 *
 *   - a **sibling file** nobody enumerated: `../ai-runtime` reaches
 *     `src/server/ai-runtime.ts` — the composition root that holds the provider,
 *     the kill switch and the database — and no deny-pattern named it, exactly
 *     the ADR-38 failure mode reappearing one level down from a directory;
 *   - **normalisation**: `@/lib/./env`, `@/lib//env`, `../ai-read/./internal`
 *     all denote a banned module, but not by the exact string the matcher held;
 *   - **spelling**: a `j` escape, a backtick template literal, and a
 *     dynamic `import()` whose argument is hidden between two string literals
 *     that read as a `/* … *​/` comment.
 *
 * The cure for all three is to stop comparing strings and decide on the
 * **resolved module** instead. This module does only that decision; the two
 * callers supply the specifiers (ESLint from the AST, the scan from a full
 * TypeScript parse) so neither can be fooled by how a specifier is written.
 *
 * ## The boundary
 *
 * A file under `src/server/ai/**` may import, and nothing else:
 *   - another file inside `src/server/ai/**`;
 *   - the public read capability `src/server/ai-read` (its `index` only — never
 *     `internal`, `queries` or `projections`);
 *   - the redacting logger `src/server/log`;
 *   - anything under `src/lib/**` except `src/lib/env` (the validated secrets);
 *   - one of the packages in {@link ALLOWED_PACKAGES}, and `openai` from
 *     `provider/nvidia-build.ts` only.
 *
 * Everything else — `ai-runtime`, `db`, `domain`, `services`, `jobs`, `auth`,
 * `market-data`, `health`, `ai-read/internal`, `app/**`, `lib/env` — is denied,
 * and a directory added under `src/server/` tomorrow is denied on the day it is
 * created, because the rule is an allowlist over the resolved path.
 *
 * Packages are an allowlist for the same reason. A denylist of `drizzle-orm` and
 * `pg` would still admit `node:module` (whose `createRequire` loads any path at
 * runtime), `node:fs` (which reads `.env` directly), `node:child_process` and
 * `node:vm` — each a way round every other rule in this file. The AI zone needs
 * one package today; a new one is a deliberate, reviewed addition here.
 *
 * Paths are compared case-insensitively and with trailing dots and spaces
 * stripped from each segment, because the filesystem this runs on (Windows)
 * resolves `@/lib/ENV` and `@/lib/env.` to `src/lib/env.ts`.
 */

/** Third-party packages the AI zone may import. `openai` is handled separately. */
export const ALLOWED_PACKAGES = Object.freeze(['zod', 'server-only']);

const EXT = /\.(?:d\.ts|ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;

/**
 * Collapse `.`, `..`, `//` and backslashes into a normalised posix path, strip
 * trailing dots and spaces from each segment (as Win32 path normalisation does),
 * and lower-case the result (as a case-insensitive filesystem resolves it).
 */
function normalise(pathParts) {
  const out = [];
  for (const raw of pathParts.replace(/\\/g, '/').split('/')) {
    const part = raw === '.' || raw === '..' ? raw : raw.replace(/[. ]+$/, '');
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else out.push('..');
    } else {
      out.push(part);
    }
  }
  return out.join('/').toLowerCase();
}

function dirname(posixRel) {
  const i = posixRel.lastIndexOf('/');
  return i === -1 ? '' : posixRel.slice(0, i);
}

/** The leading package name of a bare specifier, scope included. */
function packageName(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/**
 * Resolve a specifier as written in `importerRel` (a posix, repo-relative path
 * such as `src/server/ai/tools/dispatch.ts`).
 *
 * Returns one of:
 *   { kind: 'bare',      name }              a third-party package
 *   { kind: 'internal',  key }               a repo module, extension stripped
 *   { kind: 'unresolved' }                   a dynamic argument that is not a
 *                                            single static string — fail closed
 */
export function resolveSpecifier(importerRel, spec) {
  if (spec == null) return { kind: 'unresolved' };
  const raw = String(spec).replace(/\\/g, '/');

  let candidate = null;
  if (raw.startsWith('@/')) candidate = 'src/' + raw.slice(2);
  else if (raw === '@app') candidate = 'app';
  else if (raw.startsWith('@app/')) candidate = 'app/' + raw.slice(5);
  else if (raw === '.' || raw === './' || raw.startsWith('./') || raw.startsWith('../'))
    candidate = (dirname(importerRel) ? dirname(importerRel) + '/' : '') + raw;
  else if (raw.startsWith('src/')) candidate = raw;
  else if (raw.startsWith('app/')) candidate = raw;
  else if (raw.startsWith('server/')) candidate = 'src/' + raw; // legacy internal-looking form
  else return { kind: 'bare', name: raw };

  let key = normalise(candidate);
  // Strip a module extension from the final segment, and a trailing `/index`.
  key = key.replace(EXT, '');
  if (key.endsWith('/index')) key = key.slice(0, -'/index'.length);
  return { kind: 'internal', key };
}

/**
 * Classify a resolved target for messages and capability assertions. Returns
 * `'allowed'` for anything the AI zone may import, or a short label naming the
 * privileged surface it would otherwise reach.
 */
export function classifyTarget(importerRel, spec) {
  const r = resolveSpecifier(importerRel, spec);

  if (r.kind === 'unresolved') return 'dynamic-unresolved';

  if (r.kind === 'bare') {
    const pkg = packageName(r.name).toLowerCase();
    if (pkg === 'drizzle-orm' || pkg === 'pg') return 'query-builder';
    if (pkg === 'openai') {
      return normalise(importerRel) === AI_WIRE_CLIENT_FILE ? 'allowed' : 'wire-client';
    }
    return ALLOWED_PACKAGES.includes(pkg) ? 'allowed' : 'package-not-allowed';
  }

  const key = r.key;
  if (key === 'src/server/ai' || key.startsWith('src/server/ai/')) return 'allowed';
  if (key === 'src/server/ai-read') return 'allowed'; // the public index only
  if (key === 'src/server/log') return 'allowed';
  if (key === 'src/lib' || (key.startsWith('src/lib/') && key !== 'src/lib/env')) return 'allowed';

  // Denied — name the surface, so a violation reads as a capability, not a path.
  if (key === 'src/lib/env') return 'env-secrets';
  if (key === 'src/server/ai-runtime') return 'ai-runtime';
  if (key === 'src/server/ai-read/internal') return 'ai-read-internal';
  if (key.startsWith('src/server/ai-read/')) return 'ai-read-internal';
  if (key === 'src/server/health') return 'health';
  if (key === 'src/server/db' || key.startsWith('src/server/db/')) return 'db';
  if (key === 'src/server/domain' || key.startsWith('src/server/domain/')) return 'domain';
  if (key === 'src/server/services' || key.startsWith('src/server/services/')) return 'services';
  if (key === 'src/server/jobs' || key.startsWith('src/server/jobs/')) return 'jobs';
  if (key === 'src/server/auth' || key.startsWith('src/server/auth/')) return 'auth';
  if (key === 'src/server/market-data' || key.startsWith('src/server/market-data/')) return 'market-data';
  if (key === 'app' || key.startsWith('app/')) return 'app-actions';
  return 'server-other';
}

/** The one decision. True iff `src/server/ai/**` may import `spec`. */
export function isAllowedFromAiZone(importerRel, spec) {
  return classifyTarget(importerRel, spec) === 'allowed';
}

/** Human-readable reasons, keyed by the label {@link classifyTarget} returns. */
export const DENY_REASON = {
  'env-secrets': 'the validated environment (DATABASE_URL, APP_ENCRYPTION_KEY, SESSION_COOKIE_SECRET, provider credentials)',
  'ai-runtime': 'the AI composition root (provider, kill switch, rate limiter, database)',
  'ai-read-internal': 'the read-capability bridge, which holds a real ReadCtx',
  health: 'health.ts, which executes SQL',
  db: 'the database client',
  domain: 'the financial engine',
  services: 'the application services and the write boundary',
  jobs: 'the job queue and runner, whose handlers write the ledger',
  auth: 'sessions, password verification and secret decryption',
  'market-data': 'outbound HTTP carrying provider credentials',
  'app-actions': "a 'use server' action, which builds a WriteCtx from the session",
  'query-builder': 'a SQL query builder (drizzle-orm / pg)',
  'wire-client': 'the OpenAI wire client (only provider/nvidia-build.ts may import it)',
  'package-not-allowed': 'a package outside the AI zone allowlist (ALLOWED_PACKAGES in ai-import-boundary.mjs)',
  'dynamic-unresolved': 'a dynamic import whose target is not a single static string',
  'server-other': 'a module outside the AI read surface',
};

export const AI_ZONE_GLOB = 'src/server/ai/**/*.ts';
export const AI_WIRE_CLIENT_FILE = 'src/server/ai/provider/nvidia-build.ts';
