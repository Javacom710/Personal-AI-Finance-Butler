import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Invariant **I-50** — *AI-facing code cannot obtain a write context*
 * ([ADR-33](../../docs/DECISIONS.md#adr-33--the-transaction-opener-is-a-capability-carried-on-the-context-not-an-ambient-import),
 * [ADR-35](../../docs/DECISIONS.md#adr-35--ai-infrastructure-is-strictly-read-only-a-mutation-needs-a-separate-approved-proposal-workflow)).
 *
 * **A compile test, and it has to be.** Every other assertion in this suite runs
 * code and checks what it returned. This one asserts that certain code *cannot
 * be written*, which no amount of running proves — a test that calls
 * `withWriteCtx(aiCtx, …)` and expects a throw would be asserting the weaker
 * runtime property while the compile-time one silently rotted.
 *
 * `AI-SYSTEM.md` §1 has said since Phase 1 that "the AI layer holds only a
 * `ReadCtx` … so a write from AI code does not compile". The Phase 7 review
 * (**F-1**) found that false in two independent ways, both of which compiled
 * clean against the code as it then stood:
 *
 * ```ts
 * withWriteCtx(readCtx, (w) => createTransaction(w, …))  // the escalation
 * readCtx.db.execute(sql`update accounts …`)             // the raw write
 * ```
 *
 * The probes below are the regression protection for the fix. Each is compiled
 * against the **project's own `tsconfig.json`** — same `strict`, same `paths`,
 * same library — through an overlay host that serves the probe from memory and
 * every real file from disk. Nothing is written to the working tree, so there is
 * no artefact to leak into a commit and no cleanup step that can be skipped.
 *
 * `TESTING.md` §7's rule for source scans applies here too, and all three parts
 * are present: the suite proves the harness reports errors it should
 * (`must not compile`), proves it reports *none* where it should not
 * (`compiles`), and would therefore fail loudly if the compiler stopped seeing
 * the project at all.
 */

const ROOT = resolve(__dirname, '..', '..');
const PROBE = join(ROOT, 'src', '__ai_boundary_probe__.ts');

const CONFIG = (() => {
  const path = join(ROOT, 'tsconfig.json');
  const { config, error } = ts.readConfigFile(path, (p) => readFileSync(p, 'utf8'));
  if (error) throw new Error(`tsconfig unreadable: ${error.messageText as string}`);
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, dirname(path));
  return parsed.options;
})();

/**
 * Parsed real source files, shared across probes.
 *
 * Each probe needs the whole reachable program — a few hundred files — and
 * re-parsing them per probe costs seconds apiece. Only the probe itself differs
 * between runs, so everything else is parsed once. This is a speed measure with
 * no effect on what is asserted: the cached files are the real ones from disk.
 */
const parsed = new Map<string, ts.SourceFile | undefined>();

/**
 * Type-check one probe source and return its errors.
 *
 * The probe is placed inside `src/` so the `@/*` path alias resolves exactly as
 * it does for real code. Only the probe file is overlaid; imports resolve to the
 * real modules on disk, which is what makes this a test of the actual types
 * rather than of a restatement of them.
 */
function diagnose(source: string): ts.Diagnostic[] {
  const options = { ...CONFIG, noEmit: true };
  const host = ts.createCompilerHost(options, true);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);

  const same = (name: string) => resolve(name) === PROBE;

  host.readFile = (name) => (same(name) ? source : readFile(name));
  host.fileExists = (name) => same(name) || fileExists(name);
  host.getSourceFile = (name, languageVersion, onError, shouldCreate) => {
    if (same(name)) return ts.createSourceFile(name, source, languageVersion, true);
    const key = resolve(name);
    if (!parsed.has(key)) parsed.set(key, getSourceFile(name, languageVersion, onError, shouldCreate));
    return parsed.get(key);
  };

  const program = ts.createProgram([PROBE], options, host);
  const probe = program.getSourceFile(PROBE);
  if (!probe) throw new Error('the probe file was not added to the program');

  return [...program.getSemanticDiagnostics(probe), ...program.getSyntacticDiagnostics(probe)];
}

const codesOf = (diagnostics: readonly ts.Diagnostic[]): number[] => diagnostics.map((d) => d.code);
const textOf = (diagnostics: readonly ts.Diagnostic[]): string =>
  diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')).join('\n');

/** TS2345 — argument type mismatch. TS2339 — property does not exist. */
const ARGUMENT_MISMATCH = 2345;
const NO_SUCH_PROPERTY = 2339;

// Building the first program parses the whole reachable project. Later probes
// reuse the cache above and are fast; the first is not.
const SLOW = 120_000;

describe('I-50 — the harness itself', () => {
  it('compiles a probe that should be clean, so a failure below means something', () => {
    // Anti-vacuity. If the compiler could not resolve the project at all, every
    // probe would "fail to compile" and every assertion below would pass for
    // the wrong reason.
    const diagnostics = diagnose(`
      import type { AiReadCtx } from '@/server/ai-read';
      export function whose(ai: AiReadCtx): string {
        return ai.userId;
      }
    `);
    expect(textOf(diagnostics)).toBe('');
  }, SLOW);

  it('resolves the real modules rather than a stub', () => {
    // A probe that names something no stub would have. If `@/server/services`
    // resolved to `any`, this would compile and the suite would be worthless.
    const diagnostics = diagnose(`
      import type { RequestCtx } from '@/server/services';
      export const opener = (ctx: RequestCtx) => ctx.beginTransaction;
      export const bogus = (ctx: RequestCtx) => ctx.thisFieldDoesNotExist;
    `);
    expect(codesOf(diagnostics)).toContain(NO_SUCH_PROPERTY);
  }, SLOW);
});

describe('I-50 — an AiReadCtx cannot become a WriteCtx', () => {
  it('cannot be passed to withWriteCtx', () => {
    const diagnostics = diagnose(`
      import type { AiReadCtx } from '@/server/ai-read';
      import { withWriteCtx } from '@/server/services';
      export const escalate = (ai: AiReadCtx) => withWriteCtx(ai, async () => 1);
    `);
    expect(codesOf(diagnostics)).toContain(ARGUMENT_MISMATCH);
  }, SLOW);

  it('cannot be passed to withWriteCtxResult either', () => {
    const diagnostics = diagnose(`
      import type { AiReadCtx } from '@/server/ai-read';
      import { withWriteCtxResult } from '@/server/services';
      export const escalate = (ai: AiReadCtx) =>
        withWriteCtxResult(ai, async () => ({ ok: true, value: 1 }) as const);
    `);
    expect(codesOf(diagnostics)).toContain(ARGUMENT_MISMATCH);
  }, SLOW);

  it('carries no database handle to write through', () => {
    const diagnostics = diagnose(`
      import type { AiReadCtx } from '@/server/ai-read';
      export const raw = (ai: AiReadCtx) => ai.db;
    `);
    expect(codesOf(diagnostics)).toContain(NO_SUCH_PROPERTY);
  }, SLOW);

  it('cannot be passed to an application-service command', () => {
    const diagnostics = diagnose(`
      import type { AiReadCtx } from '@/server/ai-read';
      import { deleteTransaction } from '@/server/services';
      export const wipe = (ai: AiReadCtx, id: string) => deleteTransaction(ai, id);
    `);
    expect(codesOf(diagnostics)).toContain(ARGUMENT_MISMATCH);
  }, SLOW);

  it('cannot even be passed to an application-service query', () => {
    // Not an accident: a query takes a `ReadCtx`, which carries the database
    // handle. The AI layer reaches data through the projected read functions of
    // `@/server/ai-read`, never by handing its capability to a service.
    const diagnostics = diagnose(`
      import type { AiReadCtx } from '@/server/ai-read';
      import { listAccounts } from '@/server/services';
      export const peek = (ai: AiReadCtx) => listAccounts(ai);
    `);
    expect(codesOf(diagnostics)).toContain(ARGUMENT_MISMATCH);
  }, SLOW);
});

describe('I-54 — a breakdown cannot be consumed as a flat additive list', () => {
  it('does not type-check as an array of rows', () => {
    // The structural half of the breakdown contract, and the reason `breakdown()`
    // returns a struct rather than `BreakdownRow[]`: the old signature let a
    // consumer write `rows.reduce(...)` over a set containing both a parent and
    // its children. Now reaching the rows at all means reading the object that
    // declares whether they partition anything.
    const diagnostics = diagnose(`
      import { breakdown, type BreakdownRow, type ReadCtx } from '@/server/services';
      import type { DateRange } from '@/server/services';
      export async function sumEverything(ctx: ReadCtx, range: DateRange) {
        const rows: BreakdownRow[] = await breakdown(ctx, range, 'category', 'expense');
        return rows;
      }
    `);
    expect(codesOf(diagnostics).length).toBeGreaterThan(0);
  }, SLOW);

  it('makes additivity a required field, not an optional hint', () => {
    // A consumer cannot construct a Breakdown that omits the declaration, so
    // there is no shape in which "are these summable?" is unanswered.
    const diagnostics = diagnose(`
      import type { Breakdown } from '@/server/services';
      import { Money, currency } from '@/lib/decimal/money';
      export const undeclared: Breakdown = {
        groupBy: 'tag', kind: 'expense', depth: 'rollup',
        total: Money.zero(currency('INR')), rows: [],
      };
    `);
    expect(codesOf(diagnostics).length).toBeGreaterThan(0);
    expect(textOf(diagnostics)).toMatch(/additivity/);
  }, SLOW);
});

describe('I-50 — a plain ReadCtx cannot escalate either', () => {
  it('rejects withWriteCtx(readCtx, …) — the F-1 hole itself', () => {
    // The exact line the Phase 7 review reported as compiling clean. It is the
    // single most important assertion in this file: `RequestCtx` exists so that
    // read access and the capability to open a transaction are different types.
    const diagnostics = diagnose(`
      import type { ReadCtx } from '@/server/services';
      import { withWriteCtx } from '@/server/services';
      import { deleteTransaction } from '@/server/services';
      export const escalate = (ctx: ReadCtx, id: string) =>
        withWriteCtx(ctx, (w) => deleteTransaction(w, id));
    `);
    expect(codesOf(diagnostics)).toContain(ARGUMENT_MISMATCH);
    expect(textOf(diagnostics)).toMatch(/beginTransaction/);
  }, SLOW);

  it('still lets a RequestCtx open one, so the application keeps working', () => {
    // The other half. A boundary that also blocked legitimate writes would be
    // caught by the rest of the suite, but slowly and confusingly; say it here.
    const diagnostics = diagnose(`
      import type { RequestCtx } from '@/server/services';
      import { withWriteCtx } from '@/server/services';
      import { deleteTransaction } from '@/server/services';
      export const remove = (ctx: RequestCtx, id: string) =>
        withWriteCtx(ctx, (w) => deleteTransaction(w, id));
    `);
    expect(textOf(diagnostics)).toBe('');
  }, SLOW);

  it('grants the capability only through createReadCtx', () => {
    const diagnostics = diagnose(`
      import type { ReadCtx, RequestCtx } from '@/server/services';
      export const forge = (ctx: ReadCtx): RequestCtx => ctx;
    `);
    expect(codesOf(diagnostics).length).toBeGreaterThan(0);
  }, SLOW);
});
