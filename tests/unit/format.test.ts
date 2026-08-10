import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/date';
import { currency, Money } from '@/lib/decimal/money';
import { Rate } from '@/lib/decimal/rate';
import {
  formatDate,
  formatDateShort,
  formatMoney,
  formatMoneyExact,
  formatPercent,
  formatRate,
  type CurrencyDisplay,
} from '@/lib/format';

const INR = currency('INR');
const JPY = currency('JPY');

const rupee: CurrencyDisplay = { code: 'INR', minorUnits: 2, symbol: '₹' };
const yen: CurrencyDisplay = { code: 'JPY', minorUnits: 0, symbol: '¥' };

describe('formatMoney', () => {
  it('groups Indian-style for en-IN', () => {
    expect(formatMoney(Money.of('1234567.5', INR), rupee, { locale: 'en-IN' })).toBe('₹12,34,567.50');
  });

  it('groups Western-style for other locales', () => {
    expect(formatMoney(Money.of('1234567.5', INR), rupee, { locale: 'en-GB' })).toBe('₹1,234,567.50');
  });

  it('rounds to the currency’s display scale, half away from zero', () => {
    expect(formatMoney(Money.of('10.005', INR), rupee)).toBe('₹10.01');
    expect(formatMoney(Money.of('-10.005', INR), rupee)).toBe('-₹10.01');
  });

  it('honours a zero-decimal currency', () => {
    expect(formatMoney(Money.of('1234.6', JPY), yen)).toBe('¥1,235');
  });

  it('uses a minus sign, never parentheses', () => {
    expect(formatMoney(Money.of('-500', INR), rupee)).toBe('-₹500.00');
  });

  it('can show an explicit plus for a delta', () => {
    expect(formatMoney(Money.of('500', INR), rupee, { signDisplay: 'always' })).toBe('+₹500.00');
    expect(formatMoney(Money.of('-500', INR), rupee, { signDisplay: 'always' })).toBe('-₹500.00');
  });

  it('can drop the sign where the surrounding label carries it', () => {
    expect(formatMoney(Money.of('-500', INR), rupee, { signDisplay: 'never' })).toBe('₹500.00');
  });

  it('can drop the symbol', () => {
    expect(formatMoney(Money.of('500', INR), rupee, { showSymbol: false })).toBe('500.00');
  });

  it('renders small numbers without grouping', () => {
    expect(formatMoney(Money.of('999', INR), rupee)).toBe('₹999.00');
    expect(formatMoney(Money.of('1000', INR), rupee)).toBe('₹1,000.00');
  });

  it('renders zero as zero', () => {
    expect(formatMoney(Money.zero(INR), rupee)).toBe('₹0.00');
  });

  it('can show more decimals than the currency, for a residual', () => {
    expect(formatMoney(Money.of('0.0001', INR), rupee, { decimals: 4 })).toBe('₹0.0001');
  });

  it('never loses a figure to floating point at a large magnitude', () => {
    // 9,007,199,254,740,993 is Number.MAX_SAFE_INTEGER + 2: a float would print
    // the wrong digits here.
    expect(formatMoney(Money.of('9007199254740993', INR), rupee, { locale: 'en-GB' })).toBe(
      '₹9,007,199,254,740,993.00',
    );
  });
});

describe('formatMoneyExact', () => {
  it('shows the stored figure at full precision', () => {
    expect(formatMoneyExact(Money.of('10.005', INR))).toBe('INR 10.0050');
  });
});

describe('formatPercent', () => {
  it('renders a rate as a percentage', () => {
    expect(formatPercent(Rate.of('0.0725'))).toBe('7.25%');
    expect(formatPercent(Rate.of('0.75'))).toBe('75.00%');
    expect(formatPercent(Rate.of('1.25'))).toBe('125.00%');
  });

  it('renders a negative rate with a leading minus', () => {
    expect(formatPercent(Rate.of('-0.5'))).toBe('-50.00%');
  });

  it('honours a decimal count', () => {
    expect(formatPercent(Rate.of('0.12345'), 0)).toBe('12%');
    expect(formatPercent(Rate.of('0.12345'), 3)).toBe('12.345%');
  });

  it('rejects a decimal count the scale cannot support', () => {
    expect(() => formatPercent(Rate.of('0.5'), 99)).toThrow();
  });
});

describe('formatRate', () => {
  it('renders an FX rate as a plain multiplier', () => {
    expect(formatRate(Rate.of('83.25'))).toBe('83.2500');
    expect(formatRate(Rate.of('83.256789'), 2)).toBe('83.26');
  });
});

describe('dates', () => {
  it('is unambiguous about day and month', () => {
    expect(formatDate(isoDate('2026-08-10'))).toBe('10 Aug 2026');
    expect(formatDateShort(isoDate('2026-08-10'))).toBe('10 Aug');
  });

  it('handles the first and last months', () => {
    expect(formatDate(isoDate('2026-01-01'))).toBe('1 Jan 2026');
    expect(formatDate(isoDate('2026-12-31'))).toBe('31 Dec 2026');
  });
});
