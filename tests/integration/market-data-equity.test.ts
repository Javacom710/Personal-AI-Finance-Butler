/**
 * Equity market data through the financial engine — Task 9 of step 6.9.
 *
 * The adapter's own contract is covered deterministically in
 * `tests/unit/market-data-twelvedata.test.ts`. These tests answer a different
 * question: once a provider observation is real, does it reach a valuation
 * correctly, and can it damage anything on the way?
 *
 * The first test is a **regression**. `instruments.exchange` is free text a user
 * types — `NSE`, not `XNSE` — and the refs builder used to assert it was a MIC,
 * which threw on the ordinary stored value and took the whole refresh down.
 * Every earlier market-data test used a mutual fund, whose exchange is null, so
 * the equity path was never exercised.
 *
 * `fetch` is injected throughout; nothing here touches the network.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { daysBetween, isoDate, type IsoDate } from '@/lib/date';
import { currency } from '@/lib/decimal/money';
import { pToDbString, valueOf } from '@/lib/decimal/price';
import { db } from '@/server/db/client';
import { twr } from '@/server/domain/calc/twr';
import { createRegistry } from '@/server/market-data/registry';
import { createAmfiProvider } from '@/server/market-data/providers/amfi';
import { createFrankfurterProvider } from '@/server/market-data/providers/frankfurter';
import { createManualProvider } from '@/server/market-data/providers/manual';
import { createTwelveDataProvider } from '@/server/market-data/providers/twelvedata';
import type { FetchLike } from '@/server/market-data/http';
import {
  backfillPrices,
  heldInstrumentRefs,
  recordCorporateActionDetections,
  refreshPrices,
} from '@/server/services/market-data';
import { closeAsOf, historicalCloses, quotesFor } from '@/server/services/prices';
import { holdings } from '@/server/services/portfolio';
import { netWorthAsOf } from '@/server/services/networth';
import { truncateAll, closeHarness } from './harness';
import {
  makeAccount,
  must,
  refreshCtx,
  setupMoneyFixture,
  write,
  type MoneyFixture,
} from './money-harness';
import {
  derivedFingerprint,
  investmentLedgerVersion,
  makeInstrument,
  recordBuy,
} from './investment-harness';

const INR = currency('INR');

/** Monday 17 August 2026; the Friday before is the 14th. */
const NOW = new Date('2026-08-17T12:00:00Z');

const quoteBody = (close: string, datetime = '2026-08-17') =>
  JSON.stringify({
    symbol: 'INFY',
    name: 'Infosys Ltd',
    exchange: 'NSE',
    mic_code: 'XNSE',
    currency: 'INR',
    datetime,
    close,
  });

const seriesBody = (points: readonly [string, string][]) =>
  JSON.stringify({
    meta: { symbol: 'INFY', interval: '1day', currency: 'INR', mic_code: 'XNSE' },
    values: points.map(([datetime, close]) => ({ datetime, close })),
    status: 'ok',
  });

function respond(byUrl: (url: string) => { body: string; status?: number }): FetchLike {
  return async (url) => {
    const { body, status = 200 } = byUrl(url);
    return new Response(body, { status, headers: { 'content-type': 'application/json' } });
  };
}

const KEY = 'test-key-not-a-real-credential';

const registryWith = (fetchImpl: FetchLike, apiKey: string | null = KEY) =>
  createRegistry([
    createAmfiProvider({ fetch: fetchImpl }),
    createTwelveDataProvider({ fetch: fetchImpl, apiKey }),
    createFrankfurterProvider({ fetch: fetchImpl }),
    createManualProvider(),
  ]);

let fixture: MoneyFixture;

beforeEach(async () => {
  await truncateAll();
  fixture = await setupMoneyFixture({ now: NOW });
});

afterAll(closeHarness);

/**
 * A brokerage account holding 400 INFY bought at ₹1,000.
 *
 * The exchange is left as the service stores it — the plain string `NSE` — which
 * is the whole point of the regression below.
 */
