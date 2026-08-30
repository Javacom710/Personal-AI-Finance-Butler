import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import ignore from 'ignore';
import { describe, expect, it } from 'vitest';

/**
 * Invariant **I-51** — *the AI zone imports nothing that can read or write the
 * database* ([ADR-34](../../docs/DECISIONS.md#adr-34--the-ai-import-boundary-is-enforced-three-ways-and-covers-relative-paths)).
 *
 * ## Why a scan, when there is already a lint rule
 *
 * Because the lint rule is not sufficient, and the Phase 7 review (**F-2**)
 * established exactly how. `no-restricted-imports` matches the **raw specifier
 * string** with gitignore semantics — it never resolves a path — so the previous
 * AI-zone rule, which listed only `@/`-aliased forms, let this through clean:
 *
 * ```ts
 * import { db } from '../../db/client';   // linted clean; full database handle
 * ```
 *
 * The rule has been extended (see `eslint.config.mjs`), and this scan is the
 * second mechanism rather than a restatement of the first. It catches two things
 * ESLint structurally cannot:
 *
 * - **dynamic imports.** The rule registers no `ImportExpression` listener at
 *   all, so `await import('@/server/db/client')` and `require(…)` are unchecked
 *   in every zone, in every version.
 * - **`ctx.db` DML.** A handle obtained legitimately and then written through is
 *   an expression, not an import, so no import rule can see it.
 *
 * The third mechanism is the type system, asserted in
 * `tests/unit/ai-write-boundary.test.ts` (**I-50**). Three mechanisms, three
 * different failure modes, none of them a comment.
 *
 * ## Non-vacuity
 *
 * `src/server/ai/` does not exist until Phase 7 step 7.1, and a scan over an
 * empty directory passes for the wrong reason — the failure mode `TESTING.md` §7
 * names explicitly. So this suite asserts three separable things, and the first
 * two hold **today**:
 *
 * 1. the matcher rejects a corpus of synthetic violations (self-test);
 * 2. `eslint.config.mjs` carries the patterns that close the relative-path hole
 *    (config assertion — non-vacuous now, and the thing most likely to be
 *    silently reverted);
 * 3. every real file in the AI zone complies, once there are any.
 */

const ROOT = join(__dirname, '..', '..');
const AI_ZONE = 'src/server/ai';

/**
 * The forbidden import specifiers, in the same gitignore syntax ESLint's rule
 * uses — and deliberately read *from the ESLint config itself* rather than
 * copied, so the two mechanisms cannot drift into disagreeing about what is
 * banned. The adversarial review found the previous copy already drifting: it
 * was a denylist of three directories, and `auth`, `jobs`, `market-data`,
 * `app/**` and `@/lib/env` were all reachable through both.
 *
 * An **allowlist** ([ADR-38](../../docs/DECISIONS.md#adr-38--the-ai-zone-is-an-allowlist-a-new-directory-is-closed-on-the-day-it-is-created)):
 * deny `@/server/**`, re-admit exactly `@/server/ai-read` and the redacting
 * logger, re-deny the bridge. A directory added tomorrow is closed by default.
 */
const ESLINT_CONFIG = readFileSync(join(ROOT, 'eslint.config.mjs'), 'utf8');

const FORBIDDEN_IMPORTS = (() => {
  const block = /const aiZonePatterns = \[([\s\S]*?)\n\];/.exec(ESLINT_CONFIG);
  if (!block?.[1]) throw new Error('ai-boundary scan: aiZonePatterns not found in eslint.config.mjs');
  return [...block[1].matchAll(/'([^']+)'/g)]
    .map((m) => m[1] as string)
    // Pattern strings only; the `message:` prose in the same block is not one.
    .filter((s) => !s.includes(' '));
})();

const forbids = (specifier: string): boolean =>
  ignore({ allowRelativePaths: true, ignorecase: true }).add(FORBIDDEN_IMPORTS).ignores(specifier);

