import { describe, expect, it } from 'vitest';

import { currency, Money, toDbString } from '@/lib/decimal/money';
import { rToDbString } from '@/lib/decimal/rate';
import {
  cashflow,
  combineCashflow,
  comparePeriods,
  emptyCashflow,
  totalOverAllKinds,
  totalsByGroup,
  type CashflowEntry,
  type GroupedEntry,
} from '@/server/domain/calc/cashflow';

/**
 * The calculation the whole product invariant rests on:
 * **transfers appear in neither income nor expense totals.**
 */

const INR = currency('INR');
const m = (s: string) => Money.of(s, INR);

const income = (amount: string): CashflowEntry => ({ kind: 'income', baseAmount: m(amount) });
const expense = (amount: string): CashflowEntry => ({ kind: 'expense', baseAmount: m(`-${amount}`) });
const transferLeg = (amount: string): CashflowEntry => ({ kind: 'transfer', baseAmount: m(amount) });

describe('cashflow', () => {
  it('sums income and reports expenses as a positive magnitude', () => {
    const summary = cashflow([income('50000'), expense('12000'), expense('3500.75')], INR);

    expect(toDbString(summary.income)).toBe('50000.0000');
    expect(toDbString(summary.expenses)).toBe('15500.7500');
    expect(toDbString(summary.netCashFlow)).toBe('34499.2500');
    expect(toDbString(summary.savings)).toBe(toDbString(summary.netCashFlow));
  });

  it('computes the savings rate as savings over income', () => {
    const summary = cashflow([income('100000'), expense('25000')], INR);
    // 75,000 / 100,000 = 0.75
    expect(summary.savingsRate.value).not.toBeNull();
    expect(rToDbString(summary.savingsRate.value!)).toBe('0.7500000000');
  });

  it('reports a negative savings rate when spending exceeds income', () => {
    const summary = cashflow([income('10000'), expense('15000')], INR);
    expect(rToDbString(summary.savingsRate.value!)).toBe('-0.5000000000');
  });

  it('returns null with reason divide_by_zero when income is zero (edge case 13)', () => {
    const summary = cashflow([expense('500')], INR);

    // Asserting the reason, not merely the null: a test that checked only for
    // null would pass against a function that always failed.
    expect(summary.savingsRate.value).toBeNull();
    expect(summary.savingsRate.reason).toBe('divide_by_zero');
  });

  it('leaves income and expenses untouched by transfer legs', () => {
    const withoutTransfer = cashflow([income('50000'), expense('12000')], INR);
    const withTransfer = cashflow(
      [income('50000'), expense('12000'), transferLeg('-20000'), transferLeg('20000')],
      INR,
    );

    expect(toDbString(withTransfer.income)).toBe(toDbString(withoutTransfer.income));
    expect(toDbString(withTransfer.expenses)).toBe(toDbString(withoutTransfer.expenses));
    expect(toDbString(withTransfer.savings)).toBe(toDbString(withoutTransfer.savings));
    expect(rToDbString(withTransfer.savingsRate.value!)).toBe(
      rToDbString(withoutTransfer.savingsRate.value!),
    );
  });

  it('reports a same-currency transfer as zero FX effect', () => {
    const summary = cashflow([transferLeg('-20000'), transferLeg('20000')], INR);
    expect(toDbString(summary.fxEffect)).toBe('0.0000');
  });

  it('reports the residual of a cross-currency transfer as an FX effect (edge case 3)', () => {
    // 8,300 out, 8,250 in: a 50 INR realised exchange difference.
    const summary = cashflow([transferLeg('-8300'), transferLeg('8250')], INR);

    expect(toDbString(summary.fxEffect)).toBe('-50.0000');
    expect(toDbString(summary.income)).toBe('0.0000');
    expect(toDbString(summary.expenses)).toBe('0.0000');
  });

  it('refuses entries that are not already in base currency', () => {
    const foreign: CashflowEntry = { kind: 'income', baseAmount: Money.of('10', currency('USD')) };
    expect(() => cashflow([foreign], INR)).toThrow(/must already be in INR/);
  });
});