async function equityFixture() {
  const ctx = fixture.ctx;
  const accountId = await makeAccount(ctx, {
    name: 'Zerodha',
    kind: 'brokerage',
    openingBalance: '1000000',
    openingDate: '2026-01-01',
  });
  const instrumentId = await makeInstrument(ctx, {
    symbol: 'INFY',
    name: 'Infosys Ltd',
    exchange: 'NSE',
    assetClass: 'equity',
  });
  must(
    await recordBuy(ctx, { accountId, instrumentId, on: '2026-02-02', qty: '400', price: '1000' }),
  );
  return { accountId, instrumentId };
}

describe('regression — a user-typed exchange does not crash the refresh', () => {
  it('resolves the stored label `NSE` to a MIC instead of throwing', async () => {
    const { instrumentId } = await equityFixture();
    const ctx = await refreshCtx(fixture);

    // Before the fix this threw a TypeError out of the refs builder, which
    // aborted the whole refresh for every instrument, not just this one.
    const refs = await heldInstrumentRefs(ctx);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.instrumentId).toBe(instrumentId);
    expect(refs[0]!.exchange).toBe('XNSE');
  });

  it('an unrecognised exchange yields a ref, not an exception', async () => {
    const ctx0 = fixture.ctx;
    const accountId = await makeAccount(ctx0, {
      name: 'Broker',
      kind: 'brokerage',
      openingBalance: '100000',
      openingDate: '2026-01-01',
    });
    const instrumentId = await makeInstrument(ctx0, {
      symbol: 'WEIRD',
      name: 'Unlisted Thing',
      exchange: 'NOT-A-VENUE',
      assetClass: 'equity',
    });
    must(await recordBuy(ctx0, { accountId, instrumentId, on: '2026-02-02', qty: '1', price: '100' }));

    const ctx = await refreshCtx(fixture);
    const refs = await heldInstrumentRefs(ctx);
    const ref = refs.find((r) => r.instrumentId === instrumentId)!;
    expect(ref.exchange).toBeNull();

    // And it prices to a typed refusal rather than being sent to a provider
    // that would answer about a different security entirely.
    const outcome = await write(ctx, (w) => refreshPrices(w, registryWith(respond(() => ({ body: quoteBody('1.00') })))));
    const failed = outcome.failed.find((f) => f.instrumentId === instrumentId);
    expect(failed).toBeDefined();
    expect(outcome.rejected).toEqual([]);
  });
});

describe('1 — an equity holding obtains a market valuation', () => {
  it('prices INFY and computes market value and unrealised P&L', async () => {
    const { instrumentId } = await equityFixture();

    const outcome = await write(fixture.ctx, (w) =>
      refreshPrices(w, registryWith(respond(() => ({ body: quoteBody('1592.35000000') })))),
    );
    expect(outcome.requested).toBe(1);
    expect(outcome.stored).toBe(1);
    expect(outcome.failed).toEqual([]);
    expect(outcome.rejected).toEqual([]);

    const ctx = await refreshCtx(fixture);
    const quote = (await quotesFor(ctx, [instrumentId])).get(instrumentId)!;
    expect(quote.status).not.toBe('missing');
    if (quote.status === 'missing') return;
    expect(pToDbString(quote.price)).toBe('1592.35000000');
    expect(quote.source).toBe('twelvedata:XNSE');

    const valued = await holdings(ctx);
    const holding = valued.holdings.find((h) => h.instrument.id === instrumentId)!;
    // 400 × ₹1,592.35 = ₹6,36,940 against ₹4,00,000 invested.
    expect(holding.marketValue?.minor).toBe(6369400000n);
    expect(holding.unrealizedPnl?.minor).toBe(2369400000n);
    expect(valued.unpriced).toEqual([]);
  });
});

