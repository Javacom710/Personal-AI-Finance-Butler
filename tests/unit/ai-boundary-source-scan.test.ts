import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { ESLint } from 'eslint';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  ALLOWED_PACKAGES,
  AMBIENT_GLOBALS,
  classifyTarget,
  isAllowedFromAiZone,
  resolveSpecifier,
  type TargetLabel,
} from '../../ai-import-boundary.mjs';

/**
 * Invariant **I-51** — *the AI zone imports nothing that can read or write the
 * database* ([ADR-34](../../docs/DECISIONS.md#adr-34--the-ai-import-boundary-is-enforced-three-ways-and-covers-relative-paths),
 * [ADR-38](../../docs/DECISIONS.md#adr-38--the-ai-zone-is-an-allowlist-a-new-directory-is-closed-on-the-day-it-is-created)).
 *
 * ## Why the decision is made on the resolved module (finding B-2)
 *
 * Both mechanisms used to compare the **raw specifier string** against gitignore
 * patterns, and this scan found specifiers with regular expressions over
 * comment-stripped text. The Phase 7 validation defeated that with spellings
 * the reconciled tree's lint, typecheck and this very suite all accepted:
 *
 * ```ts
 * import { aiRuntime } from '../ai-runtime';     // a sibling file nobody enumerated
 * import { env } from '@/lib/./env';             // the same module, not the same string
 * const jobs = await import(`../jobs`);          // backticks: never extracted
 * const open = '/*';                             // two string literals that a
 * const db = () => import('../db/client');       // comment-stripping regex reads
 * const close = '*' + '/';                       // as one comment around the import
 * ```
 *
 * The fix is structural rather than another pattern:
 *
 * - **one decision, shared.** `ai-import-boundary.mjs` resolves a specifier to
 *   the module it denotes — `@/`, `@app/`, relative depth, `.`/`..`/`//`,
 *   extensions, case — and allows it only if that module is on the AI zone's
 *   allowlist. ESLint's `ai-boundary/resolved-imports` rule and this scan both
 *   call it, so they cannot disagree about what is banned;
 * - **specifiers from the parse tree.** This scan reads module references from
 *   the TypeScript AST, so comments cannot hide one, escapes are decoded the way
 *   the loader decodes them, and backtick literals are read like quotes;
 * - **fail closed.** A dynamic `import()`/`require()` whose argument is not a
 *   single static string cannot be resolved, so it is a violation — as are
 *   `eval` and `Function`, which load code no import analysis can see.
 *
 * The third mechanism is still the type system, asserted in
 * `tests/unit/ai-write-boundary.test.ts` (**I-50**).
 */

const ROOT = join(__dirname, '..', '..');
const AI_ZONE = 'src/server/ai';

/** A file directly inside the AI zone, and one a directory deeper, like the real `tools/`. */
const D1 = 'src/server/ai/probe.ts';
const D2 = 'src/server/ai/tools/probe.ts';
const WIRE = 'src/server/ai/provider/nvidia-build.ts';

// ------------------------------------------------------------------ helpers

interface ModuleRef {
  /** The specifier as the loader sees it, or `null` if it is not a single static string. */
  readonly spec: string | null;
  readonly form: 'import' | 'export' | 'import=require' | 'import-type' | 'import()' | 'require()' | 'code-loading' | 'ambient';
  readonly line: number;
}

