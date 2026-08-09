/**
 * Money — an exact scaled integer, never a float (ADR-04, FINANCIAL-DOMAIN.md §1).
 *
 * `minor` is the amount multiplied by 10^4, held as a `bigint`. Scale 4 is used
 * for every currency: paise and cents need 2, and the extra 2 digits absorb
 * intermediate FX conversion and fee splitting without per-currency scale logic
 * in the arithmetic core. Display scale is a separate concern, driven by
 * `currencies.minor_units` in src/lib/format.
 *
 * The storage column is `NUMERIC(20,4)` — 20 significant digits, 4 of them
 * after the point. `MONEY_MAX_MINOR` is that limit expressed in minor units,
 * and every construction and every arithmetic result is checked against it, so
 * a value that could not be persisted can never be constructed.
 */

import { divRound, pow10, type Rounding } from './rounding';
import { assertInRange, formatFixed, parseFixed, type ParseError } from './scaled';
import type { Quantity } from './quantity';
import { QTY_SCALE } from './quantity';
import type { Rate } from './rate';
import { RATE_SCALE } from './rate';
import { err, ok, type Result } from '../result';

export const MONEY_SCALE = 4;

/** NUMERIC(20,4): at most 20 digits in total, so at most 10^20 − 1 minor units. */
export const MONEY_MAX_MINOR = 10n ** 20n - 1n;

/**
 * A branded ISO 4217 code. Branding is what makes `add(inr, usd)` a *type*
 * error at most call sites, with the runtime throw below as the backstop for
 * currencies that only differ at runtime.
 */
export type CurrencyCode = string & { readonly __brand: 'CurrencyCode' };

const CURRENCY_RE = /^[A-Z]{3}$/;

/** The only way to make a `CurrencyCode`. Rejects anything that is not three uppercase letters. */
export function currency(code: string): CurrencyCode {
  if (!CURRENCY_RE.test(code)) {
    throw new TypeError(`Invalid ISO 4217 currency code: ${JSON.stringify(code)}`);
  }
  return code as CurrencyCode;
}

export function isCurrencyCode(code: string): boolean {
  return CURRENCY_RE.test(code);
}

export interface Money {
  readonly minor: bigint;
  readonly currency: CurrencyCode;
}

function make(minor: bigint, c: CurrencyCode): Money {
  assertInRange(minor, MONEY_MAX_MINOR, 'Money');
  return Object.freeze({ minor, currency: c });
}

/**
 * Mixing currencies is a programming error, not a domain error: it means two
 * incompatible things were summed somewhere upstream. Cross-currency work goes
 * through the FX module explicitly (FINANCIAL-DOMAIN.md §2).
 */
function assertSameCurrency(a: Money, b: Money, op: string): void {
  if (a.currency !== b.currency) {
    throw new TypeError(
      `Cannot ${op} ${a.currency} and ${b.currency}. Convert through the FX module first.`,
    );
  }
}

// ---------------------------------------------------------------- construction

export const Money = {
  /** From a `NUMERIC(20,4)` string as Postgres returns it: "1234.5000". */
  fromDbString(s: string, c: CurrencyCode): Money {
    const parsed = parseFixed(s, { scale: MONEY_SCALE, maxMagnitude: MONEY_MAX_MINOR });
    if (!parsed.ok) {
      throw new TypeError(
        `Money.fromDbString: ${parsed.error.message} (received ${JSON.stringify(s)}). ` +
          'A value already in the database must always parse — this indicates schema drift.',
      );
    }
    return make(parsed.value, c);
  },

  fromMinor(minor: bigint, c: CurrencyCode): Money {
    return make(minor, c);
  },

  /**
   * The boundary for anything typed by a human or produced by a model.
   * Returns a `Result`; it never falls back to `parseFloat` (SECURITY.md §5).
   */
  parseUserInput(s: string, c: CurrencyCode): Result<Money, ParseError> {
    const parsed = parseFixed(s, { scale: MONEY_SCALE, maxMagnitude: MONEY_MAX_MINOR });
    return parsed.ok ? ok(make(parsed.value, c)) : err(parsed.error);
  },

  zero(c: CurrencyCode): Money {
    return make(0n, c);
  },

  /** Convenience for tests and fixtures: `Money.of('1250.50', INR)`. Throws on malformed input. */
  of(s: string, c: CurrencyCode): Money {
    const parsed = Money.parseUserInput(s, c);
    if (!parsed.ok) throw new TypeError(`Money.of: ${parsed.error.message} (${JSON.stringify(s)})`);
    return parsed.value;
  },
} as const;

// ----------------------------------------------------------------- arithmetic

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b, 'add');
  return make(a.minor + b.minor, a.currency);
}

export function sub(a: Money, b: Money): Money {
  assertSameCurrency(a, b, 'subtract');
  return make(a.minor - b.minor, a.currency);
}

export function neg(a: Money): Money {
  return make(-a.minor, a.currency);
}

