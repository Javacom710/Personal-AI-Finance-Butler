/**
 * Twelve Data adapter — deterministic contract tests.
 *
 * Every case replays a recorded fixture through an injected `fetch`. **Nothing
 * here touches the network and nothing reads the environment**, so the suite is
 * identical on a machine with a key and one without — which is the property that
 * lets CI run it at all.
 *
 * The provider quirk these tests exist for: Twelve Data signals failure in the
 * *body* (`{"status":"error","code":429,…}`) and does not reliably set a matching
 * HTTP status. A test suite that only exercised HTTP statuses would pass while
 * the adapter read a rate-limit refusal as a successful empty response.
 */

import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/date';
import { currency } from '@/lib/decimal/money';
import { pToDbString } from '@/lib/decimal/price';
import {
  createTwelveDataProvider,
  parsePrice,
  parseSplitRatio,
  providerError,
} from '@/server/market-data/providers/twelvedata';
import { exchangeCloseInstant, resolveMic, XBOM, XNAS, XNSE } from '@/server/market-data/exchanges';
import { refKey, type ProviderRef } from '@/server/market-data/types';
import type { FetchLike } from '@/server/market-data/http';

const INR = currency('INR');
const USD = currency('USD');

const KEY = 'test-key-not-a-real-credential';

// ------------------------------------------------------------- fetch doubles

/** Captures the URLs requested, so parameter mapping can be asserted. */
function recording(body: string, status = 200, headers: Record<string, string> = {}) {
  const urls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    urls.push(url);
    return new Response(body, { status, headers: { 'content-type': 'application/json', ...headers } });
  };
  return { urls, fetchImpl };
}

const failsIfCalled: FetchLike = () => {
  throw new Error('the network must not be reached');
};

const timesOut: FetchLike = (_url, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  });

const networkDown: FetchLike = async () => {
  throw new TypeError('fetch failed');
};

const equity = (over: Partial<ProviderRef> = {}): ProviderRef => ({
  instrumentId: 'i-infy',
  providerSymbol: 'INFY',
  exchange: XNSE,
  isin: 'INE009A01021',
  currency: INR,
  assetClass: 'equity',
  ...over,
});

// ---------------------------------------------------------------- fixtures

const QUOTE_NSE = JSON.stringify({
  symbol: 'INFY',
  name: 'Infosys Ltd',
  exchange: 'NSE',
  mic_code: 'XNSE',
  currency: 'INR',
  datetime: '2026-08-17',
  timestamp: 1755423000,
  open: '1580.00000000',
  high: '1599.50000000',
  low: '1575.10000000',
  close: '1592.35000000',
  previous_close: '1578.90000000',
  is_market_open: false,
});

const TIME_SERIES_NSE = JSON.stringify({
  meta: {
    symbol: 'INFY',
    interval: '1day',
    currency: 'INR',
    exchange_timezone: 'Asia/Kolkata',
    exchange: 'NSE',
    mic_code: 'XNSE',
    type: 'Common Stock',
  },
  values: [
    { datetime: '2026-08-13', open: '1560.00', high: '1572.00', low: '1558.00', close: '1570.25000000', volume: '4821000' },
    { datetime: '2026-08-14', open: '1571.00', high: '1585.00', low: '1569.00', close: '1578.90000000', volume: '5120400' },
    { datetime: '2026-08-17', open: '1580.00', high: '1599.50', low: '1575.10', close: '1592.35000000', volume: '6033100' },
  ],
  status: 'ok',
});

const SPLITS_NSE = JSON.stringify({
  meta: { symbol: 'INFY', currency: 'INR', exchange: 'NSE', mic_code: 'XNSE', type: 'Common Stock' },
  splits: [{ date: '2026-06-01', from_factor: 1, to_factor: 5 }],
});

const errorBody = (code: number, message: string) =>
  JSON.stringify({ code, message, status: 'error' });

// ------------------------------------------------------------------- 1, 15

