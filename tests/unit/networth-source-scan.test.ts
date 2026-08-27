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

/** The market-basis loader and selector — the same rule, and the stronger temptation. */
const MARKET_SERVICE = 'src/server/services/_networth-market.ts';

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

  it('the market-basis read path does not filter on is_active either', () => {
    const body = code(readFileSync(join(ROOT, MARKET_SERVICE), 'utf8'));
    expect(body).not.toMatch(/is_?[Aa]ctive/);
  });

  it('the scan would catch a violation', () => {
    // Proves the matcher detects what it claims to, rather than passing because
    // the pattern never matches anything.
    const violation = code('const rows = await db.select().where(eq(accounts.isActive, true));');
    expect(violation).toMatch(/is_?[Aa]ctive/);
  });
});

/**
 * Invariant **I-47** — *a historical figure reads no current-state cache*
 * ([ADR-06](../../docs/DECISIONS.md#adr-06--holdings-are-derived-cached-and-rebuildable),
 * [ADR-26](../../docs/DECISIONS.md#adr-26--an-as-of-financial-figure-is-computed-from-dated-facts-only-no-current-state-flag-participates)).
 *
 * I-26's mechanism, extended to the table the market basis makes tempting.
 * `positions` is today's cache with no date bound, and `positions.quantity`
 * looks **exactly** like what `quantityHeldOn` returns — which is why the design
 * names this as one of the five places Phase 6.11 could still produce a wrong
 * number. It would be right at today and wrong at every other date, so a
 * behavioural test only catches it if somebody happens to assert a past date on a
 * position that has since changed.
 */
describe('I-47 — a historical figure reads no current-state cache', () => {
  const NET_WORTH_PATHS = [
    'src/server/domain/networth',
    'src/server/domain/lots/quantity.ts',
    'src/server/services/networth.ts',
    'src/server/services/_networth-market.ts',
  ];

  function bodiesOf(relative: string): { file: string; body: string }[] {
    const absolute = join(ROOT, relative);
    const files = statSync(absolute).isDirectory() ? tsFilesUnder(relative) : [absolute];
    return files.map((file) => ({ file, body: code(readFileSync(file, 'utf8')) }));
  }

  it.each(NET_WORTH_PATHS)('%s never reads the positions cache', (path) => {
    for (const { file, body } of bodiesOf(path)) {
      // The table, in either of the two ways it can be reached: imported from
      // the drizzle schema, or named in raw SQL. A local identifier that merely
      // contains the word is not the cache and is not the rule.
      const schemaImports = body.match(/import\s*\{[^}]*\}\s*from\s*'[^']*db\/schema'/g) ?? [];
      for (const statement of schemaImports) {
        expect(statement, `${file} imports the positions table`).not.toMatch(
          /(^|[\s,{])positions([\s,}]|$)/,
        );
      }
      expect(file + ' :: ' + body, `${file} names the positions table in SQL`).not.toMatch(
        /from\s+positions\b|join\s+positions\b|\$\{positions\}/i,
      );
    }
  });

  it('the market path derives quantity from the ledger, not from a cache', () => {
    const body = code(readFileSync(join(ROOT, MARKET_SERVICE), 'utf8'));
    // The positive form: it replays `investment_transactions` and folds the
    // ratio-aware timeline. Absence of `positions` alone would also be satisfied
    // by reading nothing at all.
    expect(body).toMatch(/investmentTransactions/);
    expect(body).toMatch(/quantityHeldOn/);
    expect(body).toMatch(/replay\(/);
  });

  it('the scan would catch a violation', () => {
    const violation = code("const rows = await ctx.db.execute(sql`select * from positions`);");
    expect(violation).toMatch(/from\s+positions/i);
  });
});

/**
 * Invariant **I-39**, the structural half — *no cost fallback inside a market
 * total*.
 *
 * The failure it guards is a single plausible line: an unpriced holding falling
 * back to its cost basis so the total "looks complete". The result is a figure in
 * no basis at all — part market value, part acquisition cost — which cannot be
 * reconciled against either source and changes meaning as coverage moves
 * ([ADR-23](../../docs/DECISIONS.md)).
 *
 * The scan asserts the *shape* of the market builder: every branch that fails to
 * resolve a price emits an `excluded` reason, and none of them emits a `price`
 * or an `fx` alongside a cost figure.
 */
describe('I-39 — an unpriced holding is excluded, never cost-substituted', () => {
  const body = code(readFileSync(join(ROOT, NET_WORTH_SERVICE), 'utf8'));
  const builder = body.slice(body.indexOf('function marketPositions'));

  it('finds the market builder it is meant to be scanning', () => {
    expect(builder.length).toBeGreaterThan(500);
  });

  it('every unresolved branch excludes with a reason', () => {
    // Each `fx: null` in the builder — the "cannot be valued" shape — is paired
    // with an `excluded:` member on the same object literal.
    const unresolved = builder.match(/fx: null,\s+excluded: /g) ?? [];
    const nulls = builder.match(/fx: null,/g) ?? [];
    expect(unresolved.length).toBe(nulls.length);
    expect(nulls.length).toBeGreaterThanOrEqual(2);
  });

  it('never emits a priced contribution built from a cost figure', () => {
    // `valueOf(quantity, price, …)` is the ONLY way a market contribution's
    // `native` is produced. A `baseMinor` reaching a contribution's `native`
    // outside an `excluded` branch would be the fallback this forbids.
    const contributions = builder.split('excluded:');
    const priced = contributions[contributions.length - 1] ?? '';
    expect(priced).toMatch(/native: valueOf\(quantity, resolved\.price/);
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
