import { describe, expect, it } from 'vitest';

import {
  QTY_MAX_UNITS,
  Quantity,
  qAdd,
  qCmp,
  qIsZero,
  qScale,
  qSub,
  qSum,
  qToDbString,
  qToNumber,
} from '@/lib/decimal/quantity';
import { RATE_MAX_VALUE, Rate, invert, rToDbString, rToNumber } from '@/lib/decimal/rate';

describe('Quantity', () => {
  it('holds scale 8, as mutual-fund units require', () => {
    expect(qToDbString(Quantity.of('123.45678901'))).toBe('123.45678901');
    expect(qToDbString(Quantity.of('1'))).toBe('1.00000000');
  });

  it('rejects more than 8 decimals rather than truncating', () => {
    const result = Quantity.parseUserInput('1.123456789');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('too_many_decimals');
  });

  it('adds and subtracts exactly', () => {
    expect(qToDbString(qAdd(Quantity.of('0.1'), Quantity.of('0.2')))).toBe('0.30000000');
    expect(qIsZero(qSub(Quantity.of('5'), Quantity.of('5')))).toBe(true);
  });

  it('sums an empty list to zero', () => {
    expect(qToDbString(qSum([]))).toBe('0.00000000');
  });

  it('scales by a whole-number ratio, which is what a split is', () => {
    // A 1:5 split turns 100 units into 500.
    expect(qToDbString(qScale(Quantity.of('100'), 5n, 1n, 'half_up'))).toBe('500.00000000');
    // A 1:1 bonus doubles the holding.
    expect(qToDbString(qScale(Quantity.of('100'), 2n, 1n, 'half_up'))).toBe('200.00000000');
  });

  it('rounds a ratio that does not divide evenly, by the mode given', () => {
    expect(qToDbString(qScale(Quantity.of('1'), 1n, 3n, 'floor'))).toBe('0.33333333');
    expect(qToDbString(qScale(Quantity.of('1'), 1n, 3n, 'ceil'))).toBe('0.33333334');
  });

  it('rejects a zero denominator', () => {
    expect(() => qScale(Quantity.of('1'), 1n, 0n, 'half_up')).toThrow(RangeError);
  });

  it('enforces the NUMERIC(28,8) range', () => {
    expect(Quantity.fromUnits(QTY_MAX_UNITS).units).toBe(QTY_MAX_UNITS);
    expect(() => Quantity.fromUnits(QTY_MAX_UNITS + 1n)).toThrow(RangeError);
  });

  it('orders values', () => {
    expect(qCmp(Quantity.of('1'), Quantity.of('2'))).toBe(-1);
    expect(qCmp(Quantity.of('2'), Quantity.of('2.00000000'))).toBe(0);
  });

  it('refuses to produce an inexact number above the safe integer range', () => {
    const huge = Quantity.fromUnits(BigInt(Number.MAX_SAFE_INTEGER) + 1n);
    expect(() => qToNumber(huge)).toThrow(RangeError);
  });
});

describe('Rate', () => {
  it('holds scale 10', () => {
    expect(rToDbString(Rate.of('83.25'))).toBe('83.2500000000');
    expect(rToDbString(Rate.one())).toBe('1.0000000000');
  });

  it('stores a percentage as a decimal fraction', () => {
    // 7.25% is 0.0725, not 7.25 (SCHEMA.md, Conventions).
    expect(rToDbString(Rate.of('0.0725'))).toBe('0.0725000000');
    expect(rToNumber(Rate.of('0.0725'))).toBeCloseTo(0.0725, 10);
  });

  it('inverts with half_even at RATE_SCALE, as the FX rule specifies', () => {
    // 1 / 83.25 = 0.012012012012012...
    expect(rToDbString(invert(Rate.of('83.25')))).toBe('0.0120120120');
    // Inverting the identity is the identity.
    expect(rToDbString(invert(Rate.one()))).toBe('1.0000000000');
  });

  it('round-trips a clean reciprocal exactly', () => {
    expect(rToDbString(invert(invert(Rate.of('2'))))).toBe('2.0000000000');
  });

  it('refuses to invert zero', () => {
    expect(() => invert(Rate.fromValue(0n))).toThrow(RangeError);
  });

  it('enforces the NUMERIC(20,10) range', () => {
    expect(Rate.fromValue(RATE_MAX_VALUE).value).toBe(RATE_MAX_VALUE);
    expect(() => Rate.fromValue(RATE_MAX_VALUE + 1n)).toThrow(RangeError);
  });
});