describe('4 — freshness comes from the central classifier, not the adapter', () => {
  it("Friday's close read on Monday is current, not stale", async () => {
    const { instrumentId } = await equityFixture();
    // The provider's latest session is Friday; today is Monday.
    await write(fixture.ctx, (w) =>
      refreshPrices(w, registryWith(respond(() => ({ body: quoteBody('1578.90000000', '2026-08-14') })))),
    );

    const ctx = await refreshCtx(fixture);
    const quote = (await quotesFor(ctx, [instrumentId])).get(instrumentId)!;
    expect(quote.status).not.toBe('missing');
    if (quote.status === 'missing') return;

    // ~74 hours old. A wall-clock rule would have called this stale.
    expect(quote.ageHours).toBeGreaterThan(70);
    expect(quote.freshness).toBe('current');
    expect(quote.sessionsBehind).toBe(0);
  });

  it('a price left behind by later sessions becomes stale', async () => {
    const { instrumentId } = await equityFixture();
    // Backfill three later sessions, then a quote dated before all of them.
    await write(fixture.ctx, (w) =>
      backfillPrices(
        w,
        registryWith(
          respond(() => ({
            body: seriesBody([
              ['2026-08-11', '1500.00000000'],
              ['2026-08-12', '1510.00000000'],
              ['2026-08-13', '1520.00000000'],
              ['2026-08-14', '1530.00000000'],
              ['2026-08-17', '1592.35000000'],
            ]),
          })),
        ),
        instrumentId,
        isoDate('2026-08-11'),
        isoDate('2026-08-17'),
      ),
    );

    await db().execute(
      sql`update instrument_quotes set as_of = '2026-08-11T10:00:00Z'::timestamptz where instrument_id = ${instrumentId}`,
    );

    const ctx = await refreshCtx(fixture);
    const quote = (await quotesFor(ctx, [instrumentId])).get(instrumentId)!;
    expect(quote.status).toBe('stale');
    if (quote.status !== 'stale') return;
    // Four sessions have closed since — well past the three-session threshold.
    expect(quote.sessionsBehind).toBe(4);
  });
});

