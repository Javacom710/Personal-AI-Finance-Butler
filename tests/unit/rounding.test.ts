import { describe, expect, it } from 'vitest';

import { divRound, pow10, type Rounding } from '@/lib/decimal/rounding';

/**
 * TESTING.md §3: "every rounding mode at the .00005 boundary and at negative
 * values (half_up on -0.5 must be documented and tested, not assumed)".
 *
 * These are the sign conventions the whole engine inherits, so they are tested
 * as a table in both signs rather than spot-checked.
 */
describe('divRound', () => {
  const cases: ReadonlyArray<{
    n: bigint;
    d: bigint;
    expected: Record<Rounding, bigint>;
  }> = [
    // Exact — every mode agrees.
    { n: 10n, d: 5n, expected: { half_up: 2n, half_even: 2n, floor: 2n, ceil: 2n } },
    { n: -10n, d: 5n, expected: { half_up: -2n, half_even: -2n, floor: -2n, ceil: -2n } },

    // Exactly half, positive: 1/2.
    { n: 1n, d: 2n, expected: { half_up: 1n, half_even: 0n, floor: 0n, ceil: 1n } },
    // Exactly half, negative: -1/2. half_up goes AWAY from zero.
    { n: -1n, d: 2n, expected: { half_up: -1n, half_even: 0n, floor: -1n, ceil: 0n } },

    // Exactly half onto an odd quotient: 3/2 → 1.5.
    { n: 3n, d: 2n, expected: { half_up: 2n, half_even: 2n, floor: 1n, ceil: 2n } },
    { n: -3n, d: 2n, expected: { half_up: -2n, half_even: -2n, floor: -2n, ceil: -1n } },

    // Exactly half onto an even quotient: 5/2 → 2.5, banker's rounds down.
    { n: 5n, d: 2n, expected: { half_up: 3n, half_even: 2n, floor: 2n, ceil: 3n } },
    { n: -5n, d: 2n, expected: { half_up: -3n, half_even: -2n, floor: -3n, ceil: -2n } },

    // Below half.
    { n: 4n, d: 10n, expected: { half_up: 0n, half_even: 0n, floor: 0n, ceil: 1n } },
    { n: -4n, d: 10n, expected: { half_up: 0n, half_even: 0n, floor: -1n, ceil: 0n } },

    // Above half.
    { n: 6n, d: 10n, expected: { half_up: 1n, half_even: 1n, floor: 0n, ceil: 1n } },
    { n: -6n, d: 10n, expected: { half_up: -1n, half_even: -1n, floor: -1n, ceil: 0n } },
  ];

  for (const { n, d, expected } of cases) {
    for (const mode of Object.keys(expected) as Rounding[]) {
      it(`${n}/${d} with ${mode} = ${expected[mode]}`, () => {
        expect(divRound(n, d, mode)).toBe(expected[mode]);
      });
    }
  }

  it('normalises a negative denominator rather than flipping the rounding direction', () => {
    // -1/2 and 1/-2 are the same number and must round identically.
    for (const mode of ['half_up', 'half_even', 'floor', 'ceil'] as Rounding[]) {
      expect(divRound(1n, -2n, mode)).toBe(divRound(-1n, 2n, mode));
    }
  });

  it('floor and ceil are directional on the number line, not in magnitude', () => {
    // The classic off-by-one: treating floor as "toward zero" would give 0 here.
    expect(divRound(-1n, 10n, 'floor')).toBe(-1n);
    expect(divRound(-9n, 10n, 'ceil')).toBe(0n);
  });

  it('throws on division by zero', () => {
    expect(() => divRound(1n, 0n, 'half_up')).toThrow(RangeError);
  });

  it('handles values far beyond Number.MAX_SAFE_INTEGER exactly', () => {
    const huge = 10n ** 30n + 1n;
    expect(divRound(huge * 2n + 1n, 2n, 'half_up')).toBe(huge + 1n);
  });
});

describe('pow10', () => {
  it('produces exact powers', () => {
    expect(pow10(0)).toBe(1n);
    expect(pow10(4)).toBe(10_000n);
    expect(pow10(10)).toBe(10_000_000_000n);
  });

  it('rejects a negative or fractional exponent', () => {
    expect(() => pow10(-1)).toThrow(RangeError);
    expect(() => pow10(1.5)).toThrow(RangeError);
  });
});