/** Strip comments, so prose explaining the rule does not trip the rule. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Every module specifier in a source file: static `import`/`export … from`,
 * dynamic `import()`, and `require()`.
 *
 * The last two are the point. ESLint's import rule sees neither.
 */
function specifiersIn(source: string): string[] {
  const body = code(source);
  const out: string[] = [];
  const patterns = [
    /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of body.matchAll(pattern)) if (match[1]) out.push(match[1]);
  }
  return out;
}

/** A write issued through a context's database handle, however it was obtained. */
const CTX_DML = /\bctx\.db\s*\.\s*(insert|update|delete|execute|transaction)\b/;
/** The write boundary itself, and the context type that can reach it. */
const WRITE_SYMBOLS = /\b(withWriteCtx|withWriteCtxResult|WriteCtx|RequestCtx|createReadCtx)\b/;

function tsFilesUnder(relative: string): string[] {
  const absolute = join(ROOT, relative);
  if (!existsSync(absolute)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.ts')) out.push(full);
    }
  };
  walk(absolute);
  return out;
}

const read = (file: string) => readFileSync(file, 'utf8');
const relative = (file: string) => file.slice(ROOT.length + 1).replace(/\\/g, '/');

describe('I-51 — the matcher catches what it claims to', () => {
  it('rejects every aliased route into the database, engine and services', () => {
    for (const specifier of [
      '@/server/db/client',
      '@/server/db/schema',
      '@/server/domain/calc/portfolio',
      '@/server/services',
      '@/server/services/cashflow',
      '@/server/ai-read/internal',
    ]) {
      expect(forbids(specifier), specifier).toBe(true);
    }
  });

  it('rejects the relative routes the old rule let through — finding F-2', () => {
    // Each of these linted clean before the fix. `../../db/client` from
    // `src/server/ai/tools/` resolves to `src/server/db/client`, and the
    // engine zone's `**/server/db/*` did not catch it either, because the
    // specifier contains no literal `server` segment.
    for (const specifier of [
      '../../db/client',
      '../db/client',
      '../../../db/client',
      './db/client',
      '../../domain/calc/portfolio',
      '../../services/accounts',
      '../services',
      '../ai-read/internal',
      '../../ai-read/internal',
      'src/server/db/client',
      'server/db/client',
    ]) {
      expect(forbids(specifier), specifier).toBe(true);
    }
  });

  it('rejects the seven routes the adversarial review found — ADR-38', () => {
    // A denylist of `db`/`domain`/`services` left every other directory open.
    // Each of these passed BOTH ESLint and this scan before the allowlist, and
    // the first four are outright defeats of the write boundary: none of them
    // needs a `WriteCtx` to reach one.
    for (const specifier of [
      // `'use server'` actions take a form, call requireSession(), and build a
      // WriteCtx internally. Importing one is a mutation path.
      '@app/(app)/money/actions',
      '../../../../app/(app)/money/actions',
      // enqueue / runDueJobs — the same, one indirection further away.
      '@/server/jobs',
      '../../jobs',
      // env() returns DATABASE_URL, APP_ENCRYPTION_KEY, SESSION_COOKIE_SECRET
      // and every provider credential.
      '@/lib/env',
      '../../../lib/env',
      // Sessions, password verification, and decryption of TOTP secrets and
      // recovery codes.
      '@/server/auth/session-store',
      '@/server/auth/crypto',
      '../../auth/crypto',
      // Arbitrary outbound HTTP — an exfiltration channel with credentials.
      '@/server/market-data/http',
      '../../market-data/http',
      // Executes SQL, even if only a fixed probe.
      '@/server/health',
    ]) {
      expect(forbids(specifier), specifier).toBe(true);
    }
  });

  it('closes a server directory that does not exist yet', () => {
    // The property an allowlist has and a denylist cannot: whatever Phase 8
    // adds under src/server/ is shut on the day it is created, not on the day
    // someone remembers to come back here.
    for (const specifier of ['@/server/whatever-comes-next', '@/server/reporting/exports']) {
      expect(forbids(specifier), specifier).toBe(true);
    }
  });

  it('leaves the legitimate AI-facing surface alone', () => {
    // The other half. A matcher that rejected everything would satisfy every
    // negative assertion above and be useless.
    for (const specifier of [
      '@/server/ai-read',
      '../ai-read',
      '@/lib/decimal/money',
      '../../../lib/decimal/money',
      '@/lib/format/json-projection',
      './registry',
      '../config/models',
      'server-only',
      'zod',
    ]) {
      expect(forbids(specifier), specifier).toBe(false);
    }
  });

  it('extracts dynamic and require specifiers, which ESLint does not check', () => {
    const found = specifiersIn(`
      import { a } from '@/server/services';
      import '@/server/db/client';
      export { b } from '../../domain/calc/portfolio';
      const c = await import('@/server/db/schema');
      const d = require('../../db/client');
    `);
    expect(found).toEqual([
      '@/server/services',
      '../../domain/calc/portfolio',
      '@/server/db/client',
      '@/server/db/schema',
      '../../db/client',
    ]);
    expect(found.filter(forbids)).toHaveLength(5);
  });

  it('would catch a write through a context handle', () => {
    expect(CTX_DML.test('await ctx.db.execute(sql`update accounts set name = 1`)')).toBe(true);
    expect(CTX_DML.test('await ctx.db.insert(accounts).values(row)')).toBe(true);
    expect(CTX_DML.test('await ctx.db.transaction(async (tx) => tx)')).toBe(true);
    expect(CTX_DML.test('const rows = await ctx.db.select().from(accounts)')).toBe(false);
  });
});

