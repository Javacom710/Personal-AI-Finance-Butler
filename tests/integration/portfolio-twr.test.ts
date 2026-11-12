import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { rToDbString } from '@/lib/decimal/rate';
import { portfolio, portfolioTwr } from '@/server/services';
import { closeHarness, truncateAll } from './harness';
import {
  makeInstrument,
  recordBuy,
  recordCorporateAction,
  recordSell,
  recordTransferIn,
  recordTransferOut,
  storeClose,
  truncateInvestments,
} from './investment-harness';
import {
  closeMoneyHarness,
  makeAccount,
  must,
  setupMoneyFixture,
  truncateMoney,
  type MoneyFixture,
} from './money-harness';

/**
 * Time-weighted return, wired (OD-18, INVESTMENT-DOMAIN.md §8.2).
 *
 * The engine's arithmetic is unit-tested in `tests/unit/twr.test.ts`. What is
 * asserted here is the service's half: that the valuations it assembles from
 * the ledger and `instrument_prices` produce the figure a hand calculation
 * gives, that a trade away from the close is attributed to the right period,
 * and that one unvalued holding on one boundary yields the reason rather than a
 * figure chained across the dates that had prices.
 */

let fixture: MoneyFixture;
let demat: string;

// Monday 10 Aug 2026, after the NSE close.
const NOW = new Date('2026-08-10T12:00:00Z');

beforeAll(async () => {
  await truncateAll();
  fixture = await setupMoneyFixture({ now: NOW });
});

beforeEach(async () => {
  await truncateInvestments();
  await truncateMoney();
  demat = await makeAccount(fixture.ctx, { name: 'Demat', kind: 'brokerage', openingBalance: '1000000' });
});

afterAll(async () => {
  await closeMoneyHarness();
  await closeHarness();
});

async function closes(instrumentId: string, series: readonly [on: string, close: string][]) {
  for (const [on, close] of series) await storeClose(fixture.ctx, { instrumentId, on, close });
}

