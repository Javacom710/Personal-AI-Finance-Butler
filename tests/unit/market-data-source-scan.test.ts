import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Source scans for the Phase 6 boundaries.
 *
 * Three rules here are architectural rather than behavioural, and each fails in
 * a way no output assertion catches until it is too late:
 *
 * - **I-40** â€” no provider or job writes the investment ledger
 *   ([ADR-29](../../docs/DECISIONS.md)). A behavioural test only catches this
 *   once somebody writes the one scenario that happens to cross a split.
 * - **ADR-27** â€” an adapter returns observations, never a freshness verdict. The
 *   failure mode is a future adapter author deciding `'stale'` locally, and the
 *   system then having N freshness policies instead of one.
 * - **Provider isolation** â€” nothing outside `providers/` names a provider. The
 *   whole point of the abstraction is that swapping a provider is one file plus
 *   one registry line, and that stops being true the moment a service imports an
 *   adapter directly.
 *
 * Same mechanism `networth-source-scan.test.ts` uses for I-26, and `TESTING.md`
 * Â§7 uses to keep model identifiers out of the orchestrator: assert the property
 * over the source, where the mistake is made.
 */

const ROOT = join(__dirname, '..', '..');

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

const read = (file: string) => readFileSync(file, 'utf8');
const relative = (file: string) => file.slice(ROOT.length + 1).replace(/\\/g, '/');