describe('I-51 — eslint.config.mjs is an allowlist, and governs every AI file', () => {
  const config = ESLINT_CONFIG;
  const zone = config.slice(config.indexOf('const aiZonePatterns'), config.indexOf('---------------- tests'));

  it('finds the AI zone it is meant to be checking', () => {
    expect(zone.length).toBeGreaterThan(500);
    expect(zone).toMatch(/files: \['src\/server\/ai\/\*\*\/\*\.ts'\]/);
    expect(FORBIDDEN_IMPORTS.length).toBeGreaterThanOrEqual(20);
  });

  it('denies the whole server tree and re-admits exactly two modules', () => {
    // The shape of the fix. `@/server/**` first, then the two re-admissions,
    // then the bridge re-denied inside one of them — order is load-bearing in
    // gitignore semantics, so it is asserted rather than assumed.
    expect(FORBIDDEN_IMPORTS).toContain('@/server/**');
    expect(FORBIDDEN_IMPORTS).toContain('!@/server/ai-read');
    expect(FORBIDDEN_IMPORTS).toContain('!@/server/log');
    expect(FORBIDDEN_IMPORTS.indexOf('@/server/**')).toBeLessThan(
      FORBIDDEN_IMPORTS.indexOf('!@/server/ai-read'),
    );
    expect(FORBIDDEN_IMPORTS.indexOf('!@/server/ai-read')).toBeLessThan(
      FORBIDDEN_IMPORTS.indexOf('@/server/ai-read/internal'),
    );
  });

  it('names every sibling of src/server/ai in its relative form too', () => {
    // The aliased patterns alone were F-2; the missing siblings were the
    // adversarial review's finding. A relative specifier climbing out of the AI
    // zone carries no `server` segment, so each directory is named again.
    for (const pattern of [
      '**/db',
      '**/domain',
      '**/services',
      '**/auth',
      '**/jobs',
      '**/market-data',
      '**/health',
      '**/ai-read/internal',
      '**/lib/env',
      '**/app/*',
    ]) {
      expect(FORBIDDEN_IMPORTS, pattern).toContain(pattern);
    }
  });

  it('bans the query builder outright, so raw SQL cannot be authored', () => {
    expect(FORBIDDEN_IMPORTS).toContain('drizzle-orm');
    expect(FORBIDDEN_IMPORTS).toContain('pg');
  });

  it('scopes the wire-client exemption to one import, not to every rule', () => {
    // `ignores` removes a config object *entirely* for the named file. With the
    // bans and the `openai` allowance in one object, the single exemption meant
    // `nvidia-build.ts` could import the database, the services and the engine.
    // The split is what makes the exemption exactly one import wide.
    expect(zone).toMatch(/files: \['src\/server\/ai\/provider\/nvidia-build\.ts'\]/);
    const providerBlock = zone.slice(zone.indexOf("files: ['src/server/ai/provider/nvidia-build.ts']"));
    expect(providerBlock).toContain('patterns: aiZonePatterns');
    expect(providerBlock).not.toContain('wireClientPattern');
  });

  it('does not lint the nested worktree copies of this repository', () => {
    // Not an AI rule, but the same file and the same class of mistake: a scope
    // that silently includes what it should not.
    expect(config).toContain("'.claude/**'");
  });
});

