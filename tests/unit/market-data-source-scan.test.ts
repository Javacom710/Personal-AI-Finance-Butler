import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Source scans for the Phase 6 boundaries.
 *
 * Three rules here are architectural rather than behavioural, and each fails in
 * a way no output assertion catches until it is too late:
 *
 * - **I-40** — no provider or job writes the investment ledger
 *   ([ADR-29](../../docs/DECISIONS.md)). A behavioural test only catches this
 *   once somebody writes the one scenario that happens to cross a split.
 * - **ADR-27** — an adapter returns observations, never a freshness verdict. The
 *   failure mode is a future adapter author deciding `'stale'` locally, and the
 *   system then having N freshness policies instead of one.
 * - **Provider isolation** — nothing outside `providers/` names a provider. The
 *   whole point of the abstraction is that swapping a provider is one file plus
 *   one registry line, and that stops being true the moment a service imports an
 *   adapter directly.
 *
 * Same mechanism `networth-source-scan.test.ts` uses for I-26, and `TESTING.md`
 * §7 uses to keep model identifiers out of the orchestrator: assert the property
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

describe('I-40 — no provider and no job writes the investment ledger', () => {
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
    // Not a behavioural claim — a documentation guard. Someone reading the file
    // to add a feature should meet the rule before they meet the schema.
    const service = read(join(ROOT, 'src/server/services/market-data.ts'));
    expect(service).toMatch(/ADR-29/);
    expect(service).toMatch(/never as a ledger row|never a ledger|never writes to `investment_transactions`/i);
  });
});

describe('ADR-27 — adapters report observations, not verdicts', () => {
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
  const PROVIDER_NAMES = [/\bamfi\b/i, /\bfrankfurter\b/i, /\btwelvedata\b/i, /twelve\s*data/i];

  /** The only files allowed to name a provider. */
  const ALLOWED = [
    'src/server/market-data/providers/',
    'src/server/market-data/index.ts',
    'src/server/market-data/types.ts',
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

  it('no provider credential is read outside providers/', () => {
    // The two adapters this phase ships need none. The future equity adapter
    // reads its own inside providers/, never above (SECURITY.md).
    for (const file of tsFilesUnder('src/server/market-data')) {
      const path = relative(file);
      if (path.startsWith('src/server/market-data/providers/')) continue;
      expect(code(read(file)), `${path} must not read the environment`).not.toMatch(/process\.env|serverEnv/);
    }
  });

  it('the shipping adapters require no credential at all', () => {
    for (const name of ['amfi', 'frankfurter', 'manual']) {
      const body = read(join(ROOT, `src/server/market-data/providers/${name}.ts`));
      expect(body, `${name} must declare requiresCredential: false`).toMatch(
        /requiresCredential:\s*false/,
      );
      expect(code(body), `${name} must not read a secret`).not.toMatch(/process\.env|API_KEY|apiKey/);
    }
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
