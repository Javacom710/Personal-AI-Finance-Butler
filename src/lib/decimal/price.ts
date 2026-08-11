/**
 * UnitPrice — a per-unit figure at scale 8 (`NUMERIC(20,8)`).
 *
 * The fourth scaled type, alongside `Money`, `Quantity` and `Rate`
 * ([FINANCIAL-DOMAIN.md §1](../../../docs/FINANCIAL-DOMAIN.md#1-money-and-exact-arithmetic)).
 * It exists because every per-unit figure in the schema is `numeric(20,8)` —
 * `investment_transactions.price`, `instrument_prices.close`,
 * `instrument_quotes.price`, and the derived `cost_per_unit` — while `Money` is
 * scale 4. Reading a NAV of `123.45678900` into a `Money` **truncates it to
 * `123.4568` at the read boundary**, silently, before any arithmetic happens.
 *
 * It is a separate type from `Quantity` for the same reason `Quantity` is
 * separate from `Money`: multiplying two prices, or adding a price to a
 * quantity, is meaningless and should not compile.
 *
 * The three conversions below are the whole point of the module. Each is a
 * single `divRound` over `bigint`s — no `number` appears — and each takes an
 * explicit `Rounding`, like every other lossy operation in `src/lib/decimal`.
 */

import { divRound, pow10, type Rounding } from './rounding';
import { assertInRange, formatFixed, parseFixed, type ParseError } from './scaled';
import { MONEY_SCALE, type CurrencyCode, type Money } from './money';
import { QTY_SCALE, type Quantity } from './quantity';
import { err, ok, type Result } from '../result';

export const PRICE_SCALE = 8;

/** NUMERIC(20,8): at most 20 digits in total. */
export const PRICE_MAX_UNITS = 10n ** 20n - 1n;

export interface UnitPrice {
  readonly units: bigint;
}

function make(units: bigint): UnitPrice {
  assertInRange(units, PRICE_MAX_UNITS, 'UnitPrice');
  return Object.freeze({ units });
}

export const UnitPrice = {
  /** From a `NUMERIC(20,8)` string as Postgres returns it: "123.45678900". */
  fromDbString(s: string): UnitPrice {
    const parsed = parseFixed(s, { scale: PRICE_SCALE, maxMagnitude: PRICE_MAX_UNITS });
    if (!parsed.ok) {
      throw new TypeError(
        `UnitPrice.fromDbString: ${parsed.error.message} (received ${JSON.stringify(s)}). ` +
          'A value already in the database must always parse — this indicates schema drift.',
      );
    }
    return make(parsed.value);
  },

  fromUnits(units: bigint): UnitPrice {
    return make(units);
  },

  /** The boundary for anything typed by a human or produced by a model. */
  parseUserInput(s: string): Result<UnitPrice, ParseError> {
    const parsed = parseFixed(s, { scale: PRICE_SCALE, maxMagnitude: PRICE_MAX_UNITS });
    return parsed.ok ? ok(make(parsed.value)) : err(parsed.error);
  },

  zero(): UnitPrice {
    return make(0n);
  },

  /** Convenience for tests and fixtures. Throws on malformed input. */
  of(s: string): UnitPrice {
    const parsed = UnitPrice.parseUserInput(s);
    if (!parsed.ok) {
      throw new TypeError(`UnitPrice.of: ${parsed.error.message} (${JSON.stringify(s)})`);
    }
    return parsed.value;
  },
} as const;

// --------------------------------------------------------------- conversions

/**
 * `quantity × price → Money`. Market value, and gross amount on a trade.
 *
 * Scale arithmetic: `q.units` is scale 8 and `p.units` is scale 8, so their
 * product is scale 16; a `Money.minor` is scale 4, hence the divisor of 10^12.
 * The product is formed at full width and rounded **once**, at the end —
 * rounding at the boundary of the calculation, never inside it
 * (FINANCIAL-DOMAIN.md §10.2).
 */
