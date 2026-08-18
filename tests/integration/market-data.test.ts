/**
 * Market data end to end — [TESTING.md §6](../../docs/TESTING.md#6-market-data-contract-tests).
 *
 * The unit tests prove each piece behaves; these prove the pieces together do
 * not corrupt anything. The three that matter most:
 *
 * - a provider observation **never** reaches `investment_transactions` (I-40);
 * - a malformed or hostile response leaves the financial state byte-identical;
 * - an unreconciled corporate action **suppresses** a value rather than
 *   producing the internally-consistent wrong one.
 *
 * `fetch` is injected throughout, so nothing here touches the network.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/date';
import { currency } from '@/lib/decimal/money';
import { pToDbString, UnitPrice } from '@/lib/decimal/price';
import { db } from '@/server/db/client';
import { sql } from 'drizzle-orm';
import { createRegistry } from '@/server/market-data/registry';
import { createAmfiProvider } from '@/server/market-data/providers/amfi';
import { createFrankfurterProvider } from '@/server/market-data/providers/frankfurter';
import { createManualProvider } from '@/server/market-data/providers/manual';
import type { FetchLike } from '@/server/market-data/http';
import type { PriceObservation } from '@/server/market-data/types';
import {
  backfillPrices,
  heldInstrumentRefs,
  recordCorporateActionDetections,
  refreshFxRates,
  refreshPrices,
  requiredFxPairs,
  storePriceObservations,
} from '@/server/services/market-data';
import { closeAsOf, historicalCloses, quotesFor, setManualPrice } from '@/server/services/prices';
import { holdings } from '@/server/services/portfolio';
import { truncateAll, closeHarness } from './harness';
import {
  makeAccount,
  must,
  rawSql,
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
  recordSell,
} from './investment-harness';

const INR = currency('INR');
const USD = currency('USD');

/** 17 Aug 2026 is a Monday; 14 Aug is the Friday before. */
const NOW = new Date('2026-08-17T12:00:00Z');

const NAV_FILE = [
  'Scheme Code;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date',
  '',
  'HDFC Mutual Fund',
  '',
  '118989;INF179K01XQ0;INF179K01XR8;HDFC Top 100 Fund - Growth;250.5000;17-Aug-2026',
].join('\n');

const FX_BODY = JSON.stringify({
  amount: 1.0,
  base: 'USD',
  date: '2026-08-17',
  rates: { INR: 95.61 },
});

function textFetch(byUrl: (url: string) => { body: string; status?: number }): FetchLike {
  return async (url) => {
    const { body, status = 200 } = byUrl(url);
    return new Response(body, { status, headers: { 'content-type': 'text/plain' } });
  };
}

const happyFetch = textFetch((url) =>
  url.includes('amfiindia') ? { body: NAV_FILE } : { body: FX_BODY },
);

const registryWith = (fetchImpl: FetchLike) =>
  createRegistry([
    createAmfiProvider({ fetch: fetchImpl }),
    createFrankfurterProvider({ fetch: fetchImpl }),
    createManualProvider(),
  ]);

let fixture: MoneyFixture;

beforeEach(async () => {
  await truncateAll();
  fixture = await setupMoneyFixture({ now: NOW });
});

afterAll(closeHarness);

/** A brokerage account holding one Indian mutual fund, bought before the window. */
async function fundFixture() {
  const ctx = fixture.ctx;
  const accountId = await makeAccount(ctx, {
    name: 'Zerodha Coin',
    kind: 'brokerage',
    openingBalance: '500000',
    openingDate: '2026-01-01',
  });
  // `symbol` doubles as the AMFI scheme code; the adapter prefers ISIN anyway.
  const instrumentId = await makeInstrument(ctx, {
    symbol: '118989',
    name: 'HDFC Top 100 Fund - Growth',
    assetClass: 'mutual_fund',
    exchange: undefined,
  });
  await rawSql('update instruments set exchange = null, isin = $2 where id = $1', [
    instrumentId,
    'INF179K01XQ0',
  ]);
  must(
    await recordBuy(
      ctx,
      { accountId, instrumentId, on: '2026-02-01', qty: '400', price: '200' },
      'mf_purchase',
    ),
  );
  return { accountId, instrumentId };
}

