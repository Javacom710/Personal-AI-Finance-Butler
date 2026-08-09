import { describe, expect, it } from 'vitest';

import {
  Money,
  MONEY_MAX_MINOR,
  MONEY_SCALE,
  abs,
  add,
  allocate,
  cmp,
  currency,
  divInt,
  eq,
  isNegative,
  isZero,
  mulQty,
  mulRate,
  neg,
  sub,
  sum,
  toDbString,
  toMinorNumber,
} from '@/lib/decimal';
import { Quantity } from '@/lib/decimal/quantity';
import { Rate } from '@/lib/decimal/rate';

const INR = currency('INR');
const USD = currency('USD');

describe('currency codes', () => {
  it('accepts three uppercase letters', () => {
    expect(currency('INR')).toBe('INR');
  });

  it('rejects anything else, so a typo cannot become a currency', () => {
    for (const bad of ['inr', 'IN', 'INRR', '', 'I1R', '₹']) {
      expect(() => currency(bad)).toThrow(TypeError);
    }
  });
});

describe('Money construction', () => {
  it('reads a NUMERIC(20,4) string as Postgres returns it', () => {
    expect(Money.fromDbString('1234.5000', INR).minor).toBe(12_345_000n);
    expect(Money.fromDbString('-1234.5000', INR).minor).toBe(-12_345_000n);
    expect(Money.fromDbString('0.0000', INR).minor).toBe(0n);
  });

  it('preserves trailing zeros and the full scale on the way back out', () => {
    expect(toDbString(Money.fromDbString('1234.5000', INR))).toBe('1234.5000');
    expect(toDbString(Money.of('0.0001', INR))).toBe('0.0001');
    expect(toDbString(Money.of('-0.0001', INR))).toBe('-0.0001');
    expect(toDbString(Money.zero(INR))).toBe('0.0000');
  });

  it('accepts fewer decimals than the scale and pads them', () => {
    expect(Money.of('10', INR).minor).toBe(100_000n);
    expect(Money.of('10.5', INR).minor).toBe(105_000n);
  });

  it('accepts both grouping conventions, which is how people type amounts', () => {
    // Indian grouping.
    expect(Money.of('1,25,000.50', INR).minor).toBe(1_250_005_000n);
    expect(Money.of('12,34,567', INR).minor).toBe(12_345_670_000n);
    // Western grouping.
    expect(Money.of('1,250,000', USD).minor).toBe(12_500_000_000n);
    expect(Money.of('100,000', USD).minor).toBe(1_000_000_000n);
  });

  /**
   * The important case: in much of Europe the comma is the decimal separator,
   * so a user typing `1,5` means one and a half. Stripping commas blindly would
   * read that as fifteen — a tenfold error, entered silently.
   */
  it('rejects a comma that is not a valid grouping separator', () => {
    for (const bad of ['1,5', '1,50', '1,0000', '1,00,00', '12,3,456', ',100', '1,,000']) {
      const result = Money.parseUserInput(bad, INR);
      expect(result.ok, `expected ${JSON.stringify(bad)} to be rejected`).toBe(false);
    }
  });

  it('rejects malformed input rather than guessing', () => {
    for (const bad of ['', '   ', 'abc', '1.2.3', '1e5', '--1', '.', '₹100', '1 000', '1.5.']) {
      const result = Money.parseUserInput(bad, INR);
      expect(result.ok, `expected ${JSON.stringify(bad)} to be rejected`).toBe(false);
    }
  });

  it('rejects more decimals than the scale can hold, instead of truncating silently', () => {
    const result = Money.parseUserInput('1.234567', INR);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('too_many_decimals');
  });

  it('never falls back to parseFloat: "12abc" is an error, not 12', () => {
    const result = Money.parseUserInput('12abc', INR);
    expect(result.ok).toBe(false);
  });
});