describe('totalOverAllKinds — the safety net behind the kind filter (edge case 28)', () => {
  it('equals net cash flow when every transfer is same-currency', () => {
    const entries = [income('50000'), expense('12000'), transferLeg('-20000'), transferLeg('20000')];
    const summary = cashflow(entries, INR);

    // Summing every base_amount with no filter at all still gives net cash flow,
    // because a same-currency transfer's two legs cancel exactly (I-3).
    expect(toDbString(totalOverAllKinds(entries, INR))).toBe(toDbString(summary.netCashFlow));
  });

  it('differs from net cash flow by exactly the FX effect', () => {
    const entries = [income('50000'), expense('12000'), transferLeg('-8300'), transferLeg('8250')];
    const summary = cashflow(entries, INR);

    const total = totalOverAllKinds(entries, INR);
    expect(total.minor).toBe(summary.netCashFlow.minor + summary.fxEffect.minor);
  });
});

describe('emptyCashflow', () => {
  it('is all zeroes with an unavailable rate, not a zero rate', () => {
    const summary = emptyCashflow(INR);
    expect(toDbString(summary.income)).toBe('0.0000');
    expect(summary.savingsRate.value).toBeNull();
    expect(summary.savingsRate.reason).toBe('divide_by_zero');
  });
});

describe('totalsByGroup', () => {
  const grouped: GroupedEntry[] = [
    { kind: 'expense', baseAmount: m('-1000'), groupKey: 'food' },
    { kind: 'expense', baseAmount: m('-2500'), groupKey: 'food' },
    { kind: 'expense', baseAmount: m('-800'), groupKey: 'transport' },
    { kind: 'income', baseAmount: m('50000'), groupKey: 'salary' },
    { kind: 'expense', baseAmount: m('-99'), groupKey: null },
  ];

  it('totals only the requested kind and reports expenses as magnitudes', () => {
    const totals = totalsByGroup(grouped, 'expense', INR);
    expect(totals.map((t) => [t.groupKey, toDbString(t.total)])).toEqual([
      ['food', '3500.0000'],
      ['transport', '800.0000'],
      [null, '99.0000'],
    ]);
  });

  it('never lets an income row into an expense total', () => {
    const totals = totalsByGroup(grouped, 'expense', INR);
    expect(totals.find((t) => t.groupKey === 'salary')).toBeUndefined();
  });

  it('excludes transfer legs even when they carry the grouping key (edge case 21)', () => {
    // A tag is allowed on a transfer, so a tag-grouped report that forgot the
    // kind filter would count both legs as spending.
    const tagged: GroupedEntry[] = [
      { kind: 'expense', baseAmount: m('-1000'), groupKey: 'travel' },
      { kind: 'transfer', baseAmount: m('-50000'), groupKey: 'travel' },
      { kind: 'transfer', baseAmount: m('50000'), groupKey: 'travel' },
    ];

    const totals = totalsByGroup(tagged, 'expense', INR);
    expect(totals).toHaveLength(1);
    expect(toDbString(totals[0]!.total)).toBe('1000.0000');
  });

  it('sorts largest first', () => {
    const totals = totalsByGroup(grouped, 'expense', INR);
    expect(totals[0]!.groupKey).toBe('food');
  });
});

describe('comparePeriods', () => {
  it('reports absolute and percentage deltas', () => {
    const current = cashflow([income('120000'), expense('60000')], INR);
    const previous = cashflow([income('100000'), expense('50000')], INR);
    const comparison = comparePeriods(current, previous);

    expect(toDbString(comparison.income.absolute)).toBe('20000.0000');
    expect(rToDbString(comparison.income.percent.value!)).toBe('0.2000000000');
    expect(toDbString(comparison.expenses.absolute)).toBe('10000.0000');
  });

  it('reports a null percentage when the base period was zero, not an infinity', () => {
    const current = cashflow([income('1000')], INR);
    const previous = emptyCashflow(INR);
    const comparison = comparePeriods(current, previous);

    expect(comparison.income.percent.value).toBeNull();
    expect(comparison.income.percent.reason).toBe('divide_by_zero');
    expect(toDbString(comparison.income.absolute)).toBe('1000.0000');
  });
});

describe('combineCashflow', () => {
  it('sums a series of periods into one', () => {
    const months = [
      cashflow([income('50000'), expense('30000')], INR),
      cashflow([income('50000'), expense('20000')], INR),
      emptyCashflow(INR),
    ];

    const year = combineCashflow(months, INR);
    expect(toDbString(year.income)).toBe('100000.0000');
    expect(toDbString(year.expenses)).toBe('50000.0000');
    expect(toDbString(year.savings)).toBe('50000.0000');
    expect(rToDbString(year.savingsRate.value!)).toBe('0.5000000000');
  });

  it('returns an empty summary for an empty series', () => {
    expect(toDbString(combineCashflow([], INR).income)).toBe('0.0000');
  });
});