describe('1 — instrument lookup', () => {
  it('resolves reference data for a supported instrument', async () => {
    const { fetchImpl, urls } = recording(QUOTE_NSE);
    const provider = createTwelveDataProvider({ fetch: fetchImpl, apiKey: KEY });

    const result = await provider.getInstrument!(equity());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe('Infosys Ltd');
    expect(result.value.currency).toBe(INR);
    expect(result.value.exchange).toBe(XNSE);
    expect(urls[0]).toContain('/quote?');
  });
});

describe('15 — unsupported instrument', () => {
  const provider = createTwelveDataProvider({ fetch: failsIfCalled, apiKey: KEY });

  it('claims equities and ETFs only', () => {
    expect(provider.supports(equity())).toBe(true);
    expect(provider.supports(equity({ assetClass: 'etf' }))).toBe(true);
    expect(provider.supports(equity({ assetClass: 'mutual_fund' }))).toBe(false);
    expect(provider.supports(equity({ assetClass: 'crypto' }))).toBe(false);
    expect(provider.supports(equity({ assetClass: 'gold' }))).toBe(false);
  });

  it('refuses an instrument with no resolvable exchange, rather than guessing', async () => {
    // `INFY` without a venue could be the NSE listing or a same-named foreign
    // one. Pricing the wrong security is worse than pricing nothing.
    expect(provider.supports(equity({ exchange: null }))).toBe(false);

    const result = await provider.getLatestPrices!([equity({ exchange: null })]);
    const observation = result.get(refKey(equity({ exchange: null })));
    expect(observation?.ok).toBe(false);
    if (observation?.ok) return;
    expect(observation?.error.kind).toBe('unsupported');
  });
});

// ---------------------------------------------------------------- 2, 3, 4

describe('2, 3, 4 — exchange mapping', () => {
  it('maps the labels a user actually types onto MICs', () => {
    expect(resolveMic('NSE')).toBe(XNSE);
    expect(resolveMic('nse')).toBe(XNSE);
    expect(resolveMic('BSE')).toBe(XBOM);
    expect(resolveMic('NASDAQ')).toBe(XNAS);
    expect(resolveMic('XNSE')).toBe(XNSE); // a MIC passes through
  });

  it('returns null for anything ambiguous or unknown — never a guess', () => {
    for (const unknown of ['', '   ', 'SSE', 'MYEXCHANGE', 'XXXX', null, undefined]) {
      expect(resolveMic(unknown), String(unknown)).toBeNull();
    }
  });

  it('sends mic_code=XNSE for an NSE instrument', async () => {
    const { fetchImpl, urls } = recording(QUOTE_NSE);
    const provider = createTwelveDataProvider({ fetch: fetchImpl, apiKey: KEY });
    await provider.getLatestPrices!([equity()]);
    expect(urls[0]).toContain('mic_code=XNSE');
    expect(urls[0]).toContain('symbol=INFY');
  });

  it('sends mic_code=XBOM for a BSE instrument', async () => {
    const body = JSON.stringify({ ...JSON.parse(QUOTE_NSE), mic_code: 'XBOM', exchange: 'BSE' });
    const { fetchImpl, urls } = recording(body);
    const provider = createTwelveDataProvider({ fetch: fetchImpl, apiKey: KEY });
    await provider.getLatestPrices!([equity({ instrumentId: 'i-bse', exchange: XBOM })]);
    expect(urls[0]).toContain('mic_code=XBOM');
  });

  it('supports an international venue with its own close time', async () => {
    const body = JSON.stringify({
      symbol: 'AAPL', name: 'Apple Inc', exchange: 'NASDAQ', mic_code: 'XNAS',
      currency: 'USD', datetime: '2026-08-17', close: '231.44000000',
    });
    const { fetchImpl, urls } = recording(body);
    const provider = createTwelveDataProvider({ fetch: fetchImpl, apiKey: KEY });
    const ref = equity({ instrumentId: 'i-aapl', providerSymbol: 'AAPL', exchange: XNAS, currency: USD });

    const result = await provider.getLatestPrices!([ref]);
    expect(urls[0]).toContain('mic_code=XNAS');
    const observation = result.get(refKey(ref));
    expect(observation?.ok).toBe(true);
    if (!observation?.ok) return;
    // 16:00 America/New_York on 17 Aug 2026 is 20:00 UTC (EDT, UTC−4).
    expect(observation.value.observedAt.toISOString()).toBe('2026-08-17T20:00:00.000Z');
  });
});