/** Strip block and line comments, so prose about a rule never trips the rule. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('I-40 â€” no provider and no job writes the investment ledger', () => {
  const marketDataFiles = tsFilesUnder('src/server/market-data');
  const jobFiles = tsFilesUnder('src/server/jobs');

  it('nothing under market-data/ mentions investmentTransactions at all', () => {
    for (const file of marketDataFiles) {
      expect(code(read(file)), `${relative(file)} must not touch the ledger`).not.toMatch(
        /investmentTransactions|investment_transactions/,
      );
    }
  });

  it('no job handler writes an investment transaction', () => {
    for (const file of jobFiles) {
      const body = code(read(file));
      expect(body, `${relative(file)} must not insert into the ledger`).not.toMatch(
        /insert\s*\(\s*investmentTransactions|into\s+investment_transactions/,
      );
    }
  });

  it('only the investment service may set resolved_txn_id on a detection', () => {
    const allowed = new Set(['src/server/services/investments.ts']);
    for (const file of [
      ...marketDataFiles,
      ...jobFiles,
      ...tsFilesUnder('src/server/services'),
    ]) {
      const path = relative(file);
      if (allowed.has(path)) continue;
      expect(code(read(file)), `${path} must not stamp resolvedTxnId`).not.toMatch(
        /resolvedTxnId\s*:/,
      );
    }
  });

  it('the market-data service says so in its own words, so the rule is discoverable', () => {
    // Not a behavioural claim â€” a documentation guard. Someone reading the file
    // to add a feature should meet the rule before they meet the schema.
    const service = read(join(ROOT, 'src/server/services/market-data.ts'));
    expect(service).toMatch(/ADR-29/);
    expect(service).toMatch(/never as a ledger row|never a ledger|never writes to `investment_transactions`/i);
  });
});

describe('ADR-27 â€” adapters report observations, not verdicts', () => {
  const providerFiles = tsFilesUnder('src/server/market-data/providers');

  it('has at least the adapters this phase ships', () => {
    const names = providerFiles.map((f) => relative(f));
    expect(names).toEqual(
      expect.arrayContaining([
        'src/server/market-data/providers/manual.ts',
        'src/server/market-data/providers/amfi.ts',
        'src/server/market-data/providers/frankfurter.ts',
      ]),
    );
  });

  it('no adapter classifies freshness', () => {
    for (const file of providerFiles) {
      const body = code(read(file));
      for (const verdict of ["'stale'", "'cached'", "'live'", "'recent'"]) {
        expect(body, `${relative(file)} must not decide ${verdict}`).not.toContain(verdict);
      }
    }
  });

  it('no adapter imports the freshness classifier or PriceResult', () => {
    for (const file of providerFiles) {
      const body = code(read(file));
      expect(body, `${relative(file)} must not import freshness`).not.toMatch(/from '\.\.\/freshness'/);
      expect(body, `${relative(file)} must not import PriceResult`).not.toMatch(/price-result/);
    }
  });
});

describe('provider isolation', () => {
  const PROVIDER_NAMES = [/\bamfi\b/i, /\bfrankfurter\b/i, /twelve[\s_-]*data/i];

  /**
   * The only files allowed to name a provider.
   *
   * `src/lib/env.ts` is on the list because it declares `TWELVE_DATA_API_KEY`,
   * and an environment schema that cannot name the variable it validates is not
   * a schema. Naming the variable is not the leak; **reading its value** outside
   * the composition root is, and that is asserted separately below.
   */
  const ALLOWED = [
    'src/server/market-data/providers/',
    'src/server/market-data/index.ts',
    'src/server/market-data/types.ts',
    'src/lib/env.ts',
  ];

  function isAllowed(path: string): boolean {
    return ALLOWED.some((prefix) => path.startsWith(prefix));
  }

  it('no file outside providers/ and the registry entry point names a provider', () => {
    const files = [
      ...tsFilesUnder('src/server'),
      ...tsFilesUnder('src/lib'),
      ...tsFilesUnder('app'),
    ];

    for (const file of files) {
      const path = relative(file);
      if (isAllowed(path)) continue;
      const body = code(read(file));
      for (const name of PROVIDER_NAMES) {
        expect(body, `${path} must not name a market-data provider`).not.toMatch(name);
      }
    }
  });

  it('no adapter reads the environment â€” a key is injected, never fetched', () => {
    // The credential is resolved once, in the composition root, and passed in.
    // An adapter that read `process.env` itself would be untestable without
    // mutating global state, and would put a second place to look for a leak.
    for (const file of tsFilesUnder('src/server/market-data')) {
      const path = relative(file);
      if (path === 'src/server/market-data/index.ts') continue; // the composition root
      expect(code(read(file)), `${path} must not read the environment`).not.toMatch(
        /process\.env|serverEnv|\benv\(\)/,
      );
    }
  });

  it('the credential-free adapters declare it, and read no secret', () => {
    for (const name of ['amfi', 'frankfurter', 'manual']) {
      const body = read(join(ROOT, `src/server/market-data/providers/${name}.ts`));
      expect(body, `${name} must declare requiresCredential: false`).toMatch(
        /requiresCredential:\s*false/,
      );
      expect(code(body), `${name} must not read a secret`).not.toMatch(/process\.env|API_KEY|apiKey/);
    }
  });

  it('TWELVE_DATA_API_KEY is named only where declared, injected, or explained', () => {
    // Three legitimate mentions, and no fourth:
    //   env.ts        declares and validates it
    //   index.ts      reads it once and injects it
    //   twelvedata.ts names it in the message shown when it is unset, which is
    //                 the entire point of that message
    //
    // Naming it is not the security property. **Reading its value** outside the
    // composition root is, and the environment scan above asserts that.
    const allowed = new Set([
      'src/lib/env.ts',
      'src/server/market-data/index.ts',
      'src/server/market-data/providers/twelvedata.ts',
    ]);
    const searched = [
      ...tsFilesUnder('src/server'),
      ...tsFilesUnder('src/lib'),
      ...tsFilesUnder('app'),
    ];

    const found: string[] = [];
    for (const file of searched) {
      if (read(file).includes('TWELVE_DATA_API_KEY')) found.push(relative(file));
    }

    for (const path of found) {
      expect(allowed.has(path), `${path} must not name the credential`).toBe(true);
    }
    // Present, not merely absent â€” a rename that silently dropped the wiring
    // would otherwise pass this test.
    expect(found).toContain('src/server/market-data/index.ts');
  });

  it('the equity adapter declares that it needs a credential, and never logs one', () => {
    const body = read(join(ROOT, 'src/server/market-data/providers/twelvedata.ts'));
    expect(body).toMatch(/requiresCredential:\s*true/);
    expect(code(body), 'must not read the environment').not.toMatch(/process\.env|\benv\(\)/);
    // The key is a query parameter, so a message quoting a URL would leak it.
    // Failures name the field or the provider code, never the request.
    expect(code(body), 'no failure message may embed the request URL').not.toMatch(
      /failure\.\w+\(`[^`]*\$\{(target|url)\b/,
    );
  });
});

describe('read paths make no network call', () => {
  it('the price read path does not import the registry or an adapter', () => {
    // `services/prices.ts` reads what refresh jobs stored. If it could fetch,
    // a page render would depend on a third party being up.
    const body = code(read(join(ROOT, 'src/server/services/prices.ts')));
    expect(body).not.toMatch(/defaultRegistry|createRegistry|providers\//);
    expect(body).not.toMatch(/\bfetch\s*\(/);
  });

  it('no page or component imports the market-data layer', () => {
    for (const file of tsFilesUnder('app')) {
      expect(code(read(file)), `${relative(file)} must not reach market data`).not.toMatch(
        /market-data/,
      );
    }
  });
});