describe('I-51 — the AI zone complies', () => {
  const files = tsFilesUnder(AI_ZONE);

  it('is absent until Phase 7 creates it, and is scanned from the first file', () => {
    // Phase 7 has not started. Recorded as an assertion rather than a comment so
    // that the day this stops being true is the day the scan below starts
    // carrying weight — and so nothing here silently passes on an empty set.
    if (files.length === 0) {
      expect(existsSync(join(ROOT, AI_ZONE))).toBe(false);
      return;
    }
    expect(files.length).toBeGreaterThan(0);
  });

  it.runIf(files.length > 0)('imports nothing forbidden, by any spelling', () => {
    for (const file of files) {
      for (const specifier of specifiersIn(read(file))) {
        expect(forbids(specifier), `${relative(file)} imports ${specifier}`).toBe(false);
      }
    }
  });

  it.runIf(files.length > 0)('issues no DML through a context handle', () => {
    for (const file of files) {
      expect(CTX_DML.test(code(read(file))), `${relative(file)} writes through ctx.db`).toBe(false);
    }
  });

  it.runIf(files.length > 0)('names no write-boundary symbol at all', () => {
    for (const file of files) {
      expect(WRITE_SYMBOLS.test(code(read(file))), `${relative(file)} names a write-boundary symbol`).toBe(
        false,
      );
    }
  });
});

describe('I-52 — the read capability carries no database handle', () => {
  const capability = readFileSync(join(ROOT, 'src/server/ai-read/index.ts'), 'utf8');
  const internal = readFileSync(join(ROOT, 'src/server/ai-read/internal.ts'), 'utf8');

  it('declares AiReadCtx without a db, fx or transaction field', () => {
    const shape = code(capability).slice(code(capability).indexOf('export interface AiReadCtx'));
    expect(shape).toContain('userId');
    expect(shape).not.toMatch(/\breadonly db\b/);
    expect(shape).not.toMatch(/\breadonly fx\b/);
    expect(shape).not.toMatch(/\bbeginTransaction\b/);
  });

  it('keeps the public capability free of any service or database import', () => {
    for (const specifier of specifiersIn(capability)) {
      expect(forbids(specifier), `ai-read/index.ts imports ${specifier}`).toBe(false);
    }
  });

  it('binds the read context in a module-private WeakMap, not on the object', () => {
    // The positive form. Absence of a `db` field is also satisfied by a
    // capability that cannot read anything at all, which would be a different
    // bug; this asserts the binding exists and is unreachable from the value.
    expect(internal).toMatch(/new WeakMap<AiReadCtx, ReadCtx>\(\)/);
    expect(internal).toMatch(/export function createAiReadCtx/);
    expect(internal).toMatch(/export async function withFinanceReads/);
  });

  it('never re-exports the bridge from the public capability', () => {
    expect(code(capability)).not.toMatch(/withFinanceReads|createAiReadCtx|from '\.\/internal'/);
  });
});