describe('2, 5 — historical prices are stored, retrieved, and feed TWR', () => {
  const SERIES: readonly [string, string][] = [
    ['2026-08-03', '1400.00000000'],
    ['2026-08-10', '1500.00000000'],
    ['2026-08-14', '1530.00000000'],
    ['2026-08-17', '1592.35000000'],
  ];

  it('backfills a daily series and reads it back in order', async () => {
    const { instrumentId } = await equityFixture();

    const result = await write(fixture.ctx, (w) =>
      backfillPrices(
        w,
        registryWith(respond(() => ({ body: seriesBody(SERIES) }))),
        instrumentId,
        isoDate('2026-08-01'),
        isoDate('2026-08-17'),
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stored).toBe(4);
    expect(result.value.rejected).toEqual([]);

    const ctx = await refreshCtx(fixture);
    const series = (await historicalCloses(ctx, [instrumentId], '2026-08-01', '2026-08-17')).get(
      instrumentId,
    )!;
    expect(series.map((p) => p.asOf)).toEqual(['2026-08-03', '2026-08-10', '2026-08-14', '2026-08-17']);
  });

  it('a re-run of the same backfill is idempotent', async () => {
    const { instrumentId } = await equityFixture();
    const registry = registryWith(respond(() => ({ body: seriesBody(SERIES) })));
    for (let i = 0; i < 3; i += 1) {
      await write(fixture.ctx, (w) =>
        backfillPrices(w, registry, instrumentId, isoDate('2026-08-01'), isoDate('2026-08-17')),
      );
    }
    const { rows } = await db().execute<{ n: string }>(
      sql`select count(*)::text as n from instrument_prices where instrument_id = ${instrumentId}`,
    );
    expect(rows[0]!.n).toBe('4');
  });

  it('the stored series supplies a valuation at every TWR boundary, including a non-trading day', async () => {
    const { instrumentId } = await equityFixture();
    await write(fixture.ctx, (w) =>
      backfillPrices(
        w,
        registryWith(respond(() => ({ body: seriesBody(SERIES) }))),
        instrumentId,
        isoDate('2026-08-01'),
        isoDate('2026-08-17'),
      ),
    );

    const ctx = await refreshCtx(fixture);
    const series = (await historicalCloses(ctx, [instrumentId], '2026-08-01', '2026-08-17')).get(
      instrumentId,
    )!;

    // 16 August is a Sunday — a SIP debit could Ð»ÐµÐ³itimately fall there, and
    // `twr()` matches boundary dates exactly, so the builder must supply a point.
    const boundaries: IsoDate[] = ['2026-08-03', '2026-08-10', '2026-08-16', '2026-08-17'].map(isoDate);
    const valuations = boundaries.map((on) => {
      const carried = closeAsOf(series, on, 'eod');
      expect(carried, `no close carried to ${on}`).not.toBeNull();
      // 400 units held throughout the window.
      return { on, value: valueOf({ units: 400_00000000n }, carried!.close, INR, 'half_up') };
    });

    expect(valuations[2]!.value.minor).toBe(valuations.find((v) => v.on === '2026-08-16')!.value.minor);
    // Sunday carries Friday's close, not Monday's.
    expect(closeAsOf(series, isoDate('2026-08-16'), 'eod')!.asOf).toBe('2026-08-14');

    const result = twr({
      from: isoDate('2026-08-03'),
      to: isoDate('2026-08-17'),
      valuations,
      flows: [],
      annualise: false,
    });

    expect(result.value).not.toBeNull();
    // No flows, so TWR is simply the price change: 1400 → 1592.35 = +13.7393%.
    expect(Number(result.value!.twr.value) / 1e10).toBeCloseTo(0.137393, 5);
    expect(daysBetween(isoDate('2026-08-03'), isoDate('2026-08-17'))).toBe(14);
  });
});

describe('3, 4 — Phase 5 Net Worth at Cost is unaffected by prices arriving', () => {
  it('reports the same figure before and after an equity is priced', async () => {
    await equityFixture();

    let ctx = await refreshCtx(fixture);
    const before = must(await netWorthAsOf(ctx, { asOf: isoDate('2026-08-17') }));

    await write(fixture.ctx, (w) =>
      refreshPrices(w, registryWith(respond(() => ({ body: quoteBody('1592.35000000') })))),
    );

    ctx = await refreshCtx(fixture);
    const after = must(await netWorthAsOf(ctx, { asOf: isoDate('2026-08-17') }));

    // A ₹2.37 lakh unrealised gain is now visible on the Investments page and
    // must be invisible here: Phase 5 is at cost, and the two bases are never
    // mixed inside one figure (ADR-23).
    expect(after.netWorth.minor).toBe(before.netWorth.minor);
    expect(after.basis).toBe('cost');
    expect(after.assets.minor).toBe(before.assets.minor);
  });
});

describe('6, 7 — provider failures produce no financial value', () => {
  it.each([
    ['authentication rejected', JSON.stringify({ code: 401, message: 'Invalid API key', status: 'error' })],
    ['rate limited', JSON.stringify({ code: 429, message: 'out of credits', status: 'error' })],
    ['malformed', '{"broken":'],
    ['server error', JSON.stringify({ code: 500, message: 'internal', status: 'error' })],
  ])('%s leaves the ledger and the price tables untouched', async (_label, body) => {
    const { instrumentId } = await equityFixture();
    const before = await derivedFingerprint(fixture.userId);
    const versionBefore = await investmentLedgerVersion(fixture.userId);

    const outcome = await write(fixture.ctx, (w) =>
      refreshPrices(w, registryWith(respond(() => ({ body })))),
    );
    expect(outcome.stored).toBe(0);
    expect(outcome.failed).toHaveLength(1);

    expect(await derivedFingerprint(fixture.userId)).toBe(before);
    expect(await investmentLedgerVersion(fixture.userId)).toBe(versionBefore);

    const { rows } = await db().execute(sql`select 1 from instrument_prices`);
    expect(rows).toHaveLength(0);

    // And the holding says it has no price rather than showing a figure.
    const ctx = await refreshCtx(fixture);
    const valued = await holdings(ctx);
    const holding = valued.holdings.find((h) => h.instrument.id === instrumentId)!;
    expect(holding.marketValue).toBeNull();
    expect(holding.invested.minor).toBe(4000000000n); // cost basis untouched
  });

  it('an unconfigured key is a typed refusal, not a fabricated price', async () => {
    const { instrumentId } = await equityFixture();

    const outcome = await write(fixture.ctx, (w) =>
      refreshPrices(w, registryWith(respond(() => ({ body: quoteBody('1592.35') })), null)),
    );
    expect(outcome.stored).toBe(0);
    expect(outcome.failed[0]!.reason).toContain('TWELVE_DATA_API_KEY');

    const ctx = await refreshCtx(fixture);
    const quote = (await quotesFor(ctx, [instrumentId])).get(instrumentId)!;
    expect(quote.status).toBe('missing');
    if (quote.status !== 'missing') return;
    expect(quote.reason).toBe('no_provider');
  });
});

describe('8 — corporate-action safety survives a real provider', () => {
  it('a split detected from the feed never becomes a ledger row', async () => {
    const { instrumentId } = await equityFixture();
    const versionBefore = await investmentLedgerVersion(fixture.userId);
    const fingerprintBefore = await derivedFingerprint(fixture.userId);

    await write(fixture.ctx, (w) =>
      recordCorporateActionDetections(w, [
        {
          instrumentId,
          kind: 'split',
          exDate: isoDate('2026-06-01'),
          ratioNum: 5,
          ratioDen: 1,
          source: 'twelvedata:XNSE',
        },
      ]),
    );

    const { rows } = await db().execute<{ n: string }>(
      sql`select count(*)::text as n from investment_transactions where kind in ('split','bonus')`,
    );
    expect(rows[0]!.n).toBe('0');
    expect(await investmentLedgerVersion(fixture.userId)).toBe(versionBefore);
    expect(await derivedFingerprint(fixture.userId)).toBe(fingerprintBefore);
  });

  it('suppresses the valuation rather than reporting post-split price × pre-split quantity', async () => {
    const { instrumentId } = await equityFixture();
    await write(fixture.ctx, (w) =>
      refreshPrices(w, registryWith(respond(() => ({ body: quoteBody('318.47000000') })))),
    );

    await write(fixture.ctx, (w) =>
      recordCorporateActionDetections(w, [
        {
          instrumentId,
          kind: 'split',
          exDate: isoDate('2026-06-01'),
          ratioNum: 5,
          ratioDen: 1,
          source: 'twelvedata:XNSE',
        },
      ]),
    );

    const ctx = await refreshCtx(fixture);
    const quote = (await quotesFor(ctx, [instrumentId])).get(instrumentId)!;
    expect(quote.status).toBe('missing');
    if (quote.status !== 'missing') return;
    expect(quote.reason).toBe('unreconciled_corporate_action');

    const valued = await holdings(ctx);
    const holding = valued.holdings.find((h) => h.instrument.id === instrumentId)!;
    // 400 (pre-split) × ₹318.47 (post-split) = ₹1,27,388 — a 68% phantom loss
    // against ₹4,00,000 invested. It must not appear anywhere.
    expect(holding.marketValue).toBeNull();
    expect(holding.unrealizedPnl).toBeNull();
    expect(valued.unpriced.map((i) => i.id)).toContain(instrumentId);
    // Quantity and basis are untouched — nothing was "fixed".
    expect(holding.quantity.units).toBe(400_00000000n);
    expect(holding.invested.minor).toBe(4000000000n);
  });
});

describe('provider isolation holds at the seam', () => {
  it('nothing the engine receives names the provider except the source stamp', async () => {
    const { instrumentId } = await equityFixture();
    await write(fixture.ctx, (w) =>
      refreshPrices(w, registryWith(respond(() => ({ body: quoteBody('1592.35000000') })))),
    );

    const ctx = await refreshCtx(fixture);
    const valued = await holdings(ctx);
    const holding = valued.holdings.find((h) => h.instrument.id === instrumentId)!;

    // `source` is provenance and is meant to be shown. Everything else the
    // valuation carries is domain vocabulary.
    const serialised = JSON.stringify(holding, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    const providerMentions = serialised.match(/twelvedata/g) ?? [];
    expect(providerMentions).toHaveLength(1);
  });
});