export function abs(a: Money): Money {
  return a.minor < 0n ? neg(a) : a;
}

/**
 * `sum([])` returns zero rather than throwing — an empty period is normal, not
 * exceptional (FINANCIAL-DOMAIN.md §1). The currency must therefore be passed
 * in: an empty list cannot tell you what currency its zero is in.
 */
export function sum(items: readonly Money[], c: CurrencyCode): Money {
  let total = 0n;
  for (const item of items) {
    if (item.currency !== c) {
      throw new TypeError(`sum: expected every item in ${c}, found ${item.currency}`);
    }
    total += item.minor;
  }
  return make(total, c);
}

/** Money × Quantity, e.g. unit price × units held. Scale 4 × scale 8 → rounded back to scale 4. */
export function mulQty(m: Money, q: Quantity, rounding: Rounding): Money {
  return make(divRound(m.minor * q.units, pow10(QTY_SCALE), rounding), m.currency);
}

/** Money × Rate, e.g. an amount converted at a stored FX rate. Scale 4 × scale 10 → scale 4. */
export function mulRate(m: Money, r: Rate, rounding: Rounding): Money {
  return make(divRound(m.minor * r.value, pow10(RATE_SCALE), rounding), m.currency);
}

/** Divide by an integer count, e.g. splitting a bill n ways. For proportional splits use `allocate`. */
export function divInt(m: Money, n: number, rounding: Rounding): Money {
  if (!Number.isInteger(n) || n === 0) {
    throw new RangeError(`divInt: divisor must be a non-zero integer, got ${n}`);
  }
  return make(divRound(m.minor, BigInt(n), rounding), m.currency);
}

/**
 * Split an amount into parts proportional to `weights`, losing nothing.
 *
 * The remainder left by integer division is handed out one minor unit at a
 * time, largest fractional remainder first and ties broken by index, so the
 * result is deterministic and `sum(allocate(m, w)) === m` exactly. Splitting
 * ₹100 three ways gives 33.3334 / 33.3333 / 33.3333.
 *
 * Negative amounts allocate as the mirror of their absolute value, so
 * `allocate(neg(m), w) === allocate(m, w).map(neg)` holds.
 */
export function allocate(m: Money, weights: readonly bigint[]): Money[] {
  if (weights.length === 0) {
    throw new RangeError('allocate: at least one weight is required');
  }
  let totalWeight = 0n;
  for (const w of weights) {
    if (w < 0n) throw new RangeError('allocate: weights must be non-negative');
    totalWeight += w;
  }
  if (totalWeight === 0n) {
    throw new RangeError('allocate: weights must not all be zero');
  }

  const negative = m.minor < 0n;
  const magnitude = negative ? -m.minor : m.minor;

  const bases: bigint[] = [];
  const remainders: bigint[] = [];
  let distributed = 0n;

  for (const w of weights) {
    const scaled = magnitude * w;
    const base = scaled / totalWeight;
    bases.push(base);
    remainders.push(scaled % totalWeight);
    distributed += base;
  }

  // Hand out the shortfall, largest remainder first, ties by ascending index.
  let shortfall = magnitude - distributed;
  const order = remainders
    .map((r, i) => ({ r, i }))
    .sort((x, y) => (x.r === y.r ? x.i - y.i : x.r > y.r ? -1 : 1));

  for (let k = 0; shortfall > 0n; k = (k + 1) % order.length) {
    const idx = order[k]!.i;
    bases[idx] = bases[idx]! + 1n;
    shortfall -= 1n;
  }

  return bases.map((b) => make(negative ? -b : b, m.currency));
}

// ----------------------------------------------------------------- comparison

export function cmp(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b, 'compare');
  return a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : 0;
}

export function eq(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.minor === b.minor;
}

export function isZero(m: Money): boolean {
  return m.minor === 0n;
}

export function isNegative(m: Money): boolean {
  return m.minor < 0n;
}

export function isPositive(m: Money): boolean {
  return m.minor > 0n;
}

export function min(a: Money, b: Money): Money {
  return cmp(a, b) <= 0 ? a : b;
}

export function max(a: Money, b: Money): Money {
  return cmp(a, b) >= 0 ? a : b;
}

// --------------------------------------------------------------------- output

/** The `NUMERIC(20,4)` representation. This is what goes into the database. */
export function toDbString(m: Money): string {
  return formatFixed(m.minor, MONEY_SCALE);
}

/**
 * Minor units as a JS number — permitted **only** as input to a numeric solver
 * (XIRR root-finding). Throws above `Number.MAX_SAFE_INTEGER` rather than
 * silently returning an approximation.
 */
export function toMinorNumber(m: Money): number {
  const magnitude = m.minor < 0n ? -m.minor : m.minor;
  if (magnitude > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(
      `toMinorNumber: ${toDbString(m)} exceeds Number.MAX_SAFE_INTEGER and cannot be represented exactly.`,
    );
  }
  return Number(m.minor);
}
