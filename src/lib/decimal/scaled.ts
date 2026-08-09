/**
 * Internal: conversion between fixed-scale integers and decimal strings.
 *
 * Every value in this module is a `bigint` holding a number already multiplied
 * by 10^scale. No `number` appears anywhere in the conversion path — a decimal
 * string becomes a bigint by digit manipulation, never by `parseFloat`
 * (ADR-04, SECURITY.md §5).
 */

import { pow10 } from './rounding';

export type ParseErrorCode = 'empty' | 'malformed' | 'too_many_decimals' | 'out_of_range';

export interface ParseError {
  readonly code: ParseErrorCode;
  readonly message: string;
  readonly input: string;
}

const parseError = (code: ParseErrorCode, message: string, input: string): ParseError => ({
  code,
  message,
  input,
});

/**
 * Strictly `[-+]?digits[.digits]`, with optional grouping separators in the
 * integer part and surrounding whitespace. A currency symbol, an exponent, or a
 * bare `.` is rejected rather than guessed at.
 */
const DECIMAL_RE = /^([+-]?)(\d[\d,]*)(?:\.(\d+))?$/;

/**
 * Grouping separators are accepted, but only where a grouping separator can
 * actually go.
 *
 * This is not pedantry. In much of Europe the comma *is* the decimal separator,
 * so a user typing `1,5` means one and a half. Stripping every comma would read
 * that as fifteen — a tenfold error on a monetary amount, entered silently.
 * Requiring well-formed grouping makes `1,5` a rejection the user can see and
 * correct, while still accepting both grouping conventions this application
 * needs: Western `1,250,000` and Indian `12,34,567`.
 */
const UNGROUPED = /^\d+$/;
const WESTERN_GROUPED = /^\d{1,3}(?:,\d{3})+$/;
const INDIAN_GROUPED = /^\d{1,2}(?:,\d{2})+,\d{3}$/;

function isWellFormedIntegerPart(value: string): boolean {
  if (!value.includes(',')) return UNGROUPED.test(value);
  return WESTERN_GROUPED.test(value) || INDIAN_GROUPED.test(value);
}

export interface ParseOptions {
  /** Maximum digits after the decimal point. More than this is data loss, so it is an error. */
  readonly scale: number;
  /** Largest permitted magnitude, as a scaled integer. Derived from the NUMERIC precision. */
  readonly maxMagnitude: bigint;
}

/**
 * Parse a user- or database-supplied decimal string into a scaled integer.
 *
 * Returns a `Result` rather than throwing: malformed monetary input is an
 * expected condition at a boundary, not a programming error.
 */
export function parseFixed(input: string, opts: ParseOptions): { ok: true; value: bigint } | { ok: false; error: ParseError } {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: parseError('empty', 'value is empty', input) };
  }

  const m = DECIMAL_RE.exec(trimmed);
  if (!m) {
    return {
      ok: false,
      error: parseError('malformed', 'not a well-formed decimal number', input),
    };
  }

  const sign = m[1] === '-' ? -1n : 1n;
  const rawIntPart = m[2] ?? '';
  const fracPart = m[3] ?? '';

  if (!isWellFormedIntegerPart(rawIntPart)) {
    return {
      ok: false,
      error: parseError(
        'malformed',
        'digit grouping is not well formed — use a full stop for decimals',
        input,
      ),
    };
  }

  const intPart = rawIntPart.replace(/,/g, '');

  if (fracPart.length > opts.scale) {
    return {
      ok: false,
      error: parseError(
        'too_many_decimals',
        `at most ${opts.scale} decimal places are representable; got ${fracPart.length}`,
        input,
      ),
    };
  }

  const padded = fracPart.padEnd(opts.scale, '0');
  const magnitude = BigInt(intPart + padded);

  if (magnitude > opts.maxMagnitude) {
    return {
      ok: false,
      error: parseError('out_of_range', 'value exceeds the storable range', input),
    };
  }

  return { ok: true, value: sign * magnitude };
}

/** Format a scaled integer as a fixed-point decimal string with exactly `scale` decimals. */
export function formatFixed(value: bigint, scale: number): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const divisor = pow10(scale);
  const whole = magnitude / divisor;
  const frac = magnitude % divisor;
  const fracStr = scale === 0 ? '' : `.${frac.toString().padStart(scale, '0')}`;
  return `${negative ? '-' : ''}${whole.toString()}${fracStr}`;
}

/** Guard every construction and every arithmetic result against the column's range. */
export function assertInRange(value: bigint, maxMagnitude: bigint, what: string): void {
  const magnitude = value < 0n ? -value : value;
  if (magnitude > maxMagnitude) {
    throw new RangeError(
      `${what} out of range: ${value} exceeds the storable magnitude ${maxMagnitude}. ` +
        'This is a programming error — the value can never be persisted.',
    );
  }
}
