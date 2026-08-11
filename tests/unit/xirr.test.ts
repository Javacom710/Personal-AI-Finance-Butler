/**
 * XIRR (TESTING.md §3, INVESTMENT-DOMAIN.md §7).
 *
 * The reference series below are **analytically exact**: each is constructed so
 * the root is a round number that can be verified by hand rather than by
 * agreeing with the implementation. A series over exactly 365 days with
 * `−1000 → +1100` has `(1+r)^1 = 1.1`, so the answer is 10% and nothing else.
 *
 * Every `null` path asserts **the reason** as well as the `null` — a test that
 * asserted only `null` would pass against a function that always failed.
 */

import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/date';
import { Money, currency } from '@/lib/decimal/money';
import { rToNumber } from '@/lib/decimal/rate';
import { xirr, type CashFlow } from '@/server/domain/calc/xirr';

const INR = currency('INR');

const flow = (on: string, amount: string): CashFlow => ({
  on: isoDate(on),
  amount: Money.of(amount, INR),
});

/** The solved rate as a number, to six decimal places. */
function solved(flows: readonly CashFlow[]): number {
  const result = xirr(flows);
  if (result.value === null) throw new Error(`expected a rate, got ${result.reason}`);
  return rToNumber(result.value);
}

describe('known-answer series', () => {
  // 2021 and 2022 are not leap years, so each of these spans exactly 365 days
  // and actual/365 makes the exponent a whole number.
  it('−1000 → +1100 over one year is exactly 10%', () => {
    expect(solved([flow('2021-01-01', '-1000'), flow('2022-01-01', '1100')])).toBeCloseTo(0.1, 6);
  });

  it('−1000 → +1210 over two years is exactly 10%', () => {
    expect(solved([flow('2021-01-01', '-1000'), flow('2023-01-01', '1210')])).toBeCloseTo(0.1, 6);
  });

  it('−1000 → +500 over one year is exactly −50%', () => {
    expect(solved([flow('2021-01-01', '-1000'), flow('2022-01-01', '500')])).toBeCloseTo(-0.5, 6);
  });

  it('−1000 → +1000 over one year is exactly 0%', () => {
    expect(solved([flow('2021-01-01', '-1000'), flow('2022-01-01', '1000')])).toBeCloseTo(0, 6);
  });

  it('solves a three-flow series whose root is a whole 10%', () => {
    // −1000 at t=0, −1000 at t=1, +2310 at t=2 gives 1000x² + 1000x − 2310 = 0
    // with x = 1+r; the positive root is x = 1.1.
    expect(
      solved([
        flow('2021-01-01', '-1000'),
        flow('2022-01-01', '-1000'),
        flow('2023-01-01', '2310'),
      ]),
    ).toBeCloseTo(0.1, 6);
  });

  it('is unaffected by the order the flows arrive in', () => {
    const forward = solved([flow('2021-01-01', '-1000'), flow('2023-01-01', '1210')]);
    const reversed = solved([flow('2023-01-01', '1210'), flow('2021-01-01', '-1000')]);
    expect(reversed).toBe(forward);
  });

  it('converges via bisection on a −99.9% return, where Newton runs off', () => {
    // 1/1000 over one year: the root sits just inside the [-0.9999, 10] bracket.
    expect(solved([flow('2021-01-01', '-1000'), flow('2022-01-01', '1')])).toBeCloseTo(-0.999, 6);
  });

  it('handles a −95% return near the bracket edge', () => {
    expect(solved([flow('2021-01-01', '-1000'), flow('2022-01-01', '50')])).toBeCloseTo(-0.95, 6);
  });

  it('handles a very large positive return', () => {
    // ×5 in a year is 400%.
    expect(solved([flow('2021-01-01', '-1000'), flow('2022-01-01', '5000')])).toBeCloseTo(4, 6);
  });

  it('handles many small flows over a long window without drifting', () => {
    // ₹1,000 a month for a year, worth ₹12,000 at the end: no gain, so 0%.
    const contributions: CashFlow[] = [];
    for (let month = 1; month <= 12; month += 1) {
      contributions.push(flow(`2021-${month.toString().padStart(2, '0')}-01`, '-1000'));
    }
    contributions.push(flow('2022-01-01', '12000'));
    expect(solved(contributions)).toBeCloseTo(0, 6);
  });
});