describe('AMFI NAV reaches the valuation layer', () => {
  it('prices a mutual fund the user holds, and the holding shows a market value', async () => {
    const { instrumentId } = await fundFixture();

    const outcome = await write(fixture.ctx, (w) => refreshPrices(w, registryWith(happyFetch)));
    expect(outcome.requested).toBe(1);
    expect(outcome.stored).toBe(1);
    expect(outcome.rejected).toEqual([]);

    const ctx = await refreshCtx(fixture);
    const quotes = await quotesFor(ctx, [instrumentId]);
    const quote = quotes.get(instrumentId)!;

    expect(quote.status).not.toBe('missing');
    if (quote.status === 'missing') return;
    expect(pToDbString(quote.price)).toBe('250.50000000');
    expect(quote.source).toBe('amfi');
    // Same-day NAV, and the fund's own calendar has exactly this one session.
    expect(quote.freshness).toBe('current');

    const valued = await holdings(ctx);
    const holding = valued.holdings.find((h) => h.instrument.id === instrumentId)!;
    // 400 units × ₹250.50 = ₹1,00,200, against ₹80,000 invested.
    expect(holding.marketValue?.minor).toBe(1002000000n);
    expect(holding.unrealizedPnl?.minor).toBe(202000000n);
  });

  it('writes both the latest quote and a historical close from one fetch', async () => {
    const { instrumentId } = await fundFixture();
    await write(fixture.ctx, (w) => refreshPrices(w, registryWith(happyFetch)));

    const ctx = await refreshCtx(fixture);
    const series = await historicalCloses(ctx, [instrumentId], '2026-01-01', '2026-12-31');
    expect(series.get(instrumentId)).toEqual([{ asOf: '2026-08-17', close: '250.50000000' }]);
  });

  it('a provider outage leaves the previous quote in place rather than blanking the holding', async () => {
    const { instrumentId } = await fundFixture();
    await write(fixture.ctx, (w) => refreshPrices(w, registryWith(happyFetch)));

    const down = textFetch(() => ({ body: 'gateway timeout', status: 500 }));
    const outcome = await write(fixture.ctx, (w) => refreshPrices(w, registryWith(down)));
    expect(outcome.stored).toBe(0);
    expect(outcome.failed).toHaveLength(1);

    const ctx = await refreshCtx(fixture);
    const quote = (await quotesFor(ctx, [instrumentId])).get(instrumentId)!;
    // Still priced. The figure ages and says so; it does not vanish.
    expect(quote.status).not.toBe('missing');
  });
});

describe('foreign-currency net worth can now obtain FX', () => {
  it('fetches the pairs the user actually needs, quoted against base', async () => {
    await makeAccount(fixture.ctx, { name: 'Schwab', kind: 'bank', currencyCode: 'USD' });

    const ctx = await refreshCtx(fixture);
    const pairs = await requiredFxPairs(ctx);
    // Requested USD→INR, not EUR→USD: the provider computes the cross so
    // `selectRate` finds a direct row (finding M1).
    expect(pairs).toEqual([{ base: USD, quote: INR }]);

    const outcome = await write(ctx, (w) => refreshFxRates(w, registryWith(happyFetch)));
    expect(outcome.stored).toBe(1);
    expect(outcome.failed).toEqual([]);

    const { rows } = await db().execute<{ base_code: string; quote_code: string; rate: string; source: string }>(
      sql`select base_code, quote_code, rate, source from fx_rates`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.base_code.trim()).toBe('USD');
    expect(rows[0]!.quote_code.trim()).toBe('INR');
    expect(Number(rows[0]!.rate)).toBeCloseTo(95.61, 4);
    expect(rows[0]!.source).toBe('frankfurter');
  });

  it('the stored rate is usable by the domain lookup afterwards', async () => {
    await makeAccount(fixture.ctx, { name: 'Schwab', kind: 'bank', currencyCode: 'USD' });
    await write(fixture.ctx, (w) => refreshFxRates(w, registryWith(happyFetch)));

    // The lookup is preloaded per request, so a fresh context is required.
    const ctx = await refreshCtx(fixture);
    const rate = ctx.fx.rate(USD, INR, isoDate('2026-08-17'));
    expect(rate.ok).toBe(true);
    if (!rate.ok) return;
    expect(rate.value.source).toBe('direct');
  });

  it('a provider failure stores nothing and fabricates nothing', async () => {
    await makeAccount(fixture.ctx, { name: 'Schwab', kind: 'bank', currencyCode: 'USD' });
    const down = textFetch(() => ({ body: '{}', status: 500 }));

    const outcome = await write(fixture.ctx, (w) => refreshFxRates(w, registryWith(down)));
    expect(outcome.stored).toBe(0);
    expect(outcome.failed).toHaveLength(1);

    const { rows } = await db().execute(sql`select 1 from fx_rates`);
    expect(rows).toHaveLength(0);
  });
});

