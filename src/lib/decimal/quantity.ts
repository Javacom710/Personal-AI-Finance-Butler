/**
 * Quantity — units of an instrument, at scale 8 (`NUMERIC(28,8)`).
 *
 * Scale 8 exists because mutual fund units are commonly quoted to three or
 * four decimals and fractional-share and crypto positions need more. It is a
 * separate type from `Money` on purpose: multiplying two quantities, or adding
 * a quantity to an amount, is meaningless and should not compile.
 */

import { divRound, pow10, type Rounding } from './rounding';
import { assertInRange, formatFixed, parseFixed, type ParseError } from './scaled';
import { err, ok, type Result } from '../result';

export const QTY_SCALE = 8;

/** NUMERIC(28,8): at most 28 digits in total. */
export const QTY_MAX_UNITS = 10n ** 28n - 1n;

export interface Quantity {
  readonly units: bigint;
}

function make(units: bigint): Quantity {
  assertInRange(units, QTY_MAX_UNITS, 'Quantity');
  return Object.freeze({ units });
}

export const Quantity = {
  fromDbString(s: string): Quantity {
    const parsed = parseFixed(s, { scale: QTY_SCALE, maxMagnitude: QTY_MAX_UNITS });
    if (!parsed.ok) {
      throw new TypeError(
        `Quantity.fromDbString: ${parsed.error.message} (received ${JSON.stringify(s)})`,
      );
    }
    return make(parsed.value);
  },

  fromUnits(units: bigint): Quantity {
    return make(units);
  },

  parseUserInput(s: string): Result<Quantity, ParseError> {
    const parsed = parseFixed(s, { scale: QTY_SCALE, maxMagnitude: QTY_MAX_UNITS });
    return parsed.ok ? ok(make(parsed.value)) : err(parsed.error);
  },

  zero(): Quantity {
    return make(0n);
  },

  of(s: string): Quantity {
    const parsed = Quantity.parseUserInput(s);
    if (!parsed.ok) {
      throw new TypeError(`Quantity.of: ${parsed.error.message} (${JSON.stringify(s)})`);
    }
    return parsed.value;
  },
} as const;

export function qAdd(a: Quantity, b: Quantity): Quantity {
  return make(a.units + b.units);
}

export function qSub(a: Quantity, b: Quantity): Quantity {
  return make(a.units - b.units);
}

export function qNeg(a: Quantity): Quantity {
  return make(-a.units);
}

export function qAbs(a: Quantity): Quantity {
  return a.units < 0n ? qNeg(a) : a;
}

export function qSum(items: readonly Quantity[]): Quantity {
  let total = 0n;
  for (const item of items) total += item.units;
  return make(total);
}

/**
 * Multiply a quantity by a whole-number ratio, as a split or bonus does.
 * `qScale(q, 5n, 1n)` is a 1:5 split. Exact where the ratio divides evenly;
 * `rounding` covers the case where it does not.
 */
export function qScale(q: Quantity, num: bigint, den: bigint, rounding: Rounding): Quantity {
  if (den === 0n) throw new RangeError('qScale: denominator must not be zero');
  return make(divRound(q.units * num, den, rounding));
}

export function qCmp(a: Quantity, b: Quantity): -1 | 0 | 1 {
  return a.units < b.units ? -1 : a.units > b.units ? 1 : 0;
}

export function qEq(a: Quantity, b: Quantity): boolean {
  return a.units === b.units;
}

export function qIsZero(q: Quantity): boolean {
  return q.units === 0n;
}

export function qIsNegative(q: Quantity): boolean {
  return q.units < 0n;
}

export function qToDbString(q: Quantity): string {
  return formatFixed(q.units, QTY_SCALE);
}

/** Units as a JS number — solver input only. Throws rather than losing precision. */
export function qToNumber(q: Quantity): number {
  const magnitude = q.units < 0n ? -q.units : q.units;
  if (magnitude > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(
      `qToNumber: ${qToDbString(q)} exceeds Number.MAX_SAFE_INTEGER and cannot be represented exactly.`,
    );
  }
  return Number(q.units) / Number(pow10(QTY_SCALE));
}
