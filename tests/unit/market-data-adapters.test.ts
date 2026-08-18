/**
 * Adapter contract tests — [TESTING.md §6](../../docs/TESTING.md#6-market-data-contract-tests).
 *
 * Every adapter must survive all seven failure modes without throwing: normal,
 * empty, malformed, HTTP 500, HTTP 429, timeout, and an unknown symbol.
 * `ROADMAP.md` Phase 6 makes that a completion gate, and it is checked here for
 * both shipping adapters.
 *
 * **No test touches the network.** `fetch` is injected, so a fixture is replayed
 * and an adapter that tried to reach out would fail loudly rather than quietly
 * making CI depend on a third party.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/date';
import { currency } from '@/lib/decimal/money';
import { pToDbString } from '@/lib/decimal/price';
import { rToDbString } from '@/lib/decimal/rate';
import {
  buildIndex,
  createAmfiProvider,
  navObservedAt,
  parseAmfiDate,
  parseNavAll,
} from '@/server/market-data/providers/amfi';
import {
  createFrankfurterProvider,
  rateFromJsonNumber,
} from '@/server/market-data/providers/frankfurter';
import { createManualProvider } from '@/server/market-data/providers/manual';
import { pairKey, refKey, type ProviderRef } from '@/server/market-data/types';
import type { FetchLike } from '@/server/market-data/http';

const INR = currency('INR');
const USD = currency('USD');

const NAV_ALL = readFileSync(
  path.join(process.cwd(), 'tests/fixtures/market-data/navall-sample.txt'),
  'utf8',
);

// ------------------------------------------------------------- fetch doubles

function respondWith(body: string, status = 200, headers: Record<string, string> = {}): FetchLike {
  return async () =>
    new Response(body, { status, headers: { 'content-type': 'text/plain', ...headers } });
}

const failsIfCalled: FetchLike = () => {
  throw new Error('the network must not be reached in a unit test');
};

const timesOut: FetchLike = (_url, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  });

const fund = (over: Partial<ProviderRef> = {}): ProviderRef => ({
  instrumentId: '11111111-1111-1111-1111-111111111111',
  providerSymbol: '119551',
  exchange: null,
  isin: null,
  currency: INR,
  assetClass: 'mutual_fund',
  ...over,
});

// ------------------------------------------------------------------- AMFI

describe('AMFI — date parsing', () => {
  it('reads the DD-MMM-YYYY form', () => {
    expect(parseAmfiDate('17-Aug-2026')).toBe('2026-08-17');
    expect(parseAmfiDate('1-Jan-2026')).toBe('2026-01-01');
    expect(parseAmfiDate(' 29-Feb-2028 ')).toBe('2028-02-29'); // a real leap day
  });

  it('rejects rather than guesses', () => {
    expect(parseAmfiDate('N.A.')).toBeNull();
    expect(parseAmfiDate('2026-08-17')).toBeNull();
    expect(parseAmfiDate('17-Xxx-2026')).toBeNull();
    expect(parseAmfiDate('')).toBeNull();
    // 29 February in a non-leap year is a plausible-looking wrong date, which is
    // exactly the kind that must not survive into a price series.
    expect(parseAmfiDate('29-Feb-2027')).toBeNull();
    expect(parseAmfiDate('31-Feb-2026')).toBeNull();
  });
});

describe('AMFI — parsing NAVAll.txt', () => {
  const parsed = parseNavAll(NAV_ALL);

  it('skips headings, blank lines and AMC names without erroring', () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // 5 data lines, of which one is `N.A.` and therefore skipped.
    expect(parsed.value).toHaveLength(4);
  });

  it('keeps every digit of a NAV, parsing it as a string', () => {
    if (!parsed.ok) return;
    const top100 = parsed.value.find((r) => r.schemeCode === '118989');
    expect(top100).toBeDefined();
    // Scale 8 exactly — a `Money` read would have truncated this to 1234.5679.
    expect(pToDbString(top100!.nav)).toBe('1234.56789012');
  });

  it('treats an N.A. NAV as absent, never as zero', () => {
    if (!parsed.ok) return;
    expect(parsed.value.find((r) => r.schemeCode === '118990')).toBeUndefined();
  });

  it('normalises ISINs and tolerates a missing one', () => {
    if (!parsed.ok) return;
    const noIsin = parsed.value.find((r) => r.schemeCode === '118991');
    expect(noIsin?.isinPayout).toBeNull();
    expect(noIsin?.isinReinvest).toBeNull();

    const withIsin = parsed.value.find((r) => r.schemeCode === '119551');
    expect(withIsin?.isinPayout).toBe('INF209K01YM2');
  });

  it('survives CRLF line endings and a truncated final line', () => {
    const crlf = NAV_ALL.replace(/\n/g, '\r\n') + '\r\n118992;INF1;INF2;Truncated';
    const result = parseNavAll(crlf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(4); // the truncated line has too few fields
  });

  it('rejects a malformed NAV rather than truncating it', () => {
    // Nine decimals — one more than UnitPrice holds.
    const line = '119999;INF1;INF2;Too Precise;12.345678901;17-Aug-2026';
    const result = parseNavAll(`${line}\n`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('malformed');
  });

  it('rejects an unparseable date rather than defaulting it', () => {
    const line = '119999;INF1;INF2;Bad Date;12.3456;32-Aug-2026';
    const result = parseNavAll(`${line}\n`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('malformed');
  });

  it('indexes by ISIN and by scheme code', () => {
    if (!parsed.ok) return;
    const index = buildIndex(parsed.value);
    expect(index.byIsin.get('INF209K01YM2')?.schemeCode).toBe('119551');
    expect(index.byIsin.get('INF209K01YN0')?.schemeCode).toBe('119551');
    expect(index.bySchemeCode.get('118989')?.schemeName).toContain('HDFC Top 100');
  });
});

describe('AMFI — observation instants', () => {
  it('dates a NAV from the day it was true, not the day it was fetched', () => {
    const at = navObservedAt(isoDate('2026-08-14'));
    expect(at.toISOString()).toBe('2026-08-14T12:30:00.000Z');
  });
});

describe('AMFI — the seven failure modes', () => {
  const ref = fund({ isin: 'INF209K01YM2' });

  it('normal response — one observation, in INR, dated by the file', async () => {
    const provider = createAmfiProvider({ fetch: respondWith(NAV_ALL) });
    const result = await provider.getLatestPrices!([ref]);
    const observation = result.get(refKey(ref));
    expect(observation?.ok).toBe(true);
    if (!observation?.ok) return;
    expect(observation.value.currency).toBe(INR);
    expect(observation.value.tradingDate).toBe('2026-08-17');
    expect(observation.value.kind).toBe('nav');
    expect(observation.value.source).toBe('amfi');
    expect(observation.value.providerRef).toBe('119551');
    expect(pToDbString(observation.value.close)).toBe('349.51360000');
  });

  it('empty response — not_found, not a crash', async () => {
    const provider = createAmfiProvider({ fetch: respondWith('') });
    const result = await provider.getLatestPrices!([ref]);
    expect(result.get(refKey(ref))?.ok).toBe(false);
  });

  it('malformed response — malformed, and nothing usable escapes', async () => {
    const provider = createAmfiProvider({ fetch: respondWith('119551;a;b;c;NOT-A-NUMBER;17-Aug-2026') });
    const result = await provider.getLatestPrices!([ref]);
    const observation = result.get(refKey(ref));
    expect(observation?.ok).toBe(false);
    if (observation?.ok) return;
    expect(observation?.error.kind).toBe('malformed');
  });

  it('HTTP 500 — transport, which is transient and worth retrying', async () => {
    const provider = createAmfiProvider({ fetch: respondWith('boom', 500) });
    const result = await provider.getLatestPrices!([ref]);
    const observation = result.get(refKey(ref));
    expect(observation?.ok).toBe(false);
    if (observation?.ok) return;
    expect(observation?.error.kind).toBe('transport');
  });

  it('HTTP 429 — rate_limited, carrying retry-after when the server sends it', async () => {
    const provider = createAmfiProvider({
      fetch: respondWith('slow down', 429, { 'retry-after': '120' }),
    });
    const result = await provider.getLatestPrices!([ref]);
    const observation = result.get(refKey(ref));
    expect(observation?.ok).toBe(false);
    if (observation?.ok) return;
    expect(observation?.error.kind).toBe('rate_limited');
    if (observation?.error.kind !== 'rate_limited') return;
    expect(observation.error.retryAfterSeconds).toBe(120);
  });

  it('timeout — transport, and the abort is honoured', async () => {
    const provider = createAmfiProvider({ fetch: timesOut, timeoutMs: 10 });
    const result = await provider.getLatestPrices!([ref]);
    const observation = result.get(refKey(ref));
    expect(observation?.ok).toBe(false);
    if (observation?.ok) return;
    expect(observation?.error.kind).toBe('transport');
  });

  it('unknown symbol — not_found, distinct from a provider outage', async () => {
    const stranger = fund({ instrumentId: 'x', providerSymbol: '000000', isin: 'INXXXXXXXXX9' });
    const provider = createAmfiProvider({ fetch: respondWith(NAV_ALL) });
    const result = await provider.getLatestPrices!([stranger]);
    const observation = result.get(refKey(stranger));
    expect(observation?.ok).toBe(false);
    if (observation?.ok) return;
    expect(observation?.error.kind).toBe('not_found');
  });
});

describe('AMFI — support and capabilities', () => {
  const provider = createAmfiProvider({ fetch: failsIfCalled });

  it('claims only Indian mutual funds', () => {
    expect(provider.supports(fund())).toBe(true);
    expect(provider.supports(fund({ assetClass: 'equity' }))).toBe(false);
    expect(provider.supports(fund({ currency: USD }))).toBe(false);
  });

  it('needs no credential — which is why it needs no configuration', () => {
    expect(provider.capabilities.requiresCredential).toBe(false);
    expect(provider.capabilities.cadence).toBe('nav');
    expect(provider.capabilities.assetClasses).toEqual(['mutual_fund']);
  });
});

// ------------------------------------------------------------- Frankfurter

describe('Frankfurter — rate parsing', () => {
  it('accepts a plausible rate and stores it at RATE_SCALE', () => {
    const rate = rateFromJsonNumber(95.61);
    expect(rate.ok).toBe(true);
    if (!rate.ok) return;
    expect(rToDbString(rate.value)).toBe('95.6100000000');
  });

  it('rejects anything that is not a positive finite number', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '95.61', null, undefined]) {
      expect(rateFromJsonNumber(bad).ok, String(bad)).toBe(false);
    }
  });

  it('rejects an implausibly large rate rather than storing it', () => {
    expect(rateFromJsonNumber(1e12).ok).toBe(false);
  });

  it('rounds a double once, at the storage scale, rather than rejecting it', () => {
    // 0.1 + 0.2 is the classic 17-significant-digit double. It is a legitimate
    // rate; rejecting it would lose real data for a representation artefact.
    const rate = rateFromJsonNumber(0.1 + 0.2);
    expect(rate.ok).toBe(true);
    if (!rate.ok) return;
    expect(rToDbString(rate.value)).toBe('0.3000000000');
  });
});

describe('Frankfurter — the seven failure modes', () => {
  const pair = { base: USD, quote: INR };
  const body = JSON.stringify({ amount: 1.0, base: 'USD', date: '2026-08-17', rates: { INR: 95.61 } });

  it('normal response — the returned date is recorded, not the date requested', async () => {
    const provider = createFrankfurterProvider({ fetch: respondWith(body) });
    // Ask for a Sunday; reference rates publish on business days.
    const result = await provider.getFxRates!([pair], isoDate('2026-08-16'));
    const observation = result.get(pairKey(pair));
    expect(observation?.ok).toBe(true);
    if (!observation?.ok) return;
    expect(observation.value.asOf).toBe('2026-08-17');
    expect(rToDbString(observation.value.rate)).toBe('95.6100000000');
    expect(observation.value.source).toBe('frankfurter');
  });

  it('empty response — malformed, never a silently absent rate', async () => {
    const provider = createFrankfurterProvider({ fetch: respondWith('') });
    const result = await provider.getFxRates!([pair]);
    const observation = result.get(pairKey(pair));
    expect(observation?.ok).toBe(false);
    if (observation?.ok) return;
    expect(observation?.error.kind).toBe('malformed');
  });

  it('malformed JSON — malformed', async () => {
    const provider = createFrankfurterProvider({ fetch: respondWith('{"base":"USD",') });
    const result = await provider.getFxRates!([pair]);
    expect(result.get(pairKey(pair))?.ok).toBe(false);
  });

  it('a response for the wrong base is rejected, not trusted', async () => {
    const wrongBase = JSON.stringify({ base: 'EUR', date: '2026-08-17', rates: { INR: 104 } });
    const provider = createFrankfurterProvider({ fetch: respondWith(wrongBase) });
    const result = await provider.getFxRates!([pair]);
    const observation = result.get(pairKey(pair));
    expect(observation?.ok).toBe(false);
    if (observation?.ok) return;
    expect(observation?.error.kind).toBe('malformed');
  });

  it('HTTP 500 — transport', async () => {
    const provider = createFrankfurterProvider({ fetch: respondWith('boom', 500) });
    const result = await provider.getFxRates!([pair]);
    const observation = result.get(pairKey(pair));
    expect(observation?.ok === false && observation.error.kind).toBe('transport');
  });

  it('HTTP 429 — rate_limited', async () => {
    const provider = createFrankfurterProvider({ fetch: respondWith('slow', 429) });
    const result = await provider.getFxRates!([pair]);
    const observation = result.get(pairKey(pair));
    expect(observation?.ok === false && observation.error.kind).toBe('rate_limited');
  });

  it('timeout — transport', async () => {
    const provider = createFrankfurterProvider({ fetch: timesOut, timeoutMs: 10 });
    const result = await provider.getFxRates!([pair]);
    const observation = result.get(pairKey(pair));
    expect(observation?.ok === false && observation.error.kind).toBe('transport');
  });

  it('unknown currency — not_found for that pair alone', async () => {
    const partial = JSON.stringify({ base: 'USD', date: '2026-08-17', rates: { INR: 95.61 } });
    const provider = createFrankfurterProvider({ fetch: respondWith(partial) });
    const zwl = { base: USD, quote: currency('ZWL') };
    const result = await provider.getFxRates!([pair, zwl]);
    expect(result.get(pairKey(pair))?.ok).toBe(true);
    const missing = result.get(pairKey(zwl));
    expect(missing?.ok === false && missing.error.kind).toBe('not_found');
  });

  it('does not fetch an identity pair', async () => {
    const provider = createFrankfurterProvider({ fetch: failsIfCalled });
    const identity = { base: INR, quote: INR };
    const result = await provider.getFxRates!([identity]);
    // `selectRate` answers X→X without a lookup; storing a 1.0 row would be noise.
    expect(result.get(pairKey(identity))?.ok).toBe(false);
  });

  it('needs no credential', () => {
    const provider = createFrankfurterProvider({ fetch: failsIfCalled });
    expect(provider.capabilities.requiresCredential).toBe(false);
    expect(provider.capabilities.provides).toContain('fx');
  });
});

// ------------------------------------------------------------------ manual

describe('manual provider', () => {
  const provider = createManualProvider();

  it('claims every asset class, which is what makes it the universal floor', () => {
    for (const assetClass of ['equity', 'mutual_fund', 'gold', 'crypto', 'other'] as const) {
      expect(provider.supports(fund({ assetClass }))).toBe(true);
    }
  });

  it('fetches nothing — a typed price is already stored', () => {
    expect(provider.getLatestPrices).toBeUndefined();
    expect(provider.capabilities.requiresCredential).toBe(false);
  });
});
