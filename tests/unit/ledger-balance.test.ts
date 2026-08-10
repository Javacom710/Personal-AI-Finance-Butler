import { describe, expect, it } from 'vitest';

import { currency, Money, toDbString } from '@/lib/decimal/money';
import {
  accountRole,
  availableCredit,
  deriveBalance,
  withRunningBalance,
} from '@/server/domain/ledger/balance';

const INR = currency('INR');
const m = (s: string) => Money.of(s, INR);

describe('deriveBalance', () => {
  it('is the opening balance when there are no entries', () => {
    expect(toDbString(deriveBalance(m('1000'), []))).toBe('1000.0000');
  });

  it('adds signed entries to the opening balance', () => {
    const balance = deriveBalance(m('1000'), [m('500'), m('-200'), m('-50.25')]);
    expect(toDbString(balance)).toBe('1249.7500');
  });

  it('is independent of the order the entries arrive in', () => {
    const entries = [m('137.13'), m('-9.99'), m('1000000'), m('-0.0001')];
    const forward = deriveBalance(m('12.34'), entries);
    const reversed = deriveBalance(m('12.34'), [...entries].reverse());
    expect(toDbString(forward)).toBe(toDbString(reversed));
  });

  it('includes investment cash movements when they are supplied', () => {
    // Phase 4 fills this array. Passing it now proves the parameter is summed
    // rather than accepted and dropped.
    const balance = deriveBalance(m('0'), [m('1000')], [m('-400'), m('25')]);
    expect(toDbString(balance)).toBe('625.0000');
  });

  it('goes negative for a card that has been spent on', () => {
    const balance = deriveBalance(m('0'), [m('-12500'), m('-3000')]);
    expect(toDbString(balance)).toBe('-15500.0000');
  });

  it('refuses to mix currencies', () => {
    expect(() => deriveBalance(m('100'), [Money.of('5', currency('USD'))])).toThrow();
  });
});

describe('withRunningBalance', () => {
  it('ends at the same figure deriveBalance produces', () => {
    const amounts = ['500', '-120.75', '-30', '1000'].map(m);
    const opening = m('250');

    const lines = withRunningBalance(
      opening,
      amounts.map((amount, index) => ({ row: index, amount })),
    );

    expect(lines).toHaveLength(4);
    expect(toDbString(lines.at(-1)!.balance)).toBe(toDbString(deriveBalance(opening, amounts)));
  });

  it('carries the row through untouched', () => {
    const lines = withRunningBalance(m('0'), [{ row: { id: 'x' }, amount: m('5') }]);
    expect(lines[0]!.row).toEqual({ id: 'x' });
    expect(toDbString(lines[0]!.balance)).toBe('5.0000');
  });

  it('produces nothing for an empty ledger', () => {
    expect(withRunningBalance(m('100'), [])).toEqual([]);
  });
});

describe('accountRole', () => {
  it('treats cards and loans as liabilities whatever their sign', () => {
    expect(accountRole('credit_card', m('-5000'))).toBe('liability');
    expect(accountRole('credit_card', m('500'))).toBe('liability');
    expect(accountRole('loan', m('-100000'))).toBe('liability');
  });

  it('treats ordinary accounts as assets, including when overdrawn', () => {
    expect(accountRole('bank', m('1000'))).toBe('asset');
    expect(accountRole('bank', m('-1000'))).toBe('asset');
    expect(accountRole('brokerage', m('0'))).toBe('asset');
  });

  it('lets `other` fall on the side its sign puts it', () => {
    expect(accountRole('other', m('1'))).toBe('asset');
    expect(accountRole('other', m('0'))).toBe('asset');
    expect(accountRole('other', m('-1'))).toBe('liability');
  });
});

describe('availableCredit', () => {
  it('subtracts the outstanding balance from the limit', () => {
    expect(toDbString(availableCredit(m('200000'), m('-45000')))).toBe('155000.0000');
  });

  it('is the whole limit when nothing is owed', () => {
    expect(toDbString(availableCredit(m('200000'), m('0')))).toBe('200000.0000');
  });

  it('does not add an overpayment to the limit', () => {
    // A card in credit has its full limit available, not limit + credit.
    expect(toDbString(availableCredit(m('200000'), m('500')))).toBe('200000.0000');
  });
});
