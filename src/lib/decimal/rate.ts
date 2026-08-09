/**
 * Rate — an FX rate or a percentage, at scale 10 (`NUMERIC(20,10)`).
 *
 * Rates are stored as decimal fractions: an FX rate of 83.25 INR per USD is
 * `83.2500000000`; an interest rate of 7.25% is `0.0725000000`. Percentage
 * formatting is a display concern and lives in src/lib/format.
 */

import { divRound, pow10, type Rounding } from './rounding';
import { assertInRange, formatFixed, parseFixed, type ParseError } from './scaled';
import { err, ok, type Result } from '../result';

export const RATE_SCALE = 10;

/** NUMERIC(20,10): at most 20 digits in total. */
export const RATE_MAX_VALUE = 10n ** 20n - 1n;

const RATE_UNIT = pow10(RATE_SCALE);

export interface Rate {
  readonly value: bigint;
}

function make(value: bigint): Rate {
  assertInRange(value, RATE_MAX_VALUE, 'Rate');
  return Object.freeze({ value });
}

export const Rate = {
  fromDbString(s: string): Rate {
    const parsed = parseFixed(s, { scale: RATE_SCALE, maxMagnitude: RATE_MAX_VALUE });
    if (!parsed.ok) {
      throw new TypeError(`Rate.fromDbString: ${parsed.error.message} (received ${JSON.stringify(s)})`);
    }
    return make(parsed.value);
  },

  fromValue(value: bigint): Rate {
    return make(value);
  },

  parseUserInput(s: string): Result<Rate, ParseError> {
    const parsed = parseFixed(s, { scale: RATE_SCALE, maxMagnitude: RATE_MAX_VALUE });
    return parsed.ok ? ok(make(parsed.value)) : err(parsed.error);
  },

  /** The identity rate. `rate(X, X, _) = 1` without a table lookup (FINANCIAL-DOMAIN.md §2). */
  one(): Rate {
    return make(RATE_UNIT);
  },

  of(s: string): Rate {
    const parsed = Rate.parseUserInput(s);
    if (!parsed.ok) throw new TypeError(`Rate.of: ${parsed.error.message} (${JSON.stringify(s)})`);
    return parsed.value;
  },
} as const;

/**
 * The reciprocal, used when `(base, quote)` is missing but `(quote, base)`
 * exists. FINANCIAL-DOMAIN.md §2 specifies `half_even` at `RATE_SCALE`, and
 * requires the result to be recorded as derived rather than looked up.
 */
export function invert(r: Rate, rounding: Rounding = 'half_even'): Rate {
  if (r.value === 0n) throw new RangeError('invert: cannot invert a zero rate');
  return make(divRound(RATE_UNIT * RATE_UNIT, r.value, rounding));
}

export function rCmp(a: Rate, b: Rate): -1 | 0 | 1 {
  return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
}

export function rEq(a: Rate, b: Rate): boolean {
  return a.value === b.value;
}

export function rIsPositive(r: Rate): boolean {
  return r.value > 0n;
}

export function rToDbString(r: Rate): string {
  return formatFixed(r.value, RATE_SCALE);
}

/** Rate as a JS number — solver and display use only. */
export function rToNumber(r: Rate): number {
  return Number(r.value) / Number(RATE_UNIT);
}
