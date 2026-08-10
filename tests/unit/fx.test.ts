import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/date';
import { currency, Money, toDbString } from '@/lib/decimal/money';
import { Rate, rToDbString } from '@/lib/decimal/rate';
import { selectRate, type FxRateRow } from '@/server/domain/fx';
import { fromRows } from '@/server/services/_fx';

const INR = currency('INR');
const USD = currency('USD');
const EUR = currency('EUR');

const row = (base: typeof INR, quote: typeof INR, asOf: string, rate: string): FxRateRow => ({
  baseCode: base,
  quoteCode: quote,
  asOf: isoDate(asOf),
  rate: Rate.of(rate),
});

const RATES: FxRateRow[] = [
  row(USD, INR, '2026-08-01', '83.00'),
  row(USD, INR, '2026-08-05', '83.50'),
  row(INR, EUR, '2026-08-03', '0.011'),
];

describe('selectRate', () => {
  it('returns 1 for a currency against itself, without a lookup', () => {
    const result = selectRate([], INR, INR, isoDate('2026-08-10'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(rToDbString(result.value.rate)).toBe('1.0000000000');
    expect(result.value.source).toBe('identity');
  });

  it('uses an exact date match', () => {
    const result = selectRate(RATES, USD, INR, isoDate('2026-08-05'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(rToDbString(result.value.rate)).toBe('83.5000000000');
    expect(result.value.asOf).toBe('2026-08-05');
  });

  it('falls back to the most recent earlier date (edge case 17)', () => {
    const result = selectRate(RATES, USD, INR, isoDate('2026-08-04'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(rToDbString(result.value.rate)).toBe('83.0000000000');
    expect(result.value.asOf).toBe('2026-08-01');
  });

  it('never uses a later rate for an earlier date', () => {
    // If it did, last March's totals would change every time a new rate arrived.
    const result = selectRate(RATES, USD, INR, isoDate('2026-07-31'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('no_rate');
  });

  it('inverts the opposite direction when the direct one is missing', () => {
    const result = selectRate(RATES, EUR, INR, isoDate('2026-08-10'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 1 INR = 0.011 EUR, so 1 EUR = 90.909090…, half_even at scale 10.
    expect(result.value.source).toBe('inverse');
    expect(rToDbString(result.value.rate)).toBe('90.9090909091');
  });

  it('prefers a direct rate over a more recent inverse one', () => {
    const rates = [...RATES, row(INR, USD, '2026-08-09', '0.012')];
    const result = selectRate(rates, USD, INR, isoDate('2026-08-10'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The stored direction is the one that was actually quoted.
    expect(result.value.source).toBe('direct');
    expect(rToDbString(result.value.rate)).toBe('83.5000000000');
  });

  it('reports no_rate rather than defaulting to 1 when nothing is available', () => {
    const result = selectRate(RATES, currency('JPY'), INR, isoDate('2026-08-10'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('no_rate');
  });

  it('ignores rows dated after the requested date entirely', () => {
    const result = selectRate([row(USD, INR, '2030-01-01', '99')], USD, INR, isoDate('2026-08-10'));
    expect(result.ok).toBe(false);
  });
});

describe('the request-scoped lookup', () => {
  const fx = fromRows(RATES, INR);

  it('converts an amount and rounds the same way the database CHECK does', () => {
    const result = fx.toBase(Money.of('100', USD), isoDate('2026-08-05'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toDbString(result.value.amount)).toBe('8350.0000');
    expect(result.value.amount.currency).toBe(INR);
  });

  it('is a no-op for the base currency', () => {
    const result = fx.toBase(Money.of('1234.5678', INR), isoDate('2026-08-05'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toDbString(result.value.amount)).toBe('1234.5678');
    expect(rToDbString(result.value.rate)).toBe('1.0000000000');
  });

  it('propagates no_rate rather than converting at a guessed rate', () => {
    const result = fx.toBase(Money.of('100', USD), isoDate('2020-01-01'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('no_rate');
  });
});