describe('storage guards', () => {
  function observation(instrumentId: string, over: Partial<PriceObservation> = {}): PriceObservation {
    return {
      instrumentId,
      close: UnitPrice.of('250.50'),
      currency: INR,
      tradingDate: isoDate('2026-08-17'),
      observedAt: new Date('2026-08-17T12:30:00Z'),
      kind: 'nav',
      source: 'amfi',
      providerRef: '118989',
      ...over,
    };
  }

  it('I-33 — an observation in the wrong currency is rejected, not converted', async () => {
    const { instrumentId } = await fundFixture();
    const outcome = await write(fixture.ctx, (w) =>
      storePriceObservations(w, [observation(instrumentId, { currency: USD })]),
    );
    expect(outcome.stored).toBe(0);
    expect(outcome.rejected).toEqual([{ instrumentId, reason: 'currency_mismatch' }]);
  });

  it('I-35 — a second provider is refused rather than interleaved', async () => {
    const { instrumentId } = await fundFixture();
    await write(fixture.ctx, (w) => storePriceObservations(w, [observation(instrumentId)]));

    const outcome = await write(fixture.ctx, (w) =>
      storePriceObservations(w, [
        observation(instrumentId, { tradingDate: isoDate('2026-08-18'), source: 'twelvedata' }),
      ]),
    );
    expect(outcome.stored).toBe(0);
    expect(outcome.rejected).toEqual([{ instrumentId, reason: 'source_conflict' }]);

    const { rows } = await db().execute<{ source: string }>(
      sql`select distinct source from instrument_prices where instrument_id = ${instrumentId}`,
    );
    expect(rows).toHaveLength(1);
  });

  it('I-36 — an older observation never moves the latest quote backwards', async () => {
    const { instrumentId } = await fundFixture();
    await write(fixture.ctx, (w) => storePriceObservations(w, [observation(instrumentId)]));

    const outcome = await write(fixture.ctx, (w) =>
      storePriceObservations(w, [
        observation(instrumentId, {
          tradingDate: isoDate('2026-08-14'),
          observedAt: new Date('2026-08-14T12:30:00Z'),
          close: UnitPrice.of('1.00'),
        }),
      ]),
    );
    // The historical row is written — it is genuinely a different session —
    // but the quote does not regress.
    expect(outcome.stored).toBe(1);
    expect(outcome.quotesAdvanced).toBe(0);

    const { rows } = await db().execute<{ price: string; as_of: string }>(
      sql`select price, as_of::text from instrument_quotes where instrument_id = ${instrumentId}`,
    );
    expect(rows[0]!.price).toBe('250.50000000');
  });

  it('a provider price does not overwrite a manual price of the same date', async () => {
    const { instrumentId } = await fundFixture();
    must(
      await write(fixture.ctx, (w) =>
        setManualPrice(w, { instrumentId, price: '999.00', asOf: '2026-08-17T12:30:00Z' }),
      ),
    );

    const outcome = await write(fixture.ctx, (w) => storePriceObservations(w, [observation(instrumentId)]));
    expect(outcome.quotesAdvanced).toBe(0);

    const { rows } = await db().execute<{ price: string; source: string }>(
      sql`select price, source from instrument_quotes where instrument_id = ${instrumentId}`,
    );
    expect(rows[0]!.source).toBe('manual');
    expect(rows[0]!.price).toBe('999.00000000');
  });

  it('an unknown instrument is named, not silently dropped', async () => {
    const outcome = await write(fixture.ctx, (w) =>
      storePriceObservations(w, [observation('00000000-0000-0000-0000-000000000000')]),
    );
    expect(outcome.rejected[0]!.reason).toBe('unknown_instrument');
  });

  it('a duplicate observation is idempotent, not a second row', async () => {
    const { instrumentId } = await fundFixture();
    await write(fixture.ctx, (w) => storePriceObservations(w, [observation(instrumentId)]));
    await write(fixture.ctx, (w) => storePriceObservations(w, [observation(instrumentId)]));

    const { rows } = await db().execute<{ n: string }>(
      sql`select count(*)::text as n from instrument_prices where instrument_id = ${instrumentId}`,
    );
    expect(rows[0]!.n).toBe('1');
  });
});

