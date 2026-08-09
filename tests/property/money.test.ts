import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  Money,
  MONEY_MAX_MINOR,
  add,
  allocate,
  currency,
  eq,
  isZero,
  neg,
  sub,
  sum,
  toDbString,
} from '@/lib/decimal';
import { divRound, type Rounding } from '@/lib/decimal/rounding';

const INR = currency('INR');

/**
 * The algebraic laws from TESTING.md §3.
 *
 * Bounded well inside `MONEY_MAX_MINOR` so that a three-term sum cannot
 * legitimately overflow — an overflow here would be the generator's doing, not
 * the property's.
 */
const BOUND = MONEY_MAX_MINOR / 8n;
const money = fc.bigInt({ min: -BOUND, max: BOUND }).map((minor) => Money.fromMinor(minor, INR));

describe('Money algebra', () => {
  it('addition is associative', () => {
    fc.assert(
      fc.property(money, money, money, (a, b, c) => {
        expect(eq(add(add(a, b), c), add(a, add(b, c)))).toBe(true);
      }),
    );
  });

  it('addition is commutative', () => {
    fc.assert(
      fc.property(money, money, (a, b) => {
        expect(eq(add(a, b), add(b, a))).toBe(true);
      }),
    );
  });

  it('subtracting a value from itself is zero', () => {
    fc.assert(
      fc.property(money, (a) => {
        expect(isZero(sub(a, a))).toBe(true);
      }),
    );
  });

  it('negation is an involution', () => {
    fc.assert(
      fc.property(money, (a) => {
        expect(eq(neg(neg(a)), a)).toBe(true);
      }),
    );
  });

  it('zero is the additive identity', () => {
    fc.assert(
      fc.property(money, (a) => {
        expect(eq(add(a, Money.zero(INR)), a)).toBe(true);
      }),
    );
  });
});

describe('allocate', () => {
  const weights = fc.array(fc.bigInt({ min: 0n, max: 10_000n }), { minLength: 1, maxLength: 12 });

  it('always sums back to exactly the original amount', () => {
    fc.assert(
      fc.property(money, weights, (amount, w) => {
        fc.pre(w.reduce((acc, x) => acc + x, 0n) > 0n);
        const parts = allocate(amount, w);
        expect(eq(sum(parts, INR), amount)).toBe(true);
      }),
    );
  });

  it('produces exactly one part per weight', () => {
    fc.assert(
      fc.property(money, weights, (amount, w) => {
        fc.pre(w.reduce((acc, x) => acc + x, 0n) > 0n);
        expect(allocate(amount, w)).toHaveLength(w.length);
      }),
    );
  });

  it('mirrors under negation', () => {
    fc.assert(
      fc.property(money, weights, (amount, w) => {
        fc.pre(w.reduce((acc, x) => acc + x, 0n) > 0n);
        const positive = allocate(amount, w).map((p) => p.minor);
        const negated = allocate(neg(amount), w).map((p) => p.minor);
        expect(negated).toEqual(positive.map((p) => -p));
      }),
    );
  });

  it('gives a zero weight a zero part', () => {
    fc.assert(
      fc.property(money, weights, (amount, w) => {
        fc.pre(w.reduce((acc, x) => acc + x, 0n) > 0n);
        const parts = allocate(amount, w);
        w.forEach((weight, i) => {
          if (weight === 0n) expect(parts[i]!.minor).toBe(0n);
        });
      }),
    );
  });
});

describe('database round-trip', () => {
  it('fromDbString(toDbString(m)) === m for every representable value', () => {
    fc.assert(
      fc.property(money, (m) => {
        expect(eq(Money.fromDbString(toDbString(m), INR), m)).toBe(true);
      }),
    );
  });

  it('the string form always carries exactly 4 decimal places', () => {
    fc.assert(
      fc.property(money, (m) => {
        expect(toDbString(m)).toMatch(/^-?\d+\.\d{4}$/);
      }),
    );
  });

  it('parseUserInput accepts anything toDbString produces', () => {
    fc.assert(
      fc.property(money, (m) => {
        const parsed = Money.parseUserInput(toDbString(m), INR);
        expect(parsed.ok).toBe(true);
        if (parsed.ok) expect(eq(parsed.value, m)).toBe(true);
      }),
    );
  });
});

describe('divRound', () => {
  const modes: Rounding[] = ['half_up', 'half_even', 'floor', 'ceil'];
  const nonZero = fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n });
  const denominator = fc
    .bigInt({ min: 1n, max: 10n ** 12n })
    .chain((d) => fc.constantFrom(d, -d));

  it('never lands more than one unit from the true quotient', () => {
    fc.assert(
      fc.property(nonZero, denominator, fc.constantFrom(...modes), (n, d, mode) => {
        const q = divRound(n, d, mode);
        const truncated = n / d;
        const delta = q - truncated;
        expect(delta >= -1n && delta <= 1n).toBe(true);
      }),
    );
  });

  it('is exact whenever the division is exact', () => {
    fc.assert(
      fc.property(nonZero, fc.bigInt({ min: 1n, max: 1000n }), fc.constantFrom(...modes), (q, d, mode) => {
        expect(divRound(q * d, d, mode)).toBe(q);
      }),
    );
  });

  it('floor never exceeds ceil', () => {
    fc.assert(
      fc.property(nonZero, denominator, (n, d) => {
        expect(divRound(n, d, 'floor') <= divRound(n, d, 'ceil')).toBe(true);
      }),
    );
  });

  it('half_up and half_even differ by at most one unit', () => {
    fc.assert(
      fc.property(nonZero, denominator, (n, d) => {
        const delta = divRound(n, d, 'half_up') - divRound(n, d, 'half_even');
        expect(delta >= -1n && delta <= 1n).toBe(true);
      }),
    );
  });
});