describe('portfolioTwr', () => {
  it('chain-links the periods between flows, unaffected by the size of the second purchase', async () => {
    const stock = await makeInstrument(fixture.ctx, { symbol: 'TWRA' });
    await closes(stock, [['2026-01-05', '100'], ['2026-04-01', '120'], ['2026-08-10', '132']]);
    must(await recordBuy(fixture.ctx, { accountId: demat, instrumentId: stock, on: '2026-01-05', qty: '100', price: '100' }));
    must(await recordBuy(fixture.ctx, { accountId: demat, instrumentId: stock, on: '2026-04-01', qty: '50', price: '120' }));

    // 5 Jan → 1 Apr: 10,000 → 12,000 = +20%.   1 Apr → 10 Aug: 18,000 → 19,800 = +10%.
    // 1.20 × 1.10 − 1 = 32%. 217 days, so not annualised.
    const result = await portfolioTwr(fixture.ctx);
    expect(result.reason).toBeUndefined();
    expect(rToDbString(result.value!.twr)).toBe('0.3200000000');
    expect(result.value!.annualised).toBe(false);
    expect(result.value!.subPeriods).toBe(2);
    expect(result.value!.days).toBe(217);

    // The summary carries the same figure: one implementation, two readers.
    const summary = must(await portfolio(fixture.ctx)).summary;
    expect(rToDbString(summary.twr.value!)).toBe('0.3200000000');

    // A view that does not show TWR skips it, says so, and changes nothing else.
    const without = must(await portfolio(fixture.ctx, {}, { twr: false }));
    expect(without.summary.twr).toEqual({ value: null, reason: 'not_computed' });
    expect(without.twr).toEqual({ value: null, reason: 'not_computed' });
    expect({ ...without.summary, twr: null }).toEqual({ ...summary, twr: null });
  });

  it('attributes a trade away from the close to the period that ends that day', async () => {
    const stock = await makeInstrument(fixture.ctx, { symbol: 'TWRB' });
    await closes(stock, [['2026-01-05', '100'], ['2026-04-01', '120'], ['2026-08-10', '132']]);
    must(await recordBuy(fixture.ctx, { accountId: demat, instrumentId: stock, on: '2026-01-05', qty: '100', price: '100' }));
    // Bought at 118 on a day that closed at 120: ₹100 of gain before the close.
    must(await recordBuy(fixture.ctx, { accountId: demat, instrumentId: stock, on: '2026-04-01', qty: '50', price: '118' }));

    // Period 1 closes at 18,000 − 5,900 = 12,100 on 10,000: +21%.
    // Period 2 opens at 18,000 and ends at 19,800: +10%.   1.21 × 1.10 − 1 = 33.1%.
    const result = await portfolioTwr(fixture.ctx);
    expect(rToDbString(result.value!.twr)).toBe('0.3310000000');
  });

  it('counts the first purchase\'s fee, and a first fill away from the close, as a result', async () => {
    const stock = await makeInstrument(fixture.ctx, { symbol: 'TWRH' });
    await closes(stock, [['2026-01-05', '100'], ['2026-08-10', '100']]);
    // ₹10,100 paid for holdings worth ₹10,000 at the close, and the price never moves.
    must(await recordBuy(fixture.ctx, { accountId: demat, instrumentId: stock, on: '2026-01-05', qty: '100', price: '100', fees: '100' }));

    // −100 on 10,100 contributed = −0.990099…%, not 0%.
    const result = await portfolioTwr(fixture.ctx);
    expect(rToDbString(result.value!.twr)).toBe('-0.0099010000');
  });

  it('counts a first fill below the close as a gain', async () => {
    const stock = await makeInstrument(fixture.ctx, { symbol: 'TWRI' });
    await closes(stock, [['2026-01-05', '100'], ['2026-08-10', '100']]);
    must(await recordBuy(fixture.ctx, { accountId: demat, instrumentId: stock, on: '2026-01-05', qty: '100', price: '80' }));

    // ₹8,000 paid for ₹10,000 at the close: +2,000 on 8,000 = +25%.
    const result = await portfolioTwr(fixture.ctx);
    expect(rToDbString(result.value!.twr)).toBe('0.2500000000');
  });

  it('uses a stale price and says so, rather than passing the return off as current', async () => {
    const stock = await makeInstrument(fixture.ctx, { symbol: 'TWRJ' });
    // Last priced on 1 June; today is 10 August.
    await closes(stock, [['2026-01-05', '100'], ['2026-06-01', '120']]);
    must(await recordBuy(fixture.ctx, { accountId: demat, instrumentId: stock, on: '2026-01-05', qty: '100', price: '100' }));

    const result = await portfolioTwr(fixture.ctx);
    expect(rToDbString(result.value!.twr)).toBe('0.2000000000');
    expect(result.value!.valuations).toBe(2);
    expect(result.value!.staleValuations).toBe(1);
    expect(result.value!.staleToday).toBe(true);
    expect(must(await portfolio(fixture.ctx)).twr.value!.staleToday).toBe(true);
  });

  it('reports no stale valuation when every boundary is freshly priced', async () => {
    const stock = await makeInstrument(fixture.ctx, { symbol: 'TWRK' });
    await closes(stock, [['2026-01-05', '100'], ['2026-08-10', '132']]);
    must(await recordBuy(fixture.ctx, { accountId: demat, instrumentId: stock, on: '2026-01-05', qty: '100', price: '100' }));

    const result = await portfolioTwr(fixture.ctx);
    expect(result.value!.staleValuations).toBe(0);
    expect(result.value!.staleToday).toBe(false);
  });

  it('treats shares transferred in from outside as capital, not as performance', async () => {
    const stock = await makeInstrument(fixture.ctx, { symbol: 'TWRL' });
    await closes(stock, [['2026-01-05', '100'], ['2026-04-01', '100'], ['2026-08-10', '100']]);
    must(await recordBuy(fixture.ctx, { accountId: demat, instrumentId: stock, on: '2026-01-05', qty: '100', price: '100' }));
    // ₹10,000 of the same shares arrive with no cash, and the price never moves.
    must(await recordTransferIn(fixture.ctx, { accountId: demat, instrumentId: stock, on: '2026-04-01', qty: '100', price: '100' }));

    // Holdings doubled because capital arrived: 0%, not 100%.
    const result = await portfolioTwr(fixture.ctx);
    expect(rToDbString(result.value!.twr)).toBe('0.0000000000');
    expect(result.value!.subPeriods).toBe(2);
  });

  it('values a transfer at what the shares were worth, not at their carried cost', async () => {
    const stock = await makeInstrument(fixture.ctx, { symbol: 'TWRN' });
    await closes(stock, [['2026-01-05', '100'], ['2026-04-01', '100'], ['2026-08-10', '100']]);
    must(await recordBuy(fixture.ctx, { accountId: demat, instrumentId: stock, on: '2026-01-05', qty: '100', price: '100' }));
    // Worth ₹10,000 on the day, carried in at a ₹5,000 basis from years ago.
    must(await recordTransferIn(fixture.ctx, { accountId: demat, instrumentId: stock, on: '2026-04-01', qty: '100', price: '50', acquiredOn: '2020-01-01' }));

    // The gain behind that basis was made before the shares arrived: 0%, not 50%.
    const result = await portfolioTwr(fixture.ctx);
    expect(rToDbString(result.value!.twr)).toBe('0.0000000000');
  });

  it('restates a transfer dated on a split onto the split-adjusted close', async () => {
    const stock = await makeInstrument(fixture.ctx, { symbol: 'TWRQ' });
    // 2:1 split on 1 April: ₹100 a share before, ₹50 after, no change in value.
    await closes(stock, [['2026-01-05', '100'], ['2026-04-01', '50'], ['2026-08-10', '50']]);
    must(await recordBuy(fixture.ctx, { accountId: demat, instrumentId: stock, on: '2026-01-05', qty: '100', price: '100' }));
    must(await recordTransferIn(fixture.ctx, { accountId: demat, instrumentId: stock, on: '2026-04-01', qty: '100', price: '100' }));
    must(await recordCorporateAction(fixture.ctx, { accountId: demat, instrumentId: stock, on: '2026-04-01', num: 2, den: 1 }));

    // 100 shares arrive worth ₹10,000 and become 200 at ₹50. 400 × 50 = ₹20,000
    // on ₹10,000 held plus ₹10,000 transferred: 0%, not 50%.
    const result = await portfolioTwr(fixture.ctx);
    expect(rToDbString(result.value!.twr)).toBe('0.0000000000');
  });

  it('restates a same-day transfer for a bonus issue too', async () => {
    const stock = await makeInstrument(fixture.ctx, { symbol: 'TWRR' });
    // 1:1 bonus on 1 April: one new share per share held, price halves.
    await closes(stock, [['2026-01-05', '100'], ['2026-04-01', '50'], ['2026-08-10', '50']]);
    must(await recordBuy(fixture.ctx, { accountId: demat, instrumentId: stock, on: '2026-01-05', qty: '100', price: '100' }));
    must(await recordTransferIn(fixture.ctx, { accountId: demat, instrumentId: stock, on: '2026-04-01', qty: '100', price: '100' }));
    must(await recordCorporateAction(fixture.ctx, { accountId: demat, instrumentId: stock, on: '2026-04-01', num: 1, den: 1 }, 'bonus'));

    const result = await portfolioTwr(fixture.ctx);
    expect(rToDbString(result.value!.twr)).toBe('0.0000000000');
  });

  it('ignores a future-dated transfer, whose price cannot exist yet', async () => {
    const stock = await makeInstrument(fixture.ctx, { symbol: 'TWRS' });
    const later = await makeInstrument(fixture.ctx, { symbol: 'TWRT' });
    await closes(stock, [['2026-01-05', '100'], ['2026-08-10', '132']]);
    must(await recordBuy(fixture.ctx, { accountId: demat, instrumentId: stock, on: '2026-01-05', qty: '100', price: '100' }));
    // Scheduled for next month, in an instrument nobody has priced.
    must(await recordTransferIn(fixture.ctx, { accountId: demat, instrumentId: later, on: '2026-09-15', qty: '10', price: '100' }));

    const result = await portfolioTwr(fixture.ctx);
    expect(rToDbString(result.value!.twr)).toBe('0.3200000000');
    expect(result.value!.subPeriods).toBe(1);
  });

  it('flags a stale price used to value a transfer that takes the last units out', async () => {
    const stock = await makeInstrument(fixture.ctx, { symbol: 'TWRU' });
    // Last priced on 1 June; everything leaves today, 10 August.
    await closes(stock, [['2026-01-05', '100'], ['2026-06-01', '120']]);
    must(await recordBuy(fixture.ctx, { accountId: demat, instrumentId: stock, on: '2026-01-05', qty: '100', price: '100' }));
    must(await recordTransferOut(fixture.ctx, { accountId: demat, instrumentId: stock, on: '2026-08-10', qty: '100', price: '100' }));

    // Nothing is left to value, so the boundary alone would report no staleness.
    const result = await portfolioTwr(fixture.ctx);
    expect(rToDbString(result.value!.twr)).toBe('0.2000000000');
    expect(result.value!.staleValuations).toBe(1);
    expect(result.value!.staleToday).toBe(true);
  });

  it('cannot state a return when a transferred holding has no price on its transfer date', async () => {
    const priced = await makeInstrument(fixture.ctx, { symbol: 'TWRO' });
    const gap = await makeInstrument(fixture.ctx, { symbol: 'TWRP' });
    await closes(priced, [['2026-01-05', '100'], ['2026-04-01', '100'], ['2026-06-01', '100'], ['2026-08-10', '100']]);
    await closes(gap, [['2026-04-01', '100']]);
    must(await recordBuy(fixture.ctx, { accountId: demat, instrumentId: priced, on: '2026-01-05', qty: '100', price: '100' }));
    // In on a priced day, out — entirely — on a day with no price in reach.
    must(await recordTransferIn(fixture.ctx, { accountId: demat, instrumentId: gap, on: '2026-04-01', qty: '10', price: '100' }));
    must(await recordTransferOut(fixture.ctx, { accountId: demat, instrumentId: gap, on: '2026-06-01', qty: '10', price: '100' }));

    const result = await portfolioTwr(fixture.ctx);
    expect(result.value).toBeNull();
    expect(result.reason).toBe('insufficient_price_history');
  });

  it('treats shares transferred out as a withdrawal, and a matched pair as nothing', async () => {
    const other = await makeAccount(fixture.ctx, { name: 'Second Demat', kind: 'brokerage' });
    const stock = await makeInstrument(fixture.ctx, { symbol: 'TWRM' });
    await closes(stock, [['2026-01-05', '100'], ['2026-04-01', '120'], ['2026-06-01', '120'], ['2026-08-10', '132']]);
    must(await recordBuy(fixture.ctx, { accountId: demat, instrumentId: stock, on: '2026-01-05', qty: '100', price: '100' }));
    // A matched pair between the user's own accounts on 1 April…
    must(await recordTransferOut(fixture.ctx, { accountId: demat, instrumentId: stock, on: '2026-04-01', qty: '50', price: '120' }));
    must(await recordTransferIn(fixture.ctx, { accountId: other, instrumentId: stock, on: '2026-04-01', qty: '50', price: '120' }));
    // …and 20 shares leaving the portfolio altogether on 1 June.
    must(await recordTransferOut(fixture.ctx, { accountId: other, instrumentId: stock, on: '2026-06-01', qty: '20', price: '120' }));

    // Price path 100 → 120 → 120 → 132 is +20%, 0%, +10%: 32% whatever moved where.
    const result = await portfolioTwr(fixture.ctx);
    expect(rToDbString(result.value!.twr)).toBe('0.3200000000');
  });

  it('treats sale proceeds as a withdrawal, not as a loss', async () => {
    const stock = await makeInstrument(fixture.ctx, { symbol: 'TWRC' });
    await closes(stock, [['2026-01-05', '100'], ['2026-04-01', '120'], ['2026-08-10', '132']]);
    must(await recordBuy(fixture.ctx, { accountId: demat, instrumentId: stock, on: '2026-01-05', qty: '100', price: '100' }));
    must(await recordSell(fixture.ctx, { accountId: demat, instrumentId: stock, on: '2026-04-01', qty: '40', price: '120' }));

    // Selling 40 at the close changes how much is invested, not how it performed: still 32%.
    const result = await portfolioTwr(fixture.ctx);
    expect(rToDbString(result.value!.twr)).toBe('0.3200000000');
  });

  it('reports the reason, not a partial figure, when one holding has no price on one boundary', async () => {
    const priced = await makeInstrument(fixture.ctx, { symbol: 'TWRD' });
    const gap = await makeInstrument(fixture.ctx, { symbol: 'TWRE' });
    await closes(priced, [['2026-01-05', '100'], ['2026-04-01', '120'], ['2026-08-10', '132']]);
    // Priced today, but nothing on or near the day it was bought.
    await closes(gap, [['2026-08-10', '50']]);
    must(await recordBuy(fixture.ctx, { accountId: demat, instrumentId: priced, on: '2026-01-05', qty: '100', price: '100' }));
    must(await recordBuy(fixture.ctx, { accountId: demat, instrumentId: gap, on: '2026-04-01', qty: '10', price: '40' }));

    const result = await portfolioTwr(fixture.ctx);
    expect(result.value).toBeNull();
    expect(result.reason).toBe('insufficient_price_history');
    expect(must(await portfolio(fixture.ctx)).summary.twr.reason).toBe('insufficient_price_history');
  });

  it('has nothing to measure with no transactions, or when the first one is today', async () => {
    expect((await portfolioTwr(fixture.ctx)).reason).toBe('no_data');

    const stock = await makeInstrument(fixture.ctx, { symbol: 'TWRF' });
    await closes(stock, [['2026-08-10', '100']]);
    must(await recordBuy(fixture.ctx, { accountId: demat, instrumentId: stock, on: '2026-08-10', qty: '10', price: '100' }));
    expect((await portfolioTwr(fixture.ctx)).reason).toBe('no_data');
  });

  it('stays unavailable for a single account or instrument', async () => {
    const stock = await makeInstrument(fixture.ctx, { symbol: 'TWRG' });
    await closes(stock, [['2026-01-05', '100'], ['2026-08-10', '132']]);
    must(await recordBuy(fixture.ctx, { accountId: demat, instrumentId: stock, on: '2026-01-05', qty: '100', price: '100' }));

    expect(must(await portfolio(fixture.ctx)).summary.twr.value).not.toBeNull();
    expect(must(await portfolio(fixture.ctx, { instrumentId: stock })).summary.twr.reason).toBe('insufficient_price_history');
    expect(must(await portfolio(fixture.ctx, { accountId: demat })).summary.twr.reason).toBe('insufficient_price_history');
  });
});