describe('corporate-action safety (ADR-29, I-40)', () => {
  it('a detection creates no ledger row and does not bump the ledger version', async () => {
    const { instrumentId } = await fundFixture();
    const versionBefore = await investmentLedgerVersion(fixture.userId);
    const fingerprintBefore = await derivedFingerprint(fixture.userId);

    const detected = await write(fixture.ctx, (w) =>
      recordCorporateActionDetections(w, [
        {
          instrumentId,
          kind: 'split',
          exDate: isoDate('2026-06-01'),
          ratioNum: 5,
          ratioDen: 1,
          source: 'twelvedata',
        },
      ]),
    );
    expect(detected).toBe(1);

    const { rows: txns } = await db().execute<{ n: string }>(
      sql`select count(*)::text as n from investment_transactions where kind in ('split','bonus')`,
    );
    expect(txns[0]!.n).toBe('0');
    expect(await investmentLedgerVersion(fixture.userId)).toBe(versionBefore);
    expect(await derivedFingerprint(fixture.userId)).toBe(fingerprintBefore);
  });

  it('re-detecting the same action ten times leaves one row', async () => {
    const { instrumentId } = await fundFixture();
    const observation = {
      instrumentId,
      kind: 'split' as const,
      exDate: isoDate('2026-06-01'),
      ratioNum: 5,
      ratioDen: 1,
      source: 'twelvedata',
    };
    for (let i = 0; i < 10; i += 1) {
      await write(fixture.ctx, (w) => recordCorporateActionDetections(w, [observation]));
    }
    const { rows } = await db().execute<{ n: string }>(
      sql`select count(*)::text as n from corporate_action_detections`,
    );
    expect(rows[0]!.n).toBe('1');
  });

  it('SUPPRESSES market value rather than producing the phantom figure', async () => {
    const { instrumentId } = await fundFixture();
    await write(fixture.ctx, (w) => refreshPrices(w, registryWith(happyFetch)));

    // Priced before the detection lands.
    let ctx = await refreshCtx(fixture);
    expect((await quotesFor(ctx, [instrumentId])).get(instrumentId)!.status).not.toBe('missing');

    // A 1:5 split with an ex-date after the purchase and before today.
    await write(fixture.ctx, (w) =>
      recordCorporateActionDetections(w, [
        {
          instrumentId,
          kind: 'split',
          exDate: isoDate('2026-06-01'),
          ratioNum: 5,
          ratioDen: 1,
          source: 'twelvedata',
        },
      ]),
    );

    ctx = await refreshCtx(fixture);
    const quote = (await quotesFor(ctx, [instrumentId])).get(instrumentId)!;
    expect(quote.status).toBe('missing');
    if (quote.status !== 'missing') return;
    expect(quote.reason).toBe('unreconciled_corporate_action');

    const valued = await holdings(ctx);
    const holding = valued.holdings.find((h) => h.instrument.id === instrumentId)!;
    // 400 units (pre-split) × ₹250.50 (post-split) = ₹1,00,200 — the phantom.
    // It must not appear at all; the holding is excluded and named.
    expect(holding.marketValue).toBeNull();
    expect(holding.excludedReason).toBe('no_price');
    expect(valued.unpriced.map((i) => i.id)).toContain(instrumentId);
    // Cost basis and realised P&L are untouched by any of this.
    expect(holding.invested.minor).toBe(800000000n);
  });

  it('does not suppress an instrument bought AFTER the ex-date', async () => {
    const ctx0 = fixture.ctx;
    const accountId = await makeAccount(ctx0, {
      name: 'Zerodha',
      kind: 'brokerage',
      openingBalance: '500000',
      openingDate: '2026-01-01',
    });
    const instrumentId = await makeInstrument(ctx0, {
      symbol: '118989',
      name: 'HDFC Top 100 Fund - Growth',
      assetClass: 'mutual_fund',
    });
    await rawSql('update instruments set exchange = null, isin = $2 where id = $1', [
      instrumentId,
      'INF179K01XQ0',
    ]);
    // Purchased after the split: the recorded quantity is already post-split.
    must(
      await recordBuy(
        ctx0,
        { accountId, instrumentId, on: '2026-07-01', qty: '400', price: '200' },
        'mf_purchase',
      ),
    );
    await write(ctx0, (w) => refreshPrices(w, registryWith(happyFetch)));
    await write(ctx0, (w) =>
      recordCorporateActionDetections(w, [
        {
          instrumentId,
          kind: 'split',
          exDate: isoDate('2026-06-01'),
          ratioNum: 5,
          ratioDen: 1,
          source: 'twelvedata',
        },
      ]),
    );

    const ctx = await refreshCtx(fixture);
    const quote = (await quotesFor(ctx, [instrumentId])).get(instrumentId)!;
    // Suppressing this one would blank a holding whose figures are correct.
    expect(quote.status).not.toBe('missing');
  });
});

