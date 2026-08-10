/**
 * Display formatting (FINANCIAL-DOMAIN.md §1).
 *
 * **Display only, and one-way.** A formatted string is never parsed back into a
 * `Money`: grouping separators, symbols and rounding to two decimals all lose
 * information, and re-reading a rendered figure is how a display rounding
 * becomes a stored one.
 *
 * No `Intl.NumberFormat` for amounts, and no `Number` anywhere in the path.
 * `Intl` takes a `number`, which would put a float between the ledger and the
 * screen for no benefit — the grouping rules the application needs are Western
 * and Indian, and both are a few lines of digit manipulation.
 */

import { divRound, pow10 } from '../decimal/rounding';
import { formatFixed } from '../decimal/scaled';
import { MONEY_SCALE, toDbString, type Money } from '../decimal/money';
import { RATE_SCALE, type Rate } from '../decimal/rate';
import type { IsoDate } from '../date';

/** The display facts about a currency, from the `currencies` table. */
export interface CurrencyDisplay {
  readonly code: string;
  /** INR 2, JPY 0. The *display* scale — arithmetic is always at MONEY_SCALE. */
  readonly minorUnits: number;
  readonly symbol: string;
}

export interface MoneyFormatOptions {
  /** `en-IN` groups as 12,34,567; everything else as 1,234,567. */
  readonly locale?: string;
  readonly showSymbol?: boolean;
  /** `always` prefixes a `+` on positive figures — for deltas, not balances. */
  readonly signDisplay?: 'auto' | 'always' | 'never';
  /** Override the currency's display scale, e.g. to show whole rupees. */
  readonly decimals?: number;
}

function usesIndianGrouping(locale: string): boolean {
  const normalised = locale.toLowerCase();
  return normalised.endsWith('-in') || normalised === 'hi' || normalised.startsWith('hi-');
}

/** Group an unsigned integer digit string. */
function group(digits: string, indian: boolean): string {
  if (!indian) {
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  // Indian: the last three digits, then pairs. 1234567 → 12,34,567.
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  return `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}`;
}

/**
 * Render a `Money` for display.
 *
 * Rounding to the currency's display scale is `half_up` and explicit, per
 * ADR-04's rule that no lossy operation has a default mode.
 */
export function formatMoney(
  m: Money,
  display: CurrencyDisplay,
  options: MoneyFormatOptions = {},
): string {
  const { locale = 'en-IN', showSymbol = true, signDisplay = 'auto' } = options;
  const decimals = options.decimals ?? display.minorUnits;

  const rounded =
    decimals >= MONEY_SCALE
      ? m.minor * pow10(decimals - MONEY_SCALE)
      : divRound(m.minor, pow10(MONEY_SCALE - decimals), 'half_up');

  const negative = rounded < 0n;
  const magnitude = negative ? -rounded : rounded;
  const fixed = formatFixed(magnitude, decimals);
  const [whole = '0', fraction] = fixed.split('.');

  const body = group(whole, usesIndianGrouping(locale)) + (fraction ? `.${fraction}` : '');
  const symbol = showSymbol ? display.symbol : '';

  // A minus sign, never parentheses (ARCHITECTURE.md §8).
  const sign = negative && signDisplay !== 'never' ? '-' : signDisplay === 'always' && !negative ? '+' : '';

  return `${sign}${symbol}${body}`;
}

/**
 * The full-precision figure, for a tooltip beside a rounded display value.
 * Shows what is actually stored, so a 0.0001 residual is never invisible.
 */
export function formatMoneyExact(m: Money): string {
  return `${m.currency} ${toDbString(m)}`;
}

/** A `Rate` as a percentage: 0.0725 → "7.25%". */
export function formatPercent(r: Rate, decimals = 2): string {
  if (decimals < 0 || decimals > RATE_SCALE - 2) {
    throw new RangeError(`formatPercent: decimals must be 0..${RATE_SCALE - 2}`);
  }
  const scaled = divRound(r.value * 100n, pow10(RATE_SCALE - decimals), 'half_up');
  const negative = scaled < 0n;
  return `${negative ? '-' : ''}${formatFixed(negative ? -scaled : scaled, decimals)}%`;
}

/** A `Rate` as a plain multiplier: 83.25 → "83.2500". Used for FX display. */
export function formatRate(r: Rate, decimals = 4): string {
  const scaled = divRound(r.value, pow10(RATE_SCALE - decimals), 'half_up');
  return formatFixed(scaled, decimals);
}

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** `2026-08-10` → `10 Aug 2026`. Deliberately unambiguous: never `08/10/2026`. */
export function formatDate(d: IsoDate): string {
  const year = d.slice(0, 4);
  const month = Number(d.slice(5, 7));
  const day = Number(d.slice(8, 10));
  return `${day} ${MONTHS_SHORT[month - 1]} ${year}`;
}

/** `2026-08-10` → `10 Aug`. For dense tables where the year is implied. */
export function formatDateShort(d: IsoDate): string {
  const month = Number(d.slice(5, 7));
  const day = Number(d.slice(8, 10));
  return `${day} ${MONTHS_SHORT[month - 1]}`;
}