describe('the NUMERIC(20,4) boundary', () => {
  it('accepts the largest storable magnitude in both signs', () => {
    expect(Money.fromMinor(MONEY_MAX_MINOR, INR).minor).toBe(MONEY_MAX_MINOR);
    expect(Money.fromMinor(-MONEY_MAX_MINOR, INR).minor).toBe(-MONEY_MAX_MINOR);
  });

  it('throws rather than storing a value the column cannot hold', () => {
    expect(() => Money.fromMinor(MONEY_MAX_MINOR + 1n, INR)).toThrow(RangeError);
    expect(() => Money.fromMinor(-(MONEY_MAX_MINOR + 1n), INR)).toThrow(RangeError);
  });

  it('catches an overflow produced by arithmetic, not just by construction', () => {
    const near = Money.fromMinor(MONEY_MAX_MINOR, INR);
    expect(() => add(near, Money.of('1', INR))).toThrow(RangeError);
  });

  it('rejects an out-of-range parse as an error result', () => {
    const result = Money.parseUserInput('9'.repeat(17), INR);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('out_of_range');
  });

  it('uses scale 4', () => {
    expect(MONEY_SCALE).toBe(4);
  });
});

describe('arithmetic', () => {
  it('adds and subtracts exactly, including the value floats cannot represent', () => {
    // 0.1 + 0.2 is the canonical IEEE-754 failure. Here it is exact.
    expect(toDbString(add(Money.of('0.1', INR), Money.of('0.2', INR)))).toBe('0.3000');
  });

  it('accumulates a long series without drift', () => {
    let total = Money.zero(INR);
    for (let i = 0; i < 1000; i += 1) total = add(total, Money.of('0.1', INR));
    expect(toDbString(total)).toBe('100.0000');
  });

  it('is associative and commutative', () => {
    const a = Money.of('12.3456', INR);
    const b = Money.of('-7.891', INR);
    const c = Money.of('0.0004', INR);
    expect(eq(add(add(a, b), c), add(a, add(b, c)))).toBe(true);
    expect(eq(add(a, b), add(b, a))).toBe(true);
  });

  it('subtracting a value from itself is zero', () => {
    const a = Money.of('12345.6789', INR);
    expect(isZero(sub(a, a))).toBe(true);
  });

  it('double negation is the identity', () => {
    const a = Money.of('-99.9999', INR);
    expect(eq(neg(neg(a)), a)).toBe(true);
  });

  it('abs leaves a positive value alone and flips a negative one', () => {
    expect(toDbString(abs(Money.of('-5', INR)))).toBe('5.0000');
    expect(toDbString(abs(Money.of('5', INR)))).toBe('5.0000');
  });

  it('throws when currencies are mixed — a programming error, not a domain error', () => {
    const inr = Money.of('1', INR);
    const usd = Money.of('1', USD);
    expect(() => add(inr, usd)).toThrow(TypeError);
    expect(() => sub(inr, usd)).toThrow(TypeError);
    expect(() => cmp(inr, usd)).toThrow(TypeError);
  });

  it('eq is false across currencies rather than throwing', () => {
    expect(eq(Money.of('1', INR), Money.of('1', USD))).toBe(false);
  });
});

describe('sum', () => {
  it('returns zero for an empty list rather than throwing — an empty period is normal', () => {
    expect(toDbString(sum([], INR))).toBe('0.0000');
  });

  it('adds every item', () => {
    const items = [Money.of('1.25', INR), Money.of('2.50', INR), Money.of('-0.75', INR)];
    expect(toDbString(sum(items, INR))).toBe('3.0000');
  });

  it('throws if an item is in a different currency from the declared one', () => {
    expect(() => sum([Money.of('1', USD)], INR)).toThrow(TypeError);
  });
});

describe('multiplication and division', () => {
  it('multiplies by a quantity at scale 8 and rounds back to scale 4', () => {
    // 12.5 units at ₹99.9999 = ₹1249.99875 → 1249.9988 half-up.
    const value = mulQty(Money.of('99.9999', INR), Quantity.of('12.5'), 'half_up');
    expect(toDbString(value)).toBe('1249.9988');
  });

  it('multiplies by an FX rate at scale 10', () => {
    // $100 at 83.2512345678 INR/USD.
    const converted = mulRate(Money.of('100', USD), Rate.of('83.2512345678'), 'half_up');
    expect(toDbString(converted)).toBe('8325.1235');
  });

  it('requires an explicit rounding mode at every lossy operation', () => {
    const m = Money.of('10', INR);
    expect(toDbString(divInt(m, 3, 'floor'))).toBe('3.3333');
    expect(toDbString(divInt(m, 3, 'ceil'))).toBe('3.3334');
    expect(toDbString(divInt(m, 3, 'half_up'))).toBe('3.3333');
  });

  it('rounds a negative division by the documented sign convention', () => {
    const m = Money.of('-10', INR);
    expect(toDbString(divInt(m, 3, 'floor'))).toBe('-3.3334');
    expect(toDbString(divInt(m, 3, 'ceil'))).toBe('-3.3333');
  });

  it('rejects a zero or fractional divisor', () => {
    expect(() => divInt(Money.of('1', INR), 0, 'half_up')).toThrow(RangeError);
    expect(() => divInt(Money.of('1', INR), 1.5, 'half_up')).toThrow(RangeError);
  });
});

