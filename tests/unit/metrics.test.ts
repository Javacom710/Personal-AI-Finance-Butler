/**
 * Financial-health metrics (FINANCIAL-DOMAIN.md §8.1).
 *
 * Every `null` path asserts **the reason** — a test asserting only `null` would
 * pass against a function that always failed (src/lib/metric.ts).
 */

import { describe, expect, it } from 'vitest';

import { Money, currency, toDbString } from '@/lib/decimal/money';
import { rToDbString } from '@/lib/decimal/rate';
import {
  averageMonthlyExpenses,
  commitmentCoverage,
  expenseRatio,
  runwayMonths,
} from '@/server/domain/calc/metrics';

const INR = currency('INR');
const inr = (s: string) => Money.of(s, INR);

describe('expense ratio', () => {
  it('is expenses over income', () => {
    expect(rToDbString(expenseRatio({ income: inr('100000'), expenses: inr('60000') }).value!)).toBe('0.6000000000');
  });

  it('exceeds one when spending outran income', () => {
    expect(rToDbString(expenseRatio({ income: inr('50000'), expenses: inr('75000') }).value!)).toBe('1.5000000000');
  });

  it('is unavailable, not zero, with no income', () => {
    const result = expenseRatio({ income: inr('0'), expenses: inr('60000') });
    expect(result.value).toBeNull();
    expect(result.reason).toBe('divide_by_zero');
  });
});

describe('average monthly expenses', () => {
  it('divides the window total by its complete months', () => {
    const average = averageMonthlyExpenses({ months: 3, entryCount: 40, expenses: inr('90000') });
    expect(toDbString(average.value!)).toBe('30000.0000');
  });

  it('rounds half up, once', () => {
    // 100 / 3 = 33.33333… → 33.3333
    expect(toDbString(averageMonthlyExpenses({ months: 3, entryCount: 1, expenses: inr('100') }).value!)).toBe('33.3333');
    // 0.0002 / 4 = 0.00005 → 0.0001
    expect(toDbString(averageMonthlyExpenses({ months: 4, entryCount: 1, expenses: inr('0.0002') }).value!)).toBe('0.0001');
  });

  it('distinguishes nothing recorded from nothing spent', () => {
    const unrecorded = averageMonthlyExpenses({ months: 3, entryCount: 0, expenses: inr('0') });
    expect(unrecorded.value).toBeNull();
    expect(unrecorded.reason).toBe('no_data');

    const frugal = averageMonthlyExpenses({ months: 3, entryCount: 2, expenses: inr('0') });
    expect(toDbString(frugal.value!)).toBe('0.0000');
  });

  it('refuses a window of no months', () => {
    expect(() => averageMonthlyExpenses({ months: 0, entryCount: 1, expenses: inr('1') })).toThrow(RangeError);
  });
});

describe('runway', () => {
  it('is liquid cash over the monthly average, as a multiple', () => {
    expect(rToDbString(runwayMonths(inr('150000'), { value: inr('30000') }).value!)).toBe('5.0000000000');
    expect(rToDbString(runwayMonths(inr('100000'), { value: inr('30000') }).value!)).toBe('3.3333333333');
  });

  it('carries the reason through when there is no spending history', () => {
    const result = runwayMonths(inr('150000'), { value: null, reason: 'no_data' });
    expect(result.value).toBeNull();
    expect(result.reason).toBe('no_data');
  });

  it('is unavailable, not infinite, when nothing was spent', () => {
    const result = runwayMonths(inr('150000'), { value: inr('0') });
    expect(result.value).toBeNull();
    expect(result.reason).toBe('divide_by_zero');
  });

  it('is zero months when the cash is overdrawn', () => {
    expect(rToDbString(runwayMonths(inr('-5000'), { value: inr('30000') }).value!)).toBe('0.0000000000');
  });
});

describe('commitment coverage', () => {
  it('compares liquid cash with what is due', () => {
    const result = commitmentCoverage(inr('100000'), [{ amount: inr('20000') }, { amount: inr('5000') }], INR);
    expect(toDbString(result.commitmentsDue)).toBe('25000.0000');
    expect(result.commitmentCount).toBe(2);
    expect(rToDbString(result.coverage.value!)).toBe('4.0000000000');
    expect(toDbString(result.surplus)).toBe('75000.0000');
  });

  it('shows a shortfall as a negative surplus and a multiple below one', () => {
    const result = commitmentCoverage(inr('10000'), [{ amount: inr('25000') }], INR);
    expect(rToDbString(result.coverage.value!)).toBe('0.4000000000');
    expect(toDbString(result.surplus)).toBe('-15000.0000');
  });

  it('is unavailable, not infinite, when nothing is due', () => {
    const result = commitmentCoverage(inr('100000'), [], INR);
    expect(result.coverage.value).toBeNull();
    expect(result.coverage.reason).toBe('divide_by_zero');
    expect(toDbString(result.surplus)).toBe('100000.0000');
  });

  it('covers nothing from an overdrawn balance, and keeps the true shortfall', () => {
    const result = commitmentCoverage(inr('-2000'), [{ amount: inr('8000') }], INR);
    expect(rToDbString(result.coverage.value!)).toBe('0.0000000000');
    expect(toDbString(result.surplus)).toBe('-10000.0000');
  });
});