describe('a malformed provider response cannot corrupt financial state', () => {
  const HOSTILE = [
    '118989;INF179K01XQ0;INF179K01XR8;Too Precise;250.123456789;17-Aug-2026', // 9 decimals
    "118989;INF179K01XQ0;INF179K01XR8;Injected;'; drop table users; --;17-Aug-2026",
    '118989;INF179K01XQ0;INF179K01XR8;Negative;-5.0000;17-Aug-2026',
    '118989;INF179K01XQ0;INF179K01XR8;Impossible Date;250.5000;31-Feb-2026',
  ];

  it.each(HOSTILE)('leaves the ledger and prices untouched: %s', async (line) => {
    const { instrumentId } = await fundFixture();
    const before = await derivedFingerprint(fixture.userId);

    const hostile = textFetch((url) =>
      url.includes('amfiindia') ? { body: `${NAV_FILE}\n${line}` } : { body: FX_BODY },
    );
    const outcome = await write(fixture.ctx, (w) => refreshPrices(w, registryWith(hostile)));

    // Either the whole file is rejected, or the good row alone survives — never
    // a fabricated or truncated figure.
    expect(await derivedFingerprint(fixture.userId)).toBe(before);

    const { rows } = await db().execute<{ close: string }>(
      sql`select close from instrument_prices where instrument_id = ${instrumentId}`,
    );
    for (const row of rows) {
      expect(Number(row.close)).toBeGreaterThan(0);
      expect(row.close).toBe('250.50000000');
    }
    expect(outcome.rejected).toEqual([]);

    // And the users table is still there, which is the point of the third case.
    const { rows: users } = await db().execute(sql`select 1 from users limit 1`);
    expect(users).toHaveLength(1);
  });
});