export function valueOf(q: Quantity, p: UnitPrice, c: CurrencyCode, rounding: Rounding): Money {
  const minor = divRound(q.units * p.units, pow10(QTY_SCALE + PRICE_SCALE - MONEY_SCALE), rounding);
  assertInRange(minor, 10n ** 20n - 1n, 'Money');
  return Object.freeze({ minor, currency: c });
}

/**
 * `Money ÷ quantity → UnitPrice`. The derived `cost_per_unit` of a lot, the
 * derived `avg_cost` of a position, `proceeds_per_unit` on a disposal.
 *
 * Every one of those is **derived on read and never stored** — a derived money
 * figure that is stored is a second figure free to drift from the first
 * ([SCHEMA.md §6.1](../../../docs/SCHEMA.md#61-derived-investment-state-adr-06)).
 *
 * Throws on a zero quantity rather than returning a `Result`: dividing by a
 * quantity the caller has not checked is a programming error, and every call
 * site here already knows whether the lot is empty.
 */
export function perUnit(m: Money, q: Quantity, rounding: Rounding): UnitPrice {
  if (q.units === 0n) {
    throw new RangeError(
      'perUnit: cannot derive a per-unit price from a zero quantity. ' +
        'A fully disposed lot has no per-unit cost; check before dividing.',
    );
  }
  return make(divRound(m.minor * pow10(PRICE_SCALE + QTY_SCALE - MONEY_SCALE), q.units, rounding));
}

/**
 * The exact proportional share of an amount: `m × num / den`.
 *
 * This is what makes partial-lot cost consumption exact
 * ([INVESTMENT-DOMAIN.md §4](../../../docs/INVESTMENT-DOMAIN.md#fifo-matching-strategy)).
 * The multiplication happens **before** the division, so no per-unit rate is
 * ever materialised and rounded — the classic divide-then-multiply leaves a
 * residue of a few minor units per lot, and that residue lands in realised P&L,
 * which is a tax figure.
 *
 * The remaining cost stays on the lot rather than being recomputed, and the
 * slice that drains a lot takes `remaining_cost` verbatim, so a lot's whole
 * life sums back to `cost_total` exactly (invariant I-20).
 */
export function mulQtyRatio(m: Money, num: Quantity, den: Quantity, rounding: Rounding): Money {
  if (den.units === 0n) {
    throw new RangeError('mulQtyRatio: denominator quantity must not be zero');
  }
  const minor = divRound(m.minor * num.units, den.units, rounding);
  assertInRange(minor, 10n ** 20n - 1n, 'Money');
  return Object.freeze({ minor, currency: m.currency });
}

// ---------------------------------------------------------------- comparison

export function pCmp(a: UnitPrice, b: UnitPrice): -1 | 0 | 1 {
  return a.units < b.units ? -1 : a.units > b.units ? 1 : 0;
}

export function pEq(a: UnitPrice, b: UnitPrice): boolean {
  return a.units === b.units;
}

export function pIsZero(p: UnitPrice): boolean {
  return p.units === 0n;
}

export function pIsPositive(p: UnitPrice): boolean {
  return p.units > 0n;
}

/**
 * Scale a price by a whole-number ratio, as a split does to a *displayed*
 * per-unit figure. No stored basis is ever scaled this way — a split touches
 * quantities only (INVESTMENT-DOMAIN.md §11).
 */
export function pScale(p: UnitPrice, num: bigint, den: bigint, rounding: Rounding): UnitPrice {
  if (den === 0n) throw new RangeError('pScale: denominator must not be zero');
  return make(divRound(p.units * num, den, rounding));
}

// -------------------------------------------------------------------- output

/** The `NUMERIC(20,8)` representation. This is what goes into the database. */
export function pToDbString(p: UnitPrice): string {
  return formatFixed(p.units, PRICE_SCALE);
}

/** As a JS number — solver and display use only. Throws rather than losing precision. */
export function pToNumber(p: UnitPrice): number {
  const magnitude = p.units < 0n ? -p.units : p.units;
  if (magnitude > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(
      `pToNumber: ${pToDbString(p)} exceeds Number.MAX_SAFE_INTEGER and cannot be represented exactly.`,
    );
  }
  return Number(p.units) / Number(pow10(PRICE_SCALE));
}