describe('scope construction (INVESTMENT-DOMAIN.md §7)', () => {
  it('nets a dividend reinvested the same day to zero', () => {
    const reinvested = solved([
      flow('2021-01-01', '-1000'),
      flow('2022-01-01', '500'), // dividend received
      flow('2022-01-01', '-500'), // and immediately reinvested
      flow('2023-01-01', '1210'),
    ]);
    const asIfItNeverHappened = solved([flow('2021-01-01', '-1000'), flow('2023-01-01', '1210')]);
    expect(reinvested).toBeCloseTo(asIfItNeverHappened, 6);
  });

  it('keeps an un-reinvested dividend as a return', () => {
    const withDividend = solved([
      flow('2021-01-01', '-1000'),
      flow('2022-01-01', '500'),
      flow('2023-01-01', '1210'),
    ]);
    const without = solved([flow('2021-01-01', '-1000'), flow('2023-01-01', '1210')]);
    expect(withDividend).toBeGreaterThan(without);
  });

  it('gives the same answer whether a matched transfer pair is present or absent', () => {
    // At portfolio scope a transfer_out and its matching transfer_in are both
    // excluded, because the pair nets to zero.
    const excluded = solved([flow('2021-01-01', '-1000'), flow('2023-01-01', '1210')]);
    const alsoExcluded = solved([flow('2021-01-01', '-1000'), flow('2023-01-01', '1210')]);
    expect(alsoExcluded).toBe(excluded);
  });

  it('reports a divergent return when an unmatched transfer_in is treated as a zero flow', () => {
    // Shares appearing from nowhere, then sold: with the inflow recorded at
    // gross_amount the answer is finite; treating it as zero leaves an
    // all-positive series with no root at all.
    const asZeroFlow = xirr([flow('2021-01-01', '0'), flow('2022-01-01', '1210')]);
    expect(asZeroFlow.value).toBeNull();
    expect(asZeroFlow.reason).toBe('no_sign_change');

    const atGross = solved([flow('2021-01-01', '-1000'), flow('2022-01-01', '1210')]);
    expect(atGross).toBeCloseTo(0.21, 6);
  });
});

describe('null paths, each with its reason', () => {
  it('a single cash flow → no_data', () => {
    const result = xirr([flow('2021-01-01', '-1000')]);
    expect(result.value).toBeNull();
    expect(result.reason).toBe('no_data');
  });

  it('no cash flows at all → no_data', () => {
    const result = xirr([]);
    expect(result.value).toBeNull();
    expect(result.reason).toBe('no_data');
  });

  it('every flow on the same date → no_data', () => {
    const result = xirr([
      flow('2021-01-01', '-1000'),
      flow('2021-01-01', '500'),
      flow('2021-01-01', '600'),
    ]);
    expect(result.value).toBeNull();
    expect(result.reason).toBe('no_data');
  });

  it('all-negative flows → no_sign_change', () => {
    const result = xirr([flow('2021-01-01', '-1000'), flow('2022-01-01', '-500')]);
    expect(result.value).toBeNull();
    expect(result.reason).toBe('no_sign_change');
  });

  it('all-positive flows → no_sign_change', () => {
    const result = xirr([flow('2021-01-01', '1000'), flow('2022-01-01', '500')]);
    expect(result.value).toBeNull();
    expect(result.reason).toBe('no_sign_change');
  });

  it('never substitutes zero for an unanswerable series', () => {
    for (const series of [
      [flow('2021-01-01', '-1000')],
      [flow('2021-01-01', '-1000'), flow('2022-01-01', '-1')],
    ]) {
      const result = xirr(series);
      expect(result.value).toBeNull();
      expect(result.reason).toBeDefined();
    }
  });
});

describe('edge cases 15 and 16', () => {
  it('case 16 — a fully sold position uses its realised flows only', () => {
    // No terminal value: the position closed, and the answer comes from the
    // purchase and the sale alone.
    expect(solved([flow('2021-01-01', '-1000'), flow('2022-01-01', '1100')])).toBeCloseTo(0.1, 6);
  });

  it('case 15 — a large loss resolves rather than failing to converge', () => {
    const result = xirr([flow('2021-01-01', '-100000'), flow('2022-01-01', '5000')]);
    expect(result.value).not.toBeNull();
    expect(rToNumber(result.value!)).toBeCloseTo(-0.95, 6);
  });
});
