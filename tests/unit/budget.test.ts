import { describe, expect, it } from 'vitest';

import { currency, Money, toDbString } from '@/lib/decimal/money';
import { rToDbString } from '@/lib/decimal/rate';
import { budgetStatus } from '@/server/domain/calc/budget';

const INR = currency('INR');
const m = (s: string) => Money.of(s, INR);

describe('budgetStatus', () => {
  it('reports utilisation, remaining, and pace', () => {
    const status = budgetStatus({
      budgeted: m('20000'),
      actual: m('5000'),
      daysElapsed: 10,
      daysTotal: 30,
    });

    expect(toDbString(status.remaining)).toBe('15000.0000');
    expect(rToDbString(status.utilization.value!)).toBe('0.2500000000');
    // 0.25 spent against 0.3333… elapsed: behind pace, so negative.
    expect(status.pace.value!.value).toBeLessThan(0n);
    expect(status.isOverBudget).toBe(false);
  });

  it('reports being ahead of pace as a positive figure', () => {
    const status = budgetStatus({
      budgeted: m('20000'),
      actual: m('15000'),
      daysElapsed: 10,
      daysTotal: 30,
    });
    expect(status.pace.value!.value).toBeGreaterThan(0n);
  });

  it('treats over budget as a state, not an error', () => {
    const status = budgetStatus({
      budgeted: m('10000'),
      actual: m('12500'),
      daysElapsed: 30,
      daysTotal: 30,
    });

    expect(status.isOverBudget).toBe(true);
    // The overspend, not a floor at zero: hiding it would understate the problem.
    expect(toDbString(status.remaining)).toBe('-2500.0000');
    expect(rToDbString(status.utilization.value!)).toBe('1.2500000000');
  });

  it('is not over budget when spending exactly equals the budget', () => {
    const status = budgetStatus({
      budgeted: m('10000'),
      actual: m('10000'),
      daysElapsed: 30,
      daysTotal: 30,
    });
    expect(status.isOverBudget).toBe(false);
    expect(rToDbString(status.utilization.value!)).toBe('1.0000000000');
  });

  it('reports zero utilisation when nothing has been spent', () => {
    const status = budgetStatus({
      budgeted: m('10000'),
      actual: m('0'),
      daysElapsed: 1,
      daysTotal: 31,
    });
    expect(rToDbString(status.utilization.value!)).toBe('0.0000000000');
    expect(status.isOverBudget).toBe(false);
  });

  it('stays null-safe against a zero budget (edge case 9)', () => {
    // A zero budget cannot be created — `CHECK (amount > 0)` — but the
    // calculation must not divide by zero if one ever reaches it.
    const status = budgetStatus({
      budgeted: m('0'),
      actual: m('500'),
      daysElapsed: 5,
      daysTotal: 30,
    });

    expect(status.utilization.value).toBeNull();
    expect(status.utilization.reason).toBe('divide_by_zero');
    expect(status.pace.value).toBeNull();
    expect(status.pace.reason).toBe('divide_by_zero');
    expect(status.isOverBudget).toBe(true);
  });

  it('propagates an unavailable pace when the period has no days', () => {
    const status = budgetStatus({
      budgeted: m('10000'),
      actual: m('1000'),
      daysElapsed: 0,
      daysTotal: 0,
    });

    expect(status.utilization.value).not.toBeNull();
    expect(status.pace.value).toBeNull();
    expect(status.pace.reason).toBe('divide_by_zero');
  });

  it('refuses to compare a budget and spending in different currencies', () => {
    expect(() =>
      budgetStatus({
        budgeted: Money.of('100', currency('USD')),
        actual: m('5000'),
        daysElapsed: 1,
        daysTotal: 30,
      }),
    ).toThrow(/Convert through the FX module/);
  });
});