/** Every module reference in a source file, read from the TypeScript parse tree. */
function importsIn(source: string, fileName = 'probe.ts'): ModuleRef[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: ModuleRef[] = [];
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const staticText = (n: ts.Node | undefined): string | null =>
    n !== undefined && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null;
  const isCalled = (n: ts.CallExpression | ts.NewExpression, name: string) =>
    ts.isIdentifier(n.expression) && n.expression.text === name;

  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n)) {
      out.push({ spec: staticText(n.moduleSpecifier), form: 'import', line: line(n) });
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier) {
      out.push({ spec: staticText(n.moduleSpecifier), form: 'export', line: line(n) });
    } else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) {
      out.push({ spec: staticText(n.moduleReference.expression), form: 'import=require', line: line(n) });
    } else if (ts.isImportTypeNode(n)) {
      const arg = ts.isLiteralTypeNode(n.argument) ? n.argument.literal : undefined;
      out.push({ spec: staticText(arg), form: 'import-type', line: line(n) });
    } else if (ts.isCallExpression(n)) {
      if (n.expression.kind === ts.SyntaxKind.ImportKeyword) {
        out.push({ spec: n.arguments.length === 1 ? staticText(n.arguments[0]) : null, form: 'import()', line: line(n) });
      } else if (isCalled(n, 'require')) {
        out.push({ spec: n.arguments.length === 1 ? staticText(n.arguments[0]) : null, form: 'require()', line: line(n) });
      } else if (isCalled(n, 'eval') || isCalled(n, 'Function')) {
        out.push({ spec: null, form: 'code-loading', line: line(n) });
      }
    } else if (ts.isNewExpression(n) && isCalled(n, 'Function')) {
      out.push({ spec: null, form: 'code-loading', line: line(n) });
    } else if (memberName(n) === 'constructor') {
      // `''.constructor.constructor('…')` is `Function` without the name.
      out.push({ spec: null, form: 'code-loading', line: line(n) });
    } else if (ts.isIdentifier(n) && Object.hasOwn(AMBIENT_GLOBALS, n.text) && !isPropertyName(n)) {
      // H-1. A direct `require('x')` is resolved as an import above, and a direct
      // `eval(…)` / `Function(…)` is already code loading; every other use of the
      // name — a member of it, an alias, a parenthesised call — is refused. This
      // has no scope analysis, so it fails closed: a local merely *named* `fetch`
      // is refused too. ESLint, which has scope analysis, refuses the global only.
      const parent = n.parent;
      const directCall =
        (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
        parent.expression === n &&
        ['require', 'eval', 'Function'].includes(n.text);
      if (!directCall) out.push({ spec: n.text, form: 'ambient', line: line(n) });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** An identifier that names a property or member rather than referring to a binding. */
function isPropertyName(n: ts.Identifier): boolean {
  const p = n.parent;
  if (ts.isPropertyAccessExpression(p) || ts.isQualifiedName(p)) return (ts.isPropertyAccessExpression(p) ? p.name : p.right) === n;
  if (ts.isBindingElement(p)) return p.propertyName === n;
  return (
    (ts.isPropertyAssignment(p) ||
      ts.isPropertySignature(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isMethodSignature(p) ||
      ts.isGetAccessorDeclaration(p) ||
      ts.isSetAccessorDeclaration(p) ||
      ts.isEnumMember(p)) &&
    p.name === n
  );
}

/** Why a reference is refused, or `'allowed'`. */
function verdict(importerRel: string, ref: ModuleRef): TargetLabel | 'code-loading' | 'ambient' {
  if (ref.form === 'code-loading') return 'code-loading';
  if (ref.form === 'ambient') return 'ambient';
  if (ref.spec === null) return 'dynamic-unresolved';
  return classifyTarget(importerRel, ref.spec);
}

/** Every reference in `source` that `importerRel` may not make, described for a failure message. */
function violationsIn(source: string, importerRel: string): { reason: string; text: string }[] {
  return importsIn(source, importerRel)
    .map((ref) => ({ ref, reason: verdict(importerRel, ref) }))
    .filter(({ reason }) => reason !== 'allowed')
    .map(({ ref, reason }) => ({
      reason,
      text: `${importerRel}:${ref.line} ${ref.form} ${ref.spec ?? '<not a single static string>'} -> ${reason}`,
    }));
}

/**
 * Source with every genuine comment blanked out, found from the parse tree's
 * token positions — so a `/*` inside a string literal stays a string, which a
 * regular expression over the text cannot guarantee.
 */
function code(source: string): string {
  const sf = ts.createSourceFile('x.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const ranges: ts.CommentRange[] = [];
  const collect = (pos: number) => {
    ranges.push(...(ts.getLeadingCommentRanges(source, pos) ?? []), ...(ts.getTrailingCommentRanges(source, pos) ?? []));
  };
  const walk = (n: ts.Node): void => {
    collect(n.getFullStart());
    for (const child of n.getChildren(sf)) walk(child);
  };
  walk(sf);
  collect(sf.endOfFileToken.getFullStart());
  let out = source;
  // Same-length replacement, so overlapping or repeated ranges cannot shift offsets.
  for (const r of ranges) out = out.slice(0, r.pos) + ' '.repeat(r.end - r.pos) + out.slice(r.end);
  return out;
}

const WRITE_SYMBOLS = new Set(['withWriteCtx', 'withWriteCtxResult', 'WriteCtx', 'RequestCtx', 'createReadCtx']);
const DML = new Set(['insert', 'update', 'delete', 'execute', 'transaction']);

/** `name` of `x.name` or `x['name']`. */
function memberName(n: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(n)) return n.name.text;
  if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)) return n.argumentExpression.text;
  return undefined;
}

/**
 * Writes through a database handle (`<anything>.db.insert(…)`, not only a
 * variable spelled `ctx`), and any mention of the write boundary, from the
 * parse tree — so neither a comment nor a string can produce or hide one.
 */
function writeFindings(source: string): { dml: string[]; symbols: string[] } {
  const sf = ts.createSourceFile('x.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const dml: string[] = [];
  const symbols: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && WRITE_SYMBOLS.has(n.text)) symbols.push(n.text);
    const method = memberName(n);
    if (method !== undefined && DML.has(method)) {
      const receiver = (n as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression;
      if (memberName(receiver) === 'db') dml.push(n.getText(sf));
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { dml, symbols };
}

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

/** Resolve and assert in one step, so a failure names the pair that broke. */
function expectDecision(importer: string, spec: string, allowed: boolean): void {
  expect(isAllowedFromAiZone(importer, spec), `${importer} imports '${spec}'`).toBe(allowed);
}

/** The resolved module key, for asserting that spellings are the same module. */
function keyOf(importer: string, spec: string): string {
  const r = resolveSpecifier(importer, spec);
  return r.kind === 'internal' ? r.key : `${r.kind}:${r.kind === 'bare' ? r.name : ''}`;
}

let eslintInstance: ESLint | undefined;
const eslint = () => (eslintInstance ??= new ESLint({ cwd: ROOT }));

/** What ESLint's AI-boundary rule says about `source`, linted as if it lived at `importer`. */
async function eslintBoundaryMessages(source: string, importer: string): Promise<string[]> {
  const [result] = await eslint().lintText(source, { filePath: join(ROOT, importer) });
  return (result?.messages ?? [])
    .filter((m) => m.ruleId === 'ai-boundary/resolved-imports')
    .map((m) => `${m.line}: ${m.message}`);
}

// --------------------------------------------------------- the decision

describe('I-51 — the boundary decides on the resolved module (ai-import-boundary.mjs)', () => {
  it('rejects every aliased route into the database, engine and services', () => {
    for (const spec of [
      '@/server/db/client',
      '@/server/db/schema',
      '@/server/domain/calc/portfolio',
      '@/server/services',
      '@/server/services/cashflow',
      '@/server/ai-read/internal',
    ]) {
      expectDecision(D1, spec, false);
    }
  });

  it('rejects the relative routes the old rule let through — finding F-2', () => {
    // Each pair reaches src/server/db, domain, services or the bridge from where
    // it is written. `./db/client` is not here: from inside the AI zone it
    // resolves to src/server/ai/db/client, which is the AI zone.
    for (const [importer, spec] of [
      [D2, '../../db/client'],
      [D1, '../db/client'],
      ['src/server/ai/provider/sub/probe.ts', '../../../db/client'],
      [D2, '../../domain/calc/portfolio'],
      [D2, '../../services/accounts'],
      [D1, '../services'],
      [D1, '../ai-read/internal'],
      [D2, '../../ai-read/internal'],
      [D1, 'src/server/db/client'],
      [D1, 'server/db/client'],
    ] as const) {
      expectDecision(importer, spec, false);
    }
  });

  it('rejects the routes the adversarial review found — ADR-38', () => {
    for (const [importer, spec] of [
      [D1, '@app/(app)/money/actions'],
      [D2, '../../../../app/(app)/money/actions'],
      [D1, '@/server/jobs'],
      [D2, '../../jobs'],
      [D1, '@/lib/env'],
      [D2, '../../../lib/env'],
      [D1, '@/server/auth/session-store'],
      [D1, '@/server/auth/crypto'],
      [D2, '../../auth/crypto'],
      [D1, '@/server/market-data/http'],
      [D2, '../../market-data/http'],
      [D1, '@/server/health'],
    ] as const) {
      expectDecision(importer, spec, false);
    }
  });

  it('closes a server module that does not exist yet — aliased or relative, directory or file', () => {
    // The property an allowlist has and a denylist cannot. B-2's `ai-runtime.ts`
    // was exactly this: a sibling *file*, open by relative path because only
    // directories had been named.
    for (const [importer, spec] of [
      [D1, '@/server/whatever-comes-next'],
      [D1, '@/server/reporting/exports'],
      [D1, '../whatever-comes-next'],
      [D2, '../../reporting/exports'],
      [D1, '../new-sibling-file.ts'],
      [D1, '../../../../outside-the-repo'],
    ] as const) {
      expectDecision(importer, spec, false);
    }
  });

  it('leaves the legitimate AI-facing surface alone', () => {
    // The other half. A decision that rejected everything would satisfy every
    // negative assertion above and be useless. These are the imports the 15
    // real files make, plus the two re-admitted modules.
    for (const [importer, spec] of [
      [D2, '../../ai-read'],
      [D1, '../ai-read'],
      [D1, '@/server/ai-read'],
      [D2, '../../log'],
      [D1, '@/server/log'],
      [D2, '../../../lib/decimal/money'],
      [D1, '@/lib/decimal/money'],
      [D1, '@/lib/format/json-projection'],
      [D2, '../../../lib/result'],
      [D2, './registry'],
      [D2, '../config/models'],
      [D1, 'zod'],
      [D1, 'server-only'],
      [WIRE, 'openai'],
    ] as const) {
      expectDecision(importer, spec, true);
    }
  });

  it('gives every spelling of one module one answer — resolution, not string comparison', () => {
    const classes: { key: string; allowed: boolean; spellings: (readonly [string, string])[] }[] = [
      {
        key: 'src/lib/env',
        allowed: false,
        spellings: [
          [D1, '@/lib/env'], [D1, '@/lib/env.js'], [D1, '@/lib/env.ts'], [D1, '@/lib/./env'],
          [D1, '@/lib//env'], [D1, '@/lib/../lib/env'], [D1, '@/lib/ENV'], [D1, '@/lib/env.'],
          [D1, '@/server/../lib/env'], [D1, '../../lib/env'], [D1, '..\\..\\lib\\env'],
          [D2, '../../../lib/env.js'], [D2, '../../../lib/./env'],
        ],
      },
      {
        key: 'src/server/ai-runtime',
        allowed: false,
        spellings: [
          [D1, '../ai-runtime'], [D1, '../ai-runtime.js'], [D1, './../ai-runtime'],
          [D1, '../ai/../ai-runtime'], [D2, '../../ai-runtime'], [D2, '../../ai-runtime.ts'],
          [D1, '@/server/ai-runtime'], [D1, '@/server/ai/../ai-runtime'],
        ],
      },
      {
        key: 'src/server/ai-read/internal',
        allowed: false,
        spellings: [
          [D1, '../ai-read/internal'], [D1, '../ai-read/./internal'], [D1, '../ai-read//internal'],
          [D1, '../ai-read/internal.js'], [D2, '../../ai-read/internal.js'], [D1, '@/server/ai-read/internal'],
        ],
      },
      {
        key: 'src/server/ai-read',
        allowed: true,
        spellings: [
          [D1, '../ai-read'], [D1, '../ai-read/'], [D1, '../ai-read/index'], [D1, '../ai-read/index.ts'],
          [D1, './../ai-read'], [D2, '../../ai-read'], [D2, '../../ai-read/index.js'],
          [D1, '@/server/ai-read'], [D1, '@/server/ai-read/index'],
        ],
      },
      {
        key: 'src/server/health',
        allowed: false,
        spellings: [[D1, '../health'], [D1, '../health.js'], [D2, '../../health.js'], [D1, '@/server/health']],
      },
    ];
    for (const { key, allowed, spellings } of classes) {
      for (const [importer, spec] of spellings) {
        expect(keyOf(importer, spec), `${importer} → '${spec}'`).toBe(key);
        expectDecision(importer, spec, allowed);
      }
    }
  });

  it('resolves @app/, backslashes, traversal and extensions to the module they denote', () => {
    expect(keyOf(D1, '@app/(app)/money/actions')).toBe('app/(app)/money/actions');
    expect(keyOf(D2, '../../../../app/(app)/money/actions.ts')).toBe('app/(app)/money/actions');
    expect(keyOf(D1, '..\\jobs')).toBe('src/server/jobs');
    expect(keyOf(D1, '../jobs/index.js')).toBe('src/server/jobs');
    expect(keyOf(D1, '../jobs/runner.js')).toBe('src/server/jobs/runner');
    expect(keyOf(D2, '../../server/ai/config/models')).toBe('src/server/server/ai/config/models');
    expect(keyOf(D2, '../../../server/ai/config/models')).toBe('src/server/ai/config/models');
    expect(keyOf(D1, '../../../../etc/passwd')).toBe('../etc/passwd');
    // Traversal that lands back inside the zone is the zone.
    expectDecision(D2, '../../../server/ai/config/models', true);
    // Traversal that leaves the repository is nothing the AI zone may import.
    expectDecision(D1, '../../../../etc/passwd', false);
    // Something that looks like an absolute path is not a package on the allowlist.
    expectDecision(D1, '/etc/passwd', false);
    expectDecision(D1, 'file:///etc/passwd', false);
  });

  it('admits only allowlisted packages — so no loader, filesystem or process module', () => {
    expect([...ALLOWED_PACKAGES]).toEqual(['zod', 'server-only']);
    for (const spec of [
      'drizzle-orm', 'drizzle-orm/pg-core', 'pg', 'openai',
      'node:module', 'module', 'node:fs', 'fs', 'node:child_process', 'node:vm', 'vm', 'worker_threads',
    ]) {
      expectDecision(D1, spec, false);
    }
    expectDecision(D1, 'zod', true);
    expectDecision(D1, 'server-only', true);
    expectDecision(WIRE, 'openai', true);
    expect(classifyTarget(D1, 'openai')).toBe('wire-client');
    expect(classifyTarget(D1, 'node:module')).toBe('package-not-allowed');
    expect(classifyTarget(D1, 'pg')).toBe('query-builder');
  });

  it('names the capability each privileged target would hand the AI zone', () => {
    expect(classifyTarget(D1, '../jobs')).toBe('jobs');
    expect(classifyTarget(D1, '../db/client')).toBe('db');
    expect(classifyTarget(D1, '@/lib/env')).toBe('env-secrets');
    expect(classifyTarget(D1, '../ai-runtime')).toBe('ai-runtime');
    expect(classifyTarget(D1, '../ai-read/internal')).toBe('ai-read-internal');
    expect(classifyTarget(D1, '../health')).toBe('health');
  });
});

// ---------------------------------------------------------- extraction

describe('I-51 — extraction reads the parse tree, not the text', () => {
  it('finds static imports and re-exports, including type-only and side-effect forms', () => {
    const refs = importsIn(`
      import { a } from '@/server/services';
      import '@/server/db/client';
      import type { B } from '../../domain/calc/portfolio';
      export { c } from '../jobs';
      export * from '../auth/crypto';
      export type { D } from '../health';
    `);
    expect(refs.map((r) => [r.form, r.spec])).toEqual([
      ['import', '@/server/services'],
      ['import', '@/server/db/client'],
      ['import', '../../domain/calc/portfolio'],
      ['export', '../jobs'],
      ['export', '../auth/crypto'],
      ['export', '../health'],
    ]);
  });

  it('reads dynamic import() and require() whether the string is quoted or backticked', () => {
    const refs = importsIn(
      "const a = import('../jobs'); const b = import(`../jobs`); const c = require('../jobs'); const d = require(`../jobs`);",
    );
    expect(refs.map((r) => [r.form, r.spec])).toEqual([
      ['import()', '../jobs'],
      ['import()', '../jobs'],
      ['require()', '../jobs'],
      ['require()', '../jobs'],
    ]);
  });

  it('decodes escapes the way the module loader does', () => {
    const refs = importsIn(String.raw`import * as a from '../jobs'; const b = import('../\u{6a}obs'); const c = import(` + '`../\\x6aobs`' + ');');
    expect(refs.map((r) => r.spec)).toEqual(['../jobs', '../jobs', '../jobs']);
  });

  it('is not fooled by comment markers inside string literals', () => {
    const refs = importsIn(`
      const open = '/*';
      export const f = () => import('../db/client');
      const close = '*/';
      // import('../jobs') — a real comment is not an import
      /* require('../jobs') */
    `);
    expect(refs.map((r) => [r.form, r.spec])).toEqual([['import()', '../db/client']]);
  });

  it('treats a non-static argument as unresolved — never as allowed', () => {
    const refs = importsIn(`
      const name = '../jobs';
      const a = import('../' + 'jobs');
      const b = import(name);
      const c = import(\`../\${name}\`);
      const d = require(name);
      const e = require('../jobs', 'extra');
      const f = import();
    `);
    expect(refs.map((r) => [r.form, r.spec])).toEqual([
      ['import()', null],
      ['import()', null],
      ['import()', null],
      ['require()', null],
      ['require()', null],
      ['import()', null],
    ]);
    for (const ref of refs) expect(verdict(D1, ref)).toBe('dynamic-unresolved');
  });

  it('flags eval and Function as code loading', () => {
    const refs = importsIn(`
      const a = eval("import('../jobs')");
      const b = new Function("return import('../jobs')");
      const c = Function("return 1");
    `);
    expect(refs.map((r) => r.form)).toEqual(['code-loading', 'code-loading', 'code-loading']);
  });

  it('finds import-equals and type-position imports', () => {
    const refs = importsIn(`
      import jobs = require('../jobs');
      type Db = import('../db/client').Database;
    `);
    expect(refs.map((r) => [r.form, r.spec])).toEqual([
      ['import=require', '../jobs'],
      ['import-type', '../db/client'],
    ]);
  });

  it('would catch a write through any database handle, not only one named ctx', () => {
    expect(writeFindings('await ctx.db.execute(sql`update accounts set name = 1`)').dml).toHaveLength(1);
    expect(writeFindings('await ctx.db.insert(accounts).values(row)').dml).toHaveLength(1);
    expect(writeFindings('await ctx.db.transaction(async (tx) => tx)').dml).toHaveLength(1);
    expect(writeFindings('await read.db.insert(accounts).values(row)').dml).toHaveLength(1);
    expect(writeFindings("await read['db']['delete'](accounts)").dml).toHaveLength(1);
    expect(writeFindings('const rows = await ctx.db.select().from(accounts)').dml).toHaveLength(0);
    expect(writeFindings('// ctx.db.insert(x) in a comment\nconst s = "ctx.db.insert(x)";').dml).toHaveLength(0);
  });

  it('strips real comments and keeps strings that look like comment markers', () => {
    const stripped = code("const open = '/*'; /* gone */ const keep = 1; // gone too\nconst close = '*/';");
    expect(stripped).toContain("'/*'");
    expect(stripped).toContain("'*/'");
    expect(stripped).toContain('const keep = 1;');
    expect(stripped).not.toContain('gone');
  });
});

// ------------------------------------------------ B-2 regression corpus

/**
 * The bypasses the Phase 7 validation confirmed against f63d9b0, verbatim in
 * substance. Every one passed ESLint, `tsc` and this suite; every one reached a
 * privileged module. `reaches` is the capability the decision must name.
 */
const B2_CORPUS: readonly { id: string; importer: string; source: string; reaches: string }[] = [
  { id: 'S01 ../ai-runtime', importer: D1, source: "import * as m from '../ai-runtime';", reaches: 'ai-runtime' },
  { id: 'D01 ../../ai-runtime', importer: D2, source: "import * as m from '../../ai-runtime';", reaches: 'ai-runtime' },
  { id: 'S05 @/lib/env.js', importer: D1, source: "import { env } from '@/lib/env.js';", reaches: 'env-secrets' },
  { id: 'S06 @/lib/./env', importer: D1, source: "import { env } from '@/lib/./env';", reaches: 'env-secrets' },
  { id: 'S32 @/lib//env', importer: D1, source: "import { env } from '@/lib//env';", reaches: 'env-secrets' },
  { id: 'S04 ../../lib/env.js', importer: D1, source: "import { env } from '../../lib/env.js';", reaches: 'env-secrets' },
  { id: 'D02 ../../../lib/env.js', importer: D2, source: "import { env } from '../../../lib/env.js';", reaches: 'env-secrets' },
  { id: 'S10 ../ai-read/internal.js', importer: D1, source: "import { withFinanceReads } from '../ai-read/internal.js';", reaches: 'ai-read-internal' },
  { id: 'D03 ../../ai-read/internal.js', importer: D2, source: "import { withFinanceReads } from '../../ai-read/internal.js';", reaches: 'ai-read-internal' },
  { id: 'S11 ../ai-read/./internal', importer: D1, source: "import { withFinanceReads } from '../ai-read/./internal';", reaches: 'ai-read-internal' },
  { id: 'S13 ../health.js', importer: D1, source: "import { checkDatabase } from '../health.js';", reaches: 'health' },
  { id: 'D05 ../../health.js', importer: D2, source: "import { checkDatabase } from '../../health.js';", reaches: 'health' },
  { id: 'S30 static \\u006a escape', importer: D1, source: String.raw`import * as m from '../jobs';`, reaches: 'jobs' },
  { id: "Y01 import('../jobs')", importer: D1, source: "export const f = () => import('../jobs');", reaches: 'jobs' },
  { id: "Y01b import('../../jobs')", importer: D2, source: "export const f = () => import('../../jobs');", reaches: 'jobs' },
  { id: 'Y02 import(`../jobs`)', importer: D1, source: 'export const f = () => import(`../jobs`);', reaches: 'jobs' },
  { id: 'Y03 import() \\u006a escape', importer: D1, source: String.raw`export const f = () => import('../jobs');`, reaches: 'jobs' },
  { id: "Y04 import('../' + 'jobs')", importer: D1, source: "export const f = () => import('../' + 'jobs');", reaches: 'dynamic-unresolved' },
  {
    id: "Y05 comment-hidden import('../db/client')",
    importer: D1,
    source: "const open = '/*';\nexport const f = () => import('../db/client');\nconst close = '*/';\nexport const m = [open, close];",
    reaches: 'db',
  },
  { id: "Y06 require('../jobs')", importer: D1, source: "export const f = () => require('../jobs');", reaches: 'jobs' },
  { id: 'Y07 require(`../jobs`)', importer: D1, source: 'export const f = () => require(`../jobs`);', reaches: 'jobs' },
  { id: "Y08 import('@/lib/env')", importer: D1, source: "export const f = () => import('@/lib/env');", reaches: 'env-secrets' },
  { id: 'Y09 import(`@/lib/env`)', importer: D1, source: 'export const f = () => import(`@/lib/env`);', reaches: 'env-secrets' },
  { id: "Y10 import('../ai-runtime')", importer: D1, source: "export const f = () => import('../ai-runtime');", reaches: 'ai-runtime' },
  // The same class, closed in the same change: a runtime loader and code loading.
  { id: 'createRequire via node:module', importer: D1, source: "import { createRequire } from 'node:module';", reaches: 'package-not-allowed' },
  { id: 'eval of an import', importer: D1, source: `export const f = () => eval("import('../jobs')");`, reaches: 'code-loading' },
  { id: 'new Function', importer: D1, source: `export const f = new Function("return import('../jobs')");`, reaches: 'code-loading' },
];

describe('B-2 — every confirmed bypass is closed, by both mechanisms', () => {
  it.each(B2_CORPUS)('$id is rejected by the I-51 scan, naming what it reaches', ({ importer, source, reaches }) => {
    const found = violationsIn(source, importer);
    expect(found.length, source).toBeGreaterThan(0);
    expect(found.map((v) => v.reason)).toContain(reaches);
  });

  it(
    'every corpus entry is rejected by ESLint too — the two mechanisms agree',
    async () => {
      const missed: string[] = [];
      for (const { id, importer, source } of B2_CORPUS) {
        if ((await eslintBoundaryMessages(source, importer)).length === 0) missed.push(id);
      }
      expect(missed).toEqual([]);
    },
    120_000,
  );
});

describe('B-2 — no AI-zone file can reach a privileged capability, in any form', () => {
  const TARGETS: readonly { label: string; importer: string; specs: string[] }[] = [
    { label: 'jobs', importer: D2, specs: ['../../jobs', '../../jobs/runner', '@/server/jobs'] },
    { label: 'db', importer: D2, specs: ['../../db/client', '../../db/client.js', '@/server/db/client'] },
    { label: 'env-secrets', importer: D2, specs: ['../../../lib/env', '../../../lib/./env', '@/lib/env.js'] },
    { label: 'ai-runtime', importer: D2, specs: ['../../ai-runtime', '../../ai-runtime.ts', '@/server/ai-runtime'] },
    { label: 'ai-read-internal', importer: D2, specs: ['../../ai-read/internal', '../../ai-read//internal', '@/server/ai-read/internal.js'] },
    { label: 'health', importer: D2, specs: ['../../health', '../../health.js', '@/server/health'] },
  ];
  const FORMS = [
    (s: string) => `import * as m from '${s}';`,
    (s: string) => `export * from '${s}';`,
    (s: string) => `export const f = () => import('${s}');`,
    (s: string) => `export const f = () => import(\`${s}\`);`,
    (s: string) => `export const f = () => require('${s}');`,
    (s: string) => `export type T = typeof import('${s}');`,
  ];

  it.each(TARGETS)('$label is unreachable by static, dynamic, require and type imports', ({ label, importer, specs }) => {
    for (const spec of specs) {
      for (const form of FORMS) {
        const source = form(spec);
        expect(violationsIn(source, importer).map((v) => v.reason), source).toContain(label);
      }
    }
  });

  it(
    'ESLint rejects every one of those forms as well',
    async () => {
      const missed: string[] = [];
      for (const { importer, specs } of TARGETS) {
        for (const spec of specs) {
          for (const form of FORMS) {
            const source = form(spec);
            if ((await eslintBoundaryMessages(source, importer)).length === 0) missed.push(source);
          }
        }
      }
      expect(missed).toEqual([]);
    },
    120_000,
  );
});

// ------------------------------------------------- ambient capabilities

/**
 * H-1 (B-2 audit §7): capabilities that need no import. Each was reachable from
 * AI-zone source and caught by neither mechanism before this change.
 */
const H1_CORPUS: readonly { id: string; source: string }[] = [
  { id: 'the cached write-capable Database', source: 'export const f = () => (globalThis as any).__financeOsDb.insert({});' },
  { id: 'the database through an alias of the global object', source: 'const g: any = globalThis; export const f = () => g.__financeOsDb;' },
  { id: 'a secret through globalThis.process.env', source: 'export const k = (globalThis as any).process.env.NVIDIA_API_KEY;' },
  { id: 'a secret through bare process.env', source: 'export const k = process.env.APP_ENCRYPTION_KEY;' },
  { id: 'the global object as global', source: 'export const g = (global as any).__financeOsDb;' },
  { id: 'the global object as self', source: 'export const g = (self as any).__financeOsDb;' },
  { id: 'ambient fetch', source: "export const f = () => fetch('https://example.com');" },
  { id: 'ambient fetch through globalThis', source: "export const f = () => globalThis.fetch('https://example.com');" },
  { id: 'a WebSocket', source: "export const f = () => new WebSocket('wss://example.com');" },
  { id: 'indirect eval', source: "export const f = () => (0, eval)('1');" },
  { id: 'eval through an alias', source: "const e = eval; export const f = () => e('1');" },
  { id: 'Function through .constructor', source: "export const f = () => ''.constructor.constructor('return 1')();" },
  { id: 'Function through a computed constructor', source: "export const f = () => (() => 0)['constructor']('return 1');" },
  { id: 'require through an alias', source: "const r = require; export const m = r('../db/client');" },
];

describe('H-1 — no AI-zone file reaches a capability without an import', () => {
  it.each(H1_CORPUS)('$id is rejected by the I-51 scan', ({ source }) => {
    expect(violationsIn(source, D1).length, source).toBeGreaterThan(0);
  });

  it(
    'every one is rejected by ESLint too — the two mechanisms agree',
    async () => {
      const missed: string[] = [];
      for (const { id, source } of H1_CORPUS) {
        if ((await eslintBoundaryMessages(source, D1)).length === 0) missed.push(id);
      }
      expect(missed).toEqual([]);
    },
    120_000,
  );

  it('leaves property names alone: an injected fetch is the provider\'s legitimate route', () => {
    const legitimate = [
      'export interface Config { readonly fetch: (u: string) => Promise<unknown> }',
      'export const call = (config: { fetch: (u: string) => Promise<unknown> }) => config.fetch("/x");',
      'export const o = { process: 1, window: 2 };',
      'export const { fetch: f } = { fetch: 1 };',
    ];
    for (const source of legitimate) expect(violationsIn(source, WIRE), source).toEqual([]);
  });

  it(
    'ESLint judges by scope: a local merely named fetch is not the global',
    async () => {
      expect(await eslintBoundaryMessages('export const f = (fetch: () => void) => fetch();', D1)).toEqual([]);
    },
    60_000,
  );

  it('names a reason for every ambient global', () => {
    for (const name of ['globalThis', 'process', 'fetch', 'eval', 'Function', 'require']) {
      expect(AMBIENT_GLOBALS[name], name).toMatch(/\w/);
    }
  });

  it(
    'closes globalThis.process.env outside the AI zone as well, where the old selector missed it',
    async () => {
      const [result] = await eslint().lintText('export const k = globalThis.process.env.SESSION_COOKIE_SECRET;\n', {
        filePath: join(ROOT, 'src/server/services/probe.ts'),
      });
      const messages = (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-syntax');
      expect(messages.map((m) => m.message).join('\n')).toContain('src/lib/env.ts');
    },
    60_000,
  );
});

// ------------------------------------------------------- configuration

describe('I-51 — eslint.config.mjs carries both halves of the boundary', () => {
  const config = readFileSync(join(ROOT, 'eslint.config.mjs'), 'utf8');
  const zone = config.slice(config.indexOf('const aiZonePatterns'), config.indexOf('---------------- tests'));

  /**
   * The raw-string first net, still read from the config itself so it cannot be
   * silently thinned. It is no longer the decision — the resolved rule is — but
   * it stays as a second, independent line.
   */
  const RAW_PATTERNS = (() => {
    const block = /const aiZonePatterns = \[([\s\S]*?)\n\];/.exec(config);
    if (!block?.[1]) throw new Error('ai-boundary scan: aiZonePatterns not found in eslint.config.mjs');
    return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1] as string).filter((s) => !s.includes(' '));
  })();

  it('finds the AI zone it is meant to be checking', () => {
    expect(zone.length).toBeGreaterThan(500);
    expect(zone).toMatch(/files: \['src\/server\/ai\/\*\*\/\*\.ts'\]/);
    expect(RAW_PATTERNS.length).toBeGreaterThanOrEqual(20);
  });

  it('keeps the raw-string net: deny the server tree, re-admit exactly two modules', () => {
    expect(RAW_PATTERNS).toContain('@/server/**');
    expect(RAW_PATTERNS).toContain('!@/server/ai-read');
    expect(RAW_PATTERNS).toContain('!@/server/log');
    expect(RAW_PATTERNS.indexOf('@/server/**')).toBeLessThan(RAW_PATTERNS.indexOf('!@/server/ai-read'));
    expect(RAW_PATTERNS.indexOf('!@/server/ai-read')).toBeLessThan(RAW_PATTERNS.indexOf('@/server/ai-read/internal'));
    for (const pattern of ['**/db', '**/domain', '**/services', '**/auth', '**/jobs', '**/market-data', '**/health', '**/ai-read/internal', '**/lib/env', '**/app/*']) {
      expect(RAW_PATTERNS, pattern).toContain(pattern);
    }
    expect(RAW_PATTERNS).toContain('drizzle-orm');
    expect(RAW_PATTERNS).toContain('pg');
  });

  it('wires the resolved-path rule, from the shared module, to every AI file', () => {
    expect(config).toMatch(/from '\.\/ai-import-boundary\.mjs'/);
    expect(config).toContain("plugins: { 'ai-boundary': { rules: { 'resolved-imports': aiResolvedImportRule } } }");
    expect(config).toContain("rules: { 'ai-boundary/resolved-imports': 'error' }");
    // Every form this scan extracts has a listener there too.
    for (const listener of ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression', 'CallExpression', 'NewExpression', 'TSImportEqualsDeclaration', 'TSImportType']) {
      expect(config, listener).toMatch(new RegExp(`\\b${listener}: \\(node\\)`));
    }
  });

  it(
    'ESLint resolves the rule as an error for AI files, the wire client included, and not elsewhere',
    async () => {
      const level = async (file: string) => {
        const cfg = (await eslint().calculateConfigForFile(join(ROOT, file))) as { rules?: Record<string, unknown> };
        const rule = cfg.rules?.['ai-boundary/resolved-imports'];
        return Array.isArray(rule) ? rule[0] : rule;
      };
      expect(await level('src/server/ai/tools/dispatch.ts')).toBe(2);
      expect(await level('src/server/ai/provider/nvidia-build.ts')).toBe(2);
      expect(await level('src/server/ai-runtime.ts')).toBeUndefined();
    },
    120_000,
  );

  it('scopes the wire-client exemption to one import, not to every rule', () => {
    expect(zone).toMatch(/files: \['src\/server\/ai\/provider\/nvidia-build\.ts'\]/);
    const providerBlock = zone.slice(zone.indexOf("files: ['src/server/ai/provider/nvidia-build.ts']"));
    expect(providerBlock).toContain('patterns: aiZonePatterns');
    expect(providerBlock).not.toContain('wireClientPattern');
    // And the resolved rule grants `openai` to that one file only.
    expectDecision(WIRE, 'openai', true);
    expectDecision('src/server/ai/provider/types.ts', 'openai', false);
  });

  it('does not lint the nested worktree copies of this repository', () => {
    expect(config).toContain("'.claude/**'");
  });
});

// ------------------------------------------------------------ real files

describe('I-51 — the AI zone complies', () => {
  const files = tsFilesUnder(AI_ZONE);

  it('exists and is scanned, so nothing passes on an empty set', () => {
    expect(existsSync(join(ROOT, AI_ZONE))).toBe(true);
    expect(files.length).toBeGreaterThan(0);
  });

  it('imports nothing outside the resolved allowlist, by any spelling', () => {
    const found = files.flatMap((file) => violationsIn(read(file), relative(file)).map((v) => v.text));
    expect(found).toEqual([]);
  });

  it('issues no DML through a database handle', () => {
    const found = files.flatMap((file) => writeFindings(read(file)).dml.map((d) => `${relative(file)}: ${d}`));
    expect(found).toEqual([]);
  });

  it('names no write-boundary symbol at all', () => {
    const found = files.flatMap((file) => writeFindings(read(file)).symbols.map((s) => `${relative(file)}: ${s}`));
    expect(found).toEqual([]);
  });

  it(
    'passes the ESLint AI-boundary rule, file by file',
    async () => {
      const results = await eslint().lintFiles(files);
      const found = results.flatMap((r) =>
        r.messages
          .filter((m) => m.ruleId === 'ai-boundary/resolved-imports')
          .map((m) => `${relative(r.filePath)}:${m.line} ${m.message}`),
      );
      expect(results).toHaveLength(files.length);
      expect(found).toEqual([]);
    },
    120_000,
  );
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

  it('keeps the public capability free of any service, database or secret import', () => {
    // ai-read/index.ts is not in the AI zone — it may re-export its own
    // `./queries` — but it must not reach a privileged module either.
    const PRIVILEGED = new Set(['db', 'domain', 'services', 'jobs', 'auth', 'market-data', 'health', 'ai-runtime', 'env-secrets', 'query-builder', 'app-actions']);
    for (const ref of importsIn(capability)) {
      const reason = verdict('src/server/ai-read/index.ts', ref);
      expect(PRIVILEGED.has(reason), `ai-read/index.ts imports ${ref.spec} -> ${reason}`).toBe(false);
    }
  });

  it('binds the read context in a module-private WeakMap, not on the object', () => {
    expect(internal).toMatch(/new WeakMap<AiReadCtx, ReadCtx>\(\)/);
    expect(internal).toMatch(/export function createAiReadCtx/);
    expect(internal).toMatch(/export async function withFinanceReads/);
  });

  it('never re-exports the bridge from the public capability', () => {
    expect(code(capability)).not.toMatch(/withFinanceReads|createAiReadCtx|from '\.\/internal'/);
  });
});
