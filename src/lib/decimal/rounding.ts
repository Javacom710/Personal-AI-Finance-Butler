/**
 * Rounding is explicit at every division (ADR-04). There is no default mode:
 * every operation that can lose precision takes a `Rounding` argument, so a
 * reader of a call site can always see which way the paisa went.
 */
export type Rounding = 'half_up' | 'half_even' | 'floor' | 'ceil';

export const ROUNDING_MODES: readonly Rounding[] = ['half_up', 'half_even', 'floor', 'ceil'];

/**
 * Divide two integers and round the quotient to an integer.
 *
 * Sign semantics, chosen deliberately and covered by tests in both signs:
 *
 * - `half_up`   rounds a tie **away from zero**, matching `BigDecimal.HALF_UP`
 *               and ordinary financial convention: 0.5 → 1, −0.5 → −1.
 * - `half_even` rounds a tie to the even neighbour (banker's rounding):
 *               0.5 → 0, 1.5 → 2, −0.5 → 0, −1.5 → −2.
 * - `floor`     rounds toward −∞: 0.9 → 0, −0.1 → −1.
 * - `ceil`      rounds toward +∞: 0.1 → 1, −0.9 → 0.
 *
 * `floor` and `ceil` are directional in the number line, not in magnitude —
 * treating `floor` as "toward zero" is the classic off-by-one on negative
 * balances, which is exactly why credit-card amounts are tested here.
 */
export function divRound(numerator: bigint, denominator: bigint, mode: Rounding): bigint {
  if (denominator === 0n) {
    throw new RangeError('divRound: division by zero');
  }

  // Normalise so the denominator is positive; the sign lives on the numerator.
  let n = numerator;
  let d = denominator;
  if (d < 0n) {
    n = -n;
    d = -d;
  }

  const q = n / d; // bigint division truncates toward zero
  const r = n % d; // remainder carries the sign of n
  if (r === 0n) return q;

  const negative = n < 0n;
  const twiceRemainder = (r < 0n ? -r : r) * 2n;

  switch (mode) {
    case 'floor':
      return negative ? q - 1n : q;
    case 'ceil':
      return negative ? q : q + 1n;
    case 'half_up':
      return twiceRemainder >= d ? (negative ? q - 1n : q + 1n) : q;
    case 'half_even': {
      if (twiceRemainder > d) return negative ? q - 1n : q + 1n;
      if (twiceRemainder < d) return q;
      // Exactly half: move only if the truncated quotient is odd.
      return q % 2n === 0n ? q : negative ? q - 1n : q + 1n;
    }
  }
}

/** 10 ** n as a bigint, for scale conversion. */
export function pow10(n: number): bigint {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`pow10: exponent must be a non-negative integer, got ${n}`);
  }
  return 10n ** BigInt(n);
}
