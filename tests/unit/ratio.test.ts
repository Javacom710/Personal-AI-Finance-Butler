import { describe, expect, it } from 'vitest';

import { currency, Money } from '@/lib/decimal/money';
import { Rate, RATE_MAX_VALUE, rToDbString } from '@/lib/decimal/rate';
import { divideToRate, ratio, ratioOfCounts, subtractRates } from '@/server/domain/calc/ratio';

const INR = currency('INR');
const m = (s: string) => Money.of(s, INR);

/**
 * The single place two money figures become a rate. Every divide-by-zero in the
 * money domain resolves here, which is why the null-with-a-reason behaviour is
 * tested once, thoroughly, rather than at each caller.
 */
describe('ratio', () => {
  it('divides two amounts', () => {
    expect(rToDbString(ratio(m('75000'), m('100000')).value!)).toBe('0.7500000000');
  });

  it('handles a ratio greater than one', () => {
    expect(rToDbString(ratio(m('12500'), m('10000')).value!)).toBe('1.2500000000');
  });

  it('handles a negative numerator', () => {
    expect(rToDbString(ratio(m('-5000'), m('10000')).value!)).toBe('-0.5000000000');
  });

  it('returns null with a reason on a zero denominator, never zero and never infinity', () => {
    const result = ratio(m('500'), m('0'));
    expect(result.value).toBeNull();
    expect(result.reason).toBe('divide_by_zero');
  });

  it('is zero when the numerator is zero and the denominator is not', () => {
    expect(rToDbString(ratio(m('0'), m('10000')).value!)).toBe('0.0000000000');
  });

  it('rounds a recurring quotient at scale 10', () => {
    // 1/3 at scale 10, half_up.
    expect(rToDbString(ratio(m('1'), m('3')).value!)).toBe('0.3333333333');
  });

  it('refuses to divide across currencies', () => {
    expect(() => ratio(Money.of('10', currency('USD')), m('100'))).toThrow(
      /Convert through the FX module/,
    );
  });

  it('reports out_of_range rather than throwing when the quotient will not fit', () => {
    // A savings rate against ₹0.0001 of income. Found by a property test: the
    // previous version threw a RangeError out of a page render.
    const result = ratio(m('-1000000'), Money.fromMinor(1n, INR));
    expect(result.value).toBeNull();
    expect(result.reason).toBe('out_of_range');
  });

  it('still returns a value at the top of the representable range', () => {
    // A ratio is stored as `ratio × 10^10` in a NUMERIC(20,10), so the largest
    // whole ratio that fits is 10^10 − 1. 10^10 itself needs 10^20, one more
    // than the column holds — and is reported as out_of_range, not thrown.
    expect(ratio(Money.fromMinor(10n ** 10n - 1n, INR), Money.fromMinor(1n, INR)).value).not.toBeNull();
    expect(ratio(Money.fromMinor(10n ** 10n, INR), Money.fromMinor(1n, INR)).reason).toBe('out_of_range');
  });
});

describe('subtractRates', () => {
  it('subtracts two rates', () => {
    expect(rToDbString(subtractRates(Rate.of('1.25'), Rate.of('0.5')).value!)).toBe('0.7500000000');
  });

  it('reports out_of_range instead of throwing on an unrepresentable difference', () => {
    const huge = Rate.fromValue(RATE_MAX_VALUE);
    const result = subtractRates(Rate.fromValue(-huge.value), huge);
    expect(result.value).toBeNull();
    expect(result.reason).toBe('out_of_range');
  });
});

describe('divideToRate', () => {
  it('throws on a zero divisor — a programming error, not a domain outcome', () => {
    expect(() => divideToRate(1n, 0n)).toThrow(/division by zero/);
  });

  it('honours the rounding mode it is given', () => {
    expect(rToDbString(divideToRate(2n, 3n, 'floor'))).toBe('0.6666666666');
    expect(rToDbString(divideToRate(2n, 3n, 'ceil'))).toBe('0.6666666667');
  });
});

describe('ratioOfCounts', () => {
  it('divides two whole numbers', () => {
    expect(rToDbString(ratioOfCounts(10, 30).value!)).toBe('0.3333333333');
  });

  it('returns null with a reason for a zero total', () => {
    const result = ratioOfCounts(0, 0);
    expect(result.value).toBeNull();
    expect(result.reason).toBe('divide_by_zero');
  });

  it('rejects non-integers rather than silently truncating them', () => {
    expect(() => ratioOfCounts(1.5, 3)).toThrow();
  });
});
