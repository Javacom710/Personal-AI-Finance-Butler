import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Invariant **I-26** — *no calculation reads `is_active`*
 * ([ADR-26](../../docs/DECISIONS.md)).
 *
 * A **source scan**, not a behavioural test, and deliberately so. The rule it
 * enforces is that an `asOf` figure is computed from dated facts only; the
 * failure mode is that some future reader adds `is_active` to a filter because
 * the column is right there on the row and it looks like it belongs. No
 * behavioural test catches that until somebody writes the one historical
 * assertion that happens to cross a closed account.
 *
 * This is the same mechanism `TESTING.md` §7 uses to keep model identifiers out
 * of the orchestrator: assert the property over the source, where the mistake is
 * made, rather than over the output, where it is only sometimes visible.
 */

const ROOT = join(__dirname, '..', '..');

/** Files where a date-driven calculation lives, and where the flag must never appear. */
const CALCULATION_PATHS = [
  'src/server/domain/networth',
  'src/server/domain/ledger',
];

/** The net-worth read path: it may name the column only to say it is not read. */
const NET_WORTH_SERVICE = 'src/server/services/networth.ts';

function tsFilesUnder(relative: string): string[] {
  const absolute = join(ROOT, relative);
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

/** Strip comments, so prose explaining the rule does not trip the rule. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('I-26 — no calculation reads is_active', () => {
  it('finds the files it is meant to be scanning', () => {
    // A scan over an empty set passes vacuously, which is worse than no scan.
    const files = CALCULATION_PATHS.flatMap(tsFilesUnder);
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  it.each(CALCULATION_PATHS)('%s contains no reference to is_active', (path) => {
    for (const file of tsFilesUnder(path)) {
      const body = code(readFileSync(file, 'utf8'));
      expect(body, `${file} references the is_active flag`).not.toMatch(/is_?[Aa]ctive/);
    }
  });

  it('the net-worth service does not filter on is_active', () => {
    const body = code(readFileSync(join(ROOT, NET_WORTH_SERVICE), 'utf8'));
    expect(body).not.toMatch(/is_?[Aa]ctive/);
  });

  it('the net-worth service reads no date bound from a flag column', () => {
    // The positive form of the same rule: every filter it applies is a date.
    const body = code(readFileSync(join(ROOT, NET_WORTH_SERVICE), 'utf8'));
    expect(body).toMatch(/accountEligible/);
    expect(body).toMatch(/lotEligible/);
    expect(body).toMatch(/manualAssetEligible/);
    expect(body).toMatch(/inForce/);
  });

  it('the scan would catch a violation', () => {
    // Proves the matcher detects what it claims to, rather than passing because
    // the pattern never matches anything.
    const violation = code('const rows = await db.select().where(eq(accounts.isActive, true));');
    expect(violation).toMatch(/is_?[Aa]ctive/);
  });
});

/**
 * Invariant **I-32**, the structural half — `networth.ts` exports no command.
 *
 * Net worth is an aggregation, not a ledger: it opens no transaction and has
 * nothing to mutate with. A `WriteCtx` in its signature would be the first step
 * to it having one.
 */
describe('I-32 — the net-worth service is read-only', () => {
  const body = code(readFileSync(join(ROOT, NET_WORTH_SERVICE), 'utf8'));

  it('takes no WriteCtx anywhere in its signatures', () => {
    expect(body).not.toMatch(/WriteCtx/);
  });

  it('opens no transaction', () => {
    expect(body).not.toMatch(/withWriteCtx|ctx\.tx\b|\.transaction\(/);
  });

  it('writes no row', () => {
    expect(body).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
  });
});