describe('allocate', () => {
  it('splits ₹100 three ways as 33.3334 / 33.3333 / 33.3333 and loses nothing', () => {
    const parts = allocate(Money.of('100', INR), [1n, 1n, 1n]);
    expect(parts.map(toDbString)).toEqual(['33.3334', '33.3333', '33.3333']);
    expect(toDbString(sum(parts, INR))).toBe('100.0000');
  });

  it('sums back exactly for every split from 1 to 12 ways', () => {
    const amount = Money.of('100', INR);
    for (let n = 1; n <= 12; n += 1) {
      const weights = Array.from({ length: n }, () => 1n);
      const parts = allocate(amount, weights);
      expect(parts).toHaveLength(n);
      expect(eq(sum(parts, INR), amount), `${n}-way split did not sum back`).toBe(true);
    }
  });

  it('honours proportional weights', () => {
    const parts = allocate(Money.of('100', INR), [70n, 30n]);
    expect(parts.map(toDbString)).toEqual(['70.0000', '30.0000']);
  });

  it('gives the remainder to the largest fractional part, breaking ties by index', () => {
    // 0.0007 split 3 ways: 7 minor units → 3 / 2 / 2.
    const parts = allocate(Money.of('0.0007', INR), [1n, 1n, 1n]);
    expect(parts.map((p) => p.minor)).toEqual([3n, 2n, 2n]);
  });

  it('mirrors exactly for a negative amount', () => {
    const positive = allocate(Money.of('100', INR), [1n, 1n, 1n]);
    const negative = allocate(Money.of('-100', INR), [1n, 1n, 1n]);
    expect(negative.map((p) => p.minor)).toEqual(positive.map((p) => -p.minor));
    expect(toDbString(sum(negative, INR))).toBe('-100.0000');
  });

  it('handles a zero amount and zero weights among non-zero ones', () => {
    expect(allocate(Money.zero(INR), [1n, 2n]).map(toDbString)).toEqual(['0.0000', '0.0000']);
    expect(allocate(Money.of('10', INR), [0n, 1n]).map(toDbString)).toEqual(['0.0000', '10.0000']);
  });

  it('rejects degenerate weight lists', () => {
    expect(() => allocate(Money.of('1', INR), [])).toThrow(RangeError);
    expect(() => allocate(Money.of('1', INR), [0n, 0n])).toThrow(RangeError);
    expect(() => allocate(Money.of('1', INR), [-1n, 2n])).toThrow(RangeError);
  });
});

describe('comparison', () => {
  it('orders values', () => {
    expect(cmp(Money.of('1', INR), Money.of('2', INR))).toBe(-1);
    expect(cmp(Money.of('2', INR), Money.of('1', INR))).toBe(1);
    expect(cmp(Money.of('1', INR), Money.of('1.0000', INR))).toBe(0);
  });

  it('reports sign', () => {
    expect(isNegative(Money.of('-0.0001', INR))).toBe(true);
    expect(isNegative(Money.zero(INR))).toBe(false);
    expect(isZero(Money.of('0.0000', INR))).toBe(true);
  });
});

describe('toMinorNumber', () => {
  it('returns minor units for solver input', () => {
    expect(toMinorNumber(Money.of('1.5', INR))).toBe(15_000);
  });

  it('throws above Number.MAX_SAFE_INTEGER instead of returning an approximation', () => {
    const tooBig = Money.fromMinor(BigInt(Number.MAX_SAFE_INTEGER) + 1n, INR);
    expect(() => toMinorNumber(tooBig)).toThrow(RangeError);
  });

  it('accepts exactly Number.MAX_SAFE_INTEGER', () => {
    const atLimit = Money.fromMinor(BigInt(Number.MAX_SAFE_INTEGER), INR);
    expect(toMinorNumber(atLimit)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('immutability', () => {
  it('a Money value cannot be mutated in place', () => {
    const m = Money.of('1', INR);
    expect(() => {
      (m as { minor: bigint }).minor = 999n;
    }).toThrow();
  });
});
