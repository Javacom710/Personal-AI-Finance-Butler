/**
 * FX resolution — [FINANCIAL-DOMAIN.md §2](../../docs/FINANCIAL-DOMAIN.md#2-fx),
 * [TESTING.md §6.2](../../docs/TESTING.md).
 *
 * Finding **M1**: reference feeds quote everything against one reference
 * currency, so a feed publishing `EUR→INR` and `EUR→USD` and nothing else left a
 * USD holding in an INR-base portfolio with no route at all. It was not reported
 * as a wrong number — it was *excluded*, silently, taking the whole foreign block
 * out of net worth with nothing on screen to notice.
 */

import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/date';
import { currency } from '@/lib/decimal/money';
import { Rate, rToDbString } from '@/lib/decimal/rate';
import { selectRate, type FxRateRow } from '@/server/domain/fx';

const INR = currency('INR');
const USD = currency('USD');
const EUR = currency('EUR');
const JPY = currency('JPY');

const row = (base: string, quote: string, asOf: string, rate: string): FxRateRow => ({
  baseCode: currency(base),
  quoteCode: currency(quote),
  asOf: isoDate(asOf),
  rate: Rate.of(rate),
});

const ON = isoDate('2026-08-17');

describe('direct and inverse', () => {
  it('resolves a direct pair', () => {
    const result = selectRate([row('USD', 'INR', '2026-08-17', '95.61')], USD, INR, ON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe('direct');
    expect(rToDbString(result.value.rate)).toBe('95.6100000000');
  });

  it('inverts when only the opposite direction exists', () => {
    const result = selectRate([row('INR', 'USD', '2026-08-17', '0.0104591570')], USD, INR, ON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe('inverse');
    // 1 / 0.010459157 ≈ 95.6099... — derived, and recorded as derived.
    expect(Number(rToDbString(result.value.rate))).toBeCloseTo(95.61, 3);
  });

  it('is the identity for a currency against itself, with no lookup', () => {
    const result = selectRate([], INR, INR, ON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe('identity');
    expect(rToDbString(result.value.rate)).toBe('1.0000000000');
  });
});

describe('triangulation', () => {
  const referenceFeed = [
    row('EUR', 'INR', '2026-08-17', '104.0000000000'),
    row('EUR', 'USD', '2026-08-17', '1.0880000000'),
  ];

  it('finds a route through the reference currency instead of dropping the holding', () => {
    const result = selectRate(referenceFeed, USD, INR, ON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.source).toBe('triangulated');
    expect(result.value.via).toBe(EUR);
    // USD→EUR is 1/1.088; EUR→INR is 104. 104 / 1.088 = 95.588235...
    expect(Number(rToDbString(result.value.rate))).toBeCloseTo(95.5882, 3);
  });

  it('is dated by its STALEST leg, never its freshest', () => {
    const staleLeg = [
      row('EUR', 'INR', '2026-08-17', '104.0000000000'), // today
      row('EUR', 'USD', '2026-07-01', '1.0880000000'), // six weeks old
    ];
    const result = selectRate(staleLeg, USD, INR, ON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A composed rate is no fresher than the oldest observation behind it.
    expect(result.value.asOf).toBe('2026-07-01');
  });

  it('a direct pair wins even when a triangulated route is more recent', () => {
    const mixed = [
      row('USD', 'INR', '2026-07-01', '93.0000000000'), // older, but quoted
      row('EUR', 'INR', '2026-08-17', '104.0000000000'),
      row('EUR', 'USD', '2026-08-17', '1.0880000000'),
    ];
    const result = selectRate(mixed, USD, INR, ON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe('direct');
    expect(rToDbString(result.value.rate)).toBe('93.0000000000');
  });

  it('an inverse pair also wins over a triangulated route', () => {
    const mixed = [
      row('INR', 'USD', '2026-07-01', '0.0107526882'),
      row('EUR', 'INR', '2026-08-17', '104.0000000000'),
      row('EUR', 'USD', '2026-08-17', '1.0880000000'),
    ];
    const result = selectRate(mixed, USD, INR, ON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe('inverse');
  });

  it('refuses a leg dated after the date asked for', () => {
    const future = [
      row('EUR', 'INR', '2026-08-17', '104.0000000000'),
      row('EUR', 'USD', '2026-09-01', '1.0880000000'), // after `on`
    ];
    // Using a later rate for an earlier date would make last March's totals
    // change every time a rate arrives.
    expect(selectRate(future, USD, INR, ON).ok).toBe(false);
  });

  it('will not chain through two pivots', () => {
    // USD→GBP→EUR→INR exists, but that is two hops and two roundings against a
    // rate no source published.
    const twoHops = [
      row('GBP', 'USD', '2026-08-17', '1.2700000000'),
      row('GBP', 'EUR', '2026-08-17', '1.1670000000'),
      row('EUR', 'INR', '2026-08-17', '104.0000000000'),
    ];
    const result = selectRate(twoHops, USD, INR, ON);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('no_rate');
  });

  it('picks the freshest available route deterministically', () => {
    const twoRoutes = [
      row('EUR', 'USD', '2026-07-01', '1.0880000000'),
      row('EUR', 'INR', '2026-07-01', '104.0000000000'),
      row('JPY', 'USD', '2026-08-17', '0.0068000000'),
      row('JPY', 'INR', '2026-08-17', '0.6500000000'),
    ];
    const result = selectRate(twoRoutes, USD, INR, ON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.via).toBe(JPY);
    expect(result.value.asOf).toBe('2026-08-17');

    // Same rows in a different order must give the same answer, or a historical
    // total would depend on row ordering.
    const shuffled = selectRate([...twoRoutes].reverse(), USD, INR, ON);
    expect(shuffled.ok).toBe(true);
    if (!shuffled.ok) return;
    expect(shuffled.value.via).toBe(JPY);
    expect(rToDbString(shuffled.value.rate)).toBe(rToDbString(result.value.rate));
  });
});

describe('historical and as-of selection', () => {
  const series = [
    row('USD', 'INR', '2026-08-10', '95.0000000000'),
    row('USD', 'INR', '2026-08-14', '95.6100000000'),
    row('USD', 'INR', '2026-08-20', '96.0000000000'),
  ];

  it('takes an exact match when one exists', () => {
    const result = selectRate(series, USD, INR, isoDate('2026-08-14'));
    expect(result.ok && rToDbString(result.value.rate)).toBe('95.6100000000');
  });

  it('takes the most recent EARLIER rate, never a later one', () => {
    const result = selectRate(series, USD, INR, isoDate('2026-08-17'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.asOf).toBe('2026-08-14');
    expect(rToDbString(result.value.rate)).toBe('95.6100000000');
  });

  it('never interpolates between two observations', () => {
    const result = selectRate(series, USD, INR, isoDate('2026-08-17'));
    // Midway between 95.61 and 96.00 would be 95.805. It must be neither.
    expect(result.ok && rToDbString(result.value.rate)).not.toBe('95.8050000000');
  });

  it('has no route before the first observation', () => {
    expect(selectRate(series, USD, INR, isoDate('2026-08-01')).ok).toBe(false);
  });
});

describe('missing route', () => {
  it('reports no_rate rather than inventing one', () => {
    const result = selectRate([row('EUR', 'GBP', '2026-08-17', '0.8570000000')], USD, INR, ON);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('no_rate');
  });

  it('reports no_rate on a completely empty table', () => {
    expect(selectRate([], USD, INR, ON).ok).toBe(false);
  });
});