// ------------------------------------------------------------------ 5, 7, 8

describe('5, 7, 8 — latest price, precision and timestamps', () => {
  it('returns a normalized observation with exact price digits', async () => {
    const { fetchImpl } = recording(QUOTE_NSE);
    const provider = createTwelveDataProvider({ fetch: fetchImpl, apiKey: KEY });

    const result = await provider.getLatestPrices!([equity()]);
    const observation = result.get('i-infy');
    expect(observation?.ok).toBe(true);
    if (!observation?.ok) return;

    // Scale 8, parsed from the provider's own string — no double in the path.
    expect(pToDbString(observation.value.close)).toBe('1592.35000000');
    expect(observation.value.currency).toBe(INR);
    expect(observation.value.kind).toBe('eod');
    expect(observation.value.source).toBe('twelvedata:XNSE');
    expect(observation.value.providerRef).toBe('INFY');
  });

  it('dates the observation by the session, and stamps the exchange close', async () => {
    const { fetchImpl } = recording(QUOTE_NSE);
    const provider = createTwelveDataProvider({ fetch: fetchImpl, apiKey: KEY });
    const result = await provider.getLatestPrices!([equity()]);
    const observation = result.get('i-infy');
    if (!observation?.ok) return;

    expect(observation.value.tradingDate).toBe('2026-08-17');
    // 15:30 Asia/Kolkata = 10:00 UTC. Not midnight, and never the fetch time.
    expect(observation.value.observedAt.toISOString()).toBe('2026-08-17T10:00:00.000Z');
  });

  it('requests eight decimal places, matching NUMERIC(20,8)', async () => {
    const { fetchImpl, urls } = recording(QUOTE_NSE);
    const provider = createTwelveDataProvider({ fetch: fetchImpl, apiKey: KEY });
    await provider.getLatestPrices!([equity()]);
    expect(urls[0]).toContain('dp=8');
  });

  it('rejects a price with more precision than UnitPrice holds', () => {
    expect(parsePrice('1592.350000001', 'close').ok).toBe(false);
    expect(parsePrice('1592.35000000', 'close').ok).toBe(true);
  });

  it('rejects a non-string, empty or negative price rather than coercing it', () => {
    for (const bad of [1592.35, '', '   ', null, undefined, '-5.00']) {
      expect(parsePrice(bad, 'close').ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('refuses a response whose currency is not the instrument’s (I-33)', async () => {
    const wrong = JSON.stringify({ ...JSON.parse(QUOTE_NSE), currency: 'USD' });
    const { fetchImpl } = recording(wrong);
    const provider = createTwelveDataProvider({ fetch: fetchImpl, apiKey: KEY });

    const result = await provider.getLatestPrices!([equity()]);
    const observation = result.get('i-infy');
    expect(observation?.ok).toBe(false);
    if (observation?.ok) return;
    expect(observation?.error.kind).toBe('malformed');
  });
});

describe('exchange close instants', () => {
  it('is DST-aware for venues that observe it', () => {
    // January is EST (UTC−5); August is EDT (UTC−4). Same wall-clock close.
    expect(exchangeCloseInstant(XNAS, isoDate('2026-01-15'))?.toISOString()).toBe('2026-01-15T21:00:00.000Z');
    expect(exchangeCloseInstant(XNAS, isoDate('2026-08-17'))?.toISOString()).toBe('2026-08-17T20:00:00.000Z');
  });

  it('is stable for India, which has no DST', () => {
    for (const date of ['2026-01-15', '2026-08-17']) {
      expect(exchangeCloseInstant(XNSE, isoDate(date))?.toISOString()).toBe(`${date}T10:00:00.000Z`);
    }
  });
});

// -------------------------------------------------------------------- 6, 16

describe('6 — historical daily data', () => {
  it('returns an ordered series of normalized observations', async () => {
    const { fetchImpl, urls } = recording(TIME_SERIES_NSE);
    const provider = createTwelveDataProvider({ fetch: fetchImpl, apiKey: KEY });

    const result = await provider.getHistoricalPrices!(equity(), isoDate('2026-08-13'), isoDate('2026-08-17'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.map((o) => o.tradingDate)).toEqual(['2026-08-13', '2026-08-14', '2026-08-17']);
    expect(result.value.map((o) => pToDbString(o.close))).toEqual([
      '1570.25000000',
      '1578.90000000',
      '1592.35000000',
    ]);
    expect(urls[0]).toContain('interval=1day');
    expect(urls[0]).toContain('order=asc');
    expect(urls[0]).toContain('start_date=2026-08-13');
    expect(urls[0]).toContain('end_date=2026-08-17');
  });

  it('rejects a reversed range rather than silently returning nothing', async () => {
    const provider = createTwelveDataProvider({ fetch: failsIfCalled, apiKey: KEY });
    const result = await provider.getHistoricalPrices!(equity(), isoDate('2026-08-17'), isoDate('2026-08-13'));
    expect(result.ok).toBe(false);
  });

  it('rejects the whole batch if one bar is malformed, rather than storing a hole', async () => {
    const holed = JSON.parse(TIME_SERIES_NSE) as { values: Record<string, unknown>[] };
    holed.values[1]!['close'] = 'not-a-number';
    const { fetchImpl } = recording(JSON.stringify(holed));
    const provider = createTwelveDataProvider({ fetch: fetchImpl, apiKey: KEY });

    const result = await provider.getHistoricalPrices!(equity(), isoDate('2026-08-13'), isoDate('2026-08-17'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('malformed');
  });
});

describe('16 — missing historical data', () => {
  it('an empty range is an empty series, not an outage', async () => {
    const empty = JSON.stringify({ meta: { currency: 'INR' }, values: [], status: 'ok' });
    const { fetchImpl } = recording(empty);
    const provider = createTwelveDataProvider({ fetch: fetchImpl, apiKey: KEY });

    const result = await provider.getHistoricalPrices!(equity(), isoDate('2026-08-15'), isoDate('2026-08-16'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it('a symbol the provider has no history for is not_found, not an empty series', async () => {
    const { fetchImpl } = recording(errorBody(404, 'symbol not found'));
    const provider = createTwelveDataProvider({ fetch: fetchImpl, apiKey: KEY });
    const result = await provider.getHistoricalPrices!(equity(), isoDate('2026-01-01'), isoDate('2026-08-17'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('not_found');
  });
});

// ------------------------------------------------------------ 9, 10, 11, 12, 13, 14

describe('9 — missing API key', () => {
  const provider = createTwelveDataProvider({ fetch: failsIfCalled, apiKey: null });

  it('loads, and declares that it needs a credential', () => {
    expect(provider.key).toBe('twelvedata');
    expect(provider.capabilities.requiresCredential).toBe(true);
  });

  it('fails typed on every operation, and never reaches the network', async () => {
    const latest = await provider.getLatestPrices!([equity()]);
    const one = latest.get('i-infy');
    expect(one?.ok).toBe(false);
    if (one?.ok) return;
    expect(one?.error.kind).toBe('unsupported');
    // Names the variable so the user knows what to set — the value is never
    // available to name.
    if (one?.error.kind === 'unsupported') expect(one.error.detail).toContain('TWELVE_DATA_API_KEY');

    const history = await provider.getHistoricalPrices!(equity(), isoDate('2026-08-01'), isoDate('2026-08-17'));
    expect(history.ok).toBe(false);

    const actions = await provider.getCorporateActions!(equity(), isoDate('2026-01-01'), isoDate('2026-08-17'));
    expect(actions.ok).toBe(false);

    const instrument = await provider.getInstrument!(equity());
    expect(instrument.ok).toBe(false);
  });

  it('fabricates no price', async () => {
    const latest = await provider.getLatestPrices!([equity()]);
    const one = latest.get('i-infy');
    expect(one && 'value' in one).toBe(false);
  });
});

describe('10 — invalid credentials', () => {
  it.each([401, 403])('code %i is unsupported, so the job stops rather than retrying', async (code) => {
    const { fetchImpl } = recording(errorBody(code, 'Invalid API key'));
    const provider = createTwelveDataProvider({ fetch: fetchImpl, apiKey: KEY });
    const result = await provider.getLatestPrices!([equity()]);
    const observation = result.get('i-infy');
    expect(observation?.ok).toBe(false);
    if (observation?.ok) return;
    expect(observation?.error.kind).toBe('unsupported');
  });

  it('an error body arriving with HTTP 200 is still an error', async () => {
    // The quirk this adapter exists to absorb.
    const { fetchImpl } = recording(errorBody(401, 'Invalid API key'), 200);
    const provider = createTwelveDataProvider({ fetch: fetchImpl, apiKey: KEY });
    const result = await provider.getLatestPrices!([equity()]);
    expect(result.get('i-infy')?.ok).toBe(false);
  });
});

describe('11 — rate limiting and quota', () => {
  it('an HTTP 429 is rate_limited', async () => {
    const { fetchImpl } = recording('slow down', 429, { 'retry-after': '60' });
    const provider = createTwelveDataProvider({ fetch: fetchImpl, apiKey: KEY });
    const observation = (await provider.getLatestPrices!([equity()])).get('i-infy');
    expect(observation?.ok === false && observation.error.kind).toBe('rate_limited');
  });

  it('a code-429 body with HTTP 200 is also rate_limited, not a missing price', async () => {
    const { fetchImpl } = recording(errorBody(429, 'You have run out of API credits'), 200);
    const provider = createTwelveDataProvider({ fetch: fetchImpl, apiKey: KEY });
    const observation = (await provider.getLatestPrices!([equity()])).get('i-infy');
    expect(observation?.ok === false && observation.error.kind).toBe('rate_limited');
  });
});

describe('12, 13 — timeout and network failure', () => {
  it('a timeout is transport, and therefore retryable', async () => {
    const provider = createTwelveDataProvider({ fetch: timesOut, apiKey: KEY, timeoutMs: 10 });
    const observation = (await provider.getLatestPrices!([equity()])).get('i-infy');
    expect(observation?.ok === false && observation.error.kind).toBe('transport');
  });

  it('a network failure is transport, never not_found', async () => {
    const provider = createTwelveDataProvider({ fetch: networkDown, apiKey: KEY });
    const observation = (await provider.getLatestPrices!([equity()])).get('i-infy');
    expect(observation?.ok).toBe(false);
    if (observation?.ok) return;
    // An outage reported as "instrument not found" would stop the retry that
    // fixes it, and would tell the user to correct a symbol that is correct.
    expect(observation?.error.kind).toBe('transport');
    expect(observation?.error.kind).not.toBe('not_found');
  });

  it('a provider 5xx is transport', async () => {
    const { fetchImpl } = recording(errorBody(500, 'internal'), 200);
    const provider = createTwelveDataProvider({ fetch: fetchImpl, apiKey: KEY });
    const observation = (await provider.getLatestPrices!([equity()])).get('i-infy');
    expect(observation?.ok === false && observation.error.kind).toBe('transport');
  });
});

describe('14 — malformed provider response', () => {
  it.each([
    ['invalid JSON', '{"symbol":'],
    ['an array where an object belongs', '[]'],
    ['a missing close', JSON.stringify({ datetime: '2026-08-17', currency: 'INR' })],
    ['a missing datetime', JSON.stringify({ close: '10.00', currency: 'INR' })],
    ['an impossible date', JSON.stringify({ datetime: '2026-02-31', close: '10.00', currency: 'INR' })],
    ['a numeric price', JSON.stringify({ datetime: '2026-08-17', close: 10.5, currency: 'INR' })],
  ])('rejects %s without throwing', async (_label, body) => {
    const { fetchImpl } = recording(body);
    const provider = createTwelveDataProvider({ fetch: fetchImpl, apiKey: KEY });
    const observation = (await provider.getLatestPrices!([equity()])).get('i-infy');
    expect(observation?.ok).toBe(false);
    if (observation?.ok) return;
    expect(['malformed', 'not_found']).toContain(observation!.error.kind);
  });

  it('classifies an unknown provider code without guessing', () => {
    expect(providerError({ status: 'error', code: 418, message: 'teapot' })?.kind).toBe('malformed');
    expect(providerError({ status: 'ok' })).toBeNull();
    expect(providerError({ symbol: 'INFY' })).toBeNull();
    expect(providerError('nope')?.kind).toBe('malformed');
  });
});

// ------------------------------------------------------------------- 17, 18

describe('17 — splits', () => {
  it('normalizes a 1:5 split onto the ledger’s own ratio shape', async () => {
    const { fetchImpl, urls } = recording(SPLITS_NSE);
    const provider = createTwelveDataProvider({ fetch: fetchImpl, apiKey: KEY });

    const result = await provider.getCorporateActions!(equity(), isoDate('2026-01-01'), isoDate('2026-08-17'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toEqual([
      {
        instrumentId: 'i-infy',
        kind: 'split',
        exDate: '2026-06-01',
        ratioNum: 5,
        ratioDen: 1,
        source: 'twelvedata:XNSE',
      },
    ]);
    expect(urls[0]).toContain('/splits?');
  });

  it('reduces and scales fractional factors, and rejects what will not scale', () => {
    expect(parseSplitRatio(1, 5)).toEqual({ ok: true, value: { ratioNum: 5, ratioDen: 1 } });
    expect(parseSplitRatio(5, 1)).toEqual({ ok: true, value: { ratioNum: 1, ratioDen: 5 } }); // reverse split
    expect(parseSplitRatio(2, 10)).toEqual({ ok: true, value: { ratioNum: 5, ratioDen: 1 } }); // reduced
    expect(parseSplitRatio(1, 0.2)).toEqual({ ok: true, value: { ratioNum: 1, ratioDen: 5 } }); // scaled

    for (const bad of [
      [0, 5],
      [1, 0],
      [-1, 5],
      [1, Number.NaN],
      [1, Number.POSITIVE_INFINITY],
      [1, Math.PI],
    ] as const) {
      expect(parseSplitRatio(bad[0], bad[1]).ok, `${bad[0]}:${bad[1]}`).toBe(false);
    }
  });

  it('never infers a bonus issue from a split', async () => {
    const { fetchImpl } = recording(SPLITS_NSE);
    const provider = createTwelveDataProvider({ fetch: fetchImpl, apiKey: KEY });
    const result = await provider.getCorporateActions!(equity(), isoDate('2026-01-01'), isoDate('2026-08-17'));
    if (!result.ok) return;
    // A bonus is economically distinct; fabricating one would put an invented
    // corporate action in front of the user.
    expect(result.value.every((o) => o.kind === 'split')).toBe(true);
  });

  it('an absent splits array is no actions, not a failure', async () => {
    const { fetchImpl } = recording(JSON.stringify({ meta: { symbol: 'INFY' } }));
    const provider = createTwelveDataProvider({ fetch: fetchImpl, apiKey: KEY });
    const result = await provider.getCorporateActions!(equity(), isoDate('2026-01-01'), isoDate('2026-08-17'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });
});

describe('18 — the adapter cannot mutate financial state', () => {
  it('exposes only read operations', () => {
    const provider = createTwelveDataProvider({ fetch: failsIfCalled, apiKey: KEY });
    // Structural, not behavioural: there is no write method to call, so no
    // amount of provider data can become a ledger row through this object.
    for (const method of Object.keys(provider)) {
      expect(method).not.toMatch(/create|insert|update|delete|write|save|post/i);
    }
    expect(provider.capabilities.provides).toEqual(
      expect.arrayContaining(['latest', 'history', 'corporate_actions', 'metadata']),
    );
    expect(provider.capabilities.provides).not.toContain('fx');
  });

  it('returns a split only as an observation, carrying no transaction identity', async () => {
    const { fetchImpl } = recording(SPLITS_NSE);
    const provider = createTwelveDataProvider({ fetch: fetchImpl, apiKey: KEY });
    const result = await provider.getCorporateActions!(equity(), isoDate('2026-01-01'), isoDate('2026-08-17'));
    if (!result.ok) return;
    for (const observation of result.value) {
      expect(observation).not.toHaveProperty('id');
      expect(observation).not.toHaveProperty('resolvedTxnId');
      expect(observation).not.toHaveProperty('accountId');
    }
  });
});

// ----------------------------------------------------------------------- 19

describe('19 — no secret leakage', () => {
  it('never puts the key in a failure message', async () => {
    const cases: FetchLike[] = [
      networkDown,
      async () => new Response(errorBody(401, 'Invalid API key'), { status: 200 }),
      async () => new Response(errorBody(429, 'out of credits'), { status: 200 }),
      async () => new Response('{"broken":', { status: 200 }),
      async () => new Response('nope', { status: 500 }),
    ];

    for (const fetchImpl of cases) {
      const provider = createTwelveDataProvider({ fetch: fetchImpl, apiKey: KEY });
      const observation = (await provider.getLatestPrices!([equity()])).get('i-infy');
      expect(observation?.ok).toBe(false);
      if (observation?.ok) continue;
      const serialised = JSON.stringify(observation?.error);
      expect(serialised).not.toContain(KEY);
      expect(serialised).not.toContain('apikey');
    }
  });

  it('sends the key as a query parameter and nowhere else', async () => {
    const { fetchImpl, urls } = recording(QUOTE_NSE);
    const provider = createTwelveDataProvider({ fetch: fetchImpl, apiKey: KEY });
    await provider.getLatestPrices!([equity()]);
    // Present in the request (it has to be), and that is precisely why no
    // failure message in the adapter quotes a URL.
    expect(urls[0]).toContain(`apikey=${KEY}`);
  });
});

// ----------------------------------------------------------------------- 21

describe('21 — duplicate observations are deterministic', () => {
  it('the same fixture twice yields identical observations', async () => {
    const provider = createTwelveDataProvider({ fetch: recording(QUOTE_NSE).fetchImpl, apiKey: KEY });
    const first = (await provider.getLatestPrices!([equity()])).get('i-infy');
    const second = (await provider.getLatestPrices!([equity()])).get('i-infy');
    expect(first?.ok && second?.ok).toBe(true);
    if (!first?.ok || !second?.ok) return;
    expect(pToDbString(first.value.close)).toBe(pToDbString(second.value.close));
    expect(first.value.tradingDate).toBe(second.value.tradingDate);
    expect(first.value.observedAt.getTime()).toBe(second.value.observedAt.getTime());
    expect(first.value.source).toBe(second.value.source);
  });

  it('a repeated date in one series produces one observation per bar, unchanged', async () => {
    const duplicated = JSON.parse(TIME_SERIES_NSE) as { values: unknown[] };
    duplicated.values = [duplicated.values[0], duplicated.values[0]];
    const { fetchImpl } = recording(JSON.stringify(duplicated));
    const provider = createTwelveDataProvider({ fetch: fetchImpl, apiKey: KEY });

    const result = await provider.getHistoricalPrices!(equity(), isoDate('2026-08-13'), isoDate('2026-08-13'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The adapter reports what it saw; de-duplication is the storage layer's
    // job, keyed on (instrument, trading date). Both carry the same values, so
    // the upsert is idempotent either way.
    expect(result.value).toHaveLength(2);
    expect(result.value[0]!.tradingDate).toBe(result.value[1]!.tradingDate);
    expect(pToDbString(result.value[0]!.close)).toBe(pToDbString(result.value[1]!.close));
  });
});