describe('historical retrieval and as-of selection', () => {
  async function seedSeries(instrumentId: string, points: readonly [string, string][]) {
    const observations = points.map<PriceObservation>(([asOf, close]) => ({
      instrumentId,
      close: UnitPrice.of(close),
      currency: INR,
      tradingDate: isoDate(asOf),
      observedAt: new Date(`${asOf}T12:30:00Z`),
      kind: 'nav',
      source: 'amfi',
      providerRef: '118989',
    }));
    await write(fixture.ctx, (w) => storePriceObservations(w, observations));
  }

  it('respects inclusive date boundaries and returns a deterministic order', async () => {
    const { instrumentId } = await fundFixture();
    await seedSeries(instrumentId, [
      ['2026-08-10', '240'],
      ['2026-08-12', '245'],
      ['2026-08-14', '250'],
    ]);

    const ctx = await refreshCtx(fixture);
    const inner = await historicalCloses(ctx, [instrumentId], '2026-08-10', '2026-08-12');
    expect(inner.get(instrumentId)!.map((p) => p.asOf)).toEqual(['2026-08-10', '2026-08-12']);

    const empty = await historicalCloses(ctx, [instrumentId], '2026-09-01', '2026-09-30');
    expect(empty.get(instrumentId)).toBeUndefined();
  });

  it('carries a close back to a non-trading day, within the bound', async () => {
    const { instrumentId } = await fundFixture();
    await seedSeries(instrumentId, [['2026-08-14', '250']]);

    const ctx = await refreshCtx(fixture);
    const series = (await historicalCloses(ctx, [instrumentId], '2026-01-01', '2026-12-31')).get(
      instrumentId,
    )!;

    // Sunday 16 August — no session, and a TWR boundary could land here.
    const sunday = closeAsOf(series, isoDate('2026-08-16'), 'nav');
    expect(sunday).not.toBeNull();
    expect(sunday!.asOf).toBe('2026-08-14');
    expect(sunday!.carriedDays).toBe(2);
  });

  it('refuses to carry a close beyond the bound — a gap, not a stale figure', async () => {
    const { instrumentId } = await fundFixture();
    await seedSeries(instrumentId, [['2026-08-14', '250']]);

    const ctx = await refreshCtx(fixture);
    const series = (await historicalCloses(ctx, [instrumentId], '2026-01-01', '2026-12-31')).get(
      instrumentId,
    )!;

    // 40 days later: the provider evidently stopped. Valuing at the old close
    // would be invisible and wrong.
    expect(closeAsOf(series, isoDate('2026-09-23'), 'nav')).toBeNull();
  });

  it('never uses a later close for an earlier date', async () => {
    const { instrumentId } = await fundFixture();
    await seedSeries(instrumentId, [
      ['2026-08-10', '240'],
      ['2026-08-14', '250'],
    ]);
    const ctx = await refreshCtx(fixture);
    const series = (await historicalCloses(ctx, [instrumentId], '2026-01-01', '2026-12-31')).get(
      instrumentId,
    )!;

    const on12 = closeAsOf(series, isoDate('2026-08-12'), 'nav');
    expect(pToDbString(on12!.close)).toBe('240.00000000');
  });
});

describe('backfill', () => {
  it('refuses an instrument that is not the user’s', async () => {
    await fundFixture();
    const result = await write(fixture.ctx, (w) =>
      backfillPrices(
        w,
        registryWith(happyFetch),
        '00000000-0000-0000-0000-000000000000',
        isoDate('2026-01-01'),
        isoDate('2026-08-17'),
      ),
    );
    expect(result.ok).toBe(false);
  });

  it('reports the provider’s refusal rather than writing an empty series', async () => {
    const { instrumentId } = await fundFixture();
    // No shipping adapter supplies history yet — AMFI's daily file has none.
    const result = await write(fixture.ctx, (w) =>
      backfillPrices(w, registryWith(happyFetch), instrumentId, isoDate('2026-01-01'), isoDate('2026-08-17')),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/history/i);
  });
});

describe('refs', () => {
  it('excludes a fully disposed position — there is nothing to price', async () => {
    const { accountId, instrumentId } = await fundFixture();
    let ctx = await refreshCtx(fixture);
    expect((await heldInstrumentRefs(ctx)).map((r) => r.instrumentId)).toContain(instrumentId);

    // Sold through the service rather than by editing `positions` directly: the
    // row is a rebuildable cache with a `CHECK` tying quantity to basis (D-25),
    // and a fixture that bypasses the engine would be testing a state the engine
    // cannot produce.
    must(
      await recordSell(
        ctx,
        { accountId, instrumentId, on: '2026-08-15', qty: '400', price: '250' },
        'mf_redemption',
      ),
    );

    ctx = await refreshCtx(fixture);
    // The position row survives for its realised-P&L history (edge case 18) and
    // is correctly not offered to a provider.
    expect(await heldInstrumentRefs(ctx)).toHaveLength(0);
  });
});
