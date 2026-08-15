import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/date';
import { currency, Money, toDbString } from '@/lib/decimal/money';
import {
  accountRole,
  availableCredit,
  deriveBalance,
  existedAt,
  expectedSign,
  isAgainstExpectedSign,
  openingContribution,
  withRunningBalance,
  type AccountKind,
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

/**
 * ADR-25 — classification is by the economic **sign** of the balance, never by
 * `kind`. These assertions previously encoded the kind-driven rule; they are
 * inverted here because the rule was superseded, not because the code failed
 * them. The kind-driven rule lost money in two directions at once — see the
 * overpaid-card case below.
 */
describe('accountRole — by sign, not by kind (ADR-25)', () => {
  const KINDS: AccountKind[] = ['bank', 'cash', 'credit_card', 'wallet', 'brokerage', 'loan', 'other'];

  it('classifies a positive balance as an asset, for EVERY kind', () => {
    for (const kind of KINDS) expect(accountRole(kind, m('1000'))).toBe('asset');
  });

  it('classifies a negative balance as a liability, for EVERY kind', () => {
    for (const kind of KINDS) expect(accountRole(kind, m('-1000'))).toBe('liability');
  });

  it('classifies a zero balance as neither, for EVERY kind', () => {
    for (const kind of KINDS) expect(accountRole(kind, m('0'))).toBe('none');
  });

  // The regression the gate exists for. Under the kind-driven rule this row was
  // simultaneously a liability here and absent from both terms of the net-worth
  // formula — a ₹10,000 spread on a ₹5,000 balance.
  it('treats an OVERPAID credit card as an asset, not zero and not a liability', () => {
    expect(accountRole('credit_card', m('5000'))).toBe('asset');
    expect(accountRole('credit_card', m('5000'))).not.toBe('liability');
    expect(accountRole('credit_card', m('5000'))).not.toBe('none');
  });

  it('treats a card carrying a balance as a liability', () => {
    expect(accountRole('credit_card', m('-45000'))).toBe('liability');
  });

  it('treats a settled card as contributing to neither side', () => {
    expect(accountRole('credit_card', m('0'))).toBe('none');
  });

  it('treats an ordinary bank balance as an asset', () => {
    expect(accountRole('bank', m('120000'))).toBe('asset');
  });

  it('treats an OVERDRAWN bank account as a liability, not a negative asset', () => {
    expect(accountRole('bank', m('-8000'))).toBe('liability');
  });

  it('treats a repaid loan account in credit as an asset', () => {
    // An overpaid loan is money the lender owes back, exactly like an overpaid card.
    expect(accountRole('loan', m('2500'))).toBe('asset');
  });

  it('is a pure function of the sign — the magnitude never changes the side', () => {
    for (const value of ['0.0001', '1', '999999999']) {
      expect(accountRole('credit_card', m(value))).toBe('asset');
      expect(accountRole('credit_card', m(`-${value}`))).toBe('liability');
    }
  });
});

describe('expectedSign / isAgainstExpectedSign — display only', () => {
  it('knows the ordinary sign per kind', () => {
    expect(expectedSign('bank')).toBe('positive');
    expect(expectedSign('brokerage')).toBe('positive');
    expect(expectedSign('credit_card')).toBe('negative');
    expect(expectedSign('loan')).toBe('negative');
    expect(expectedSign('other')).toBeNull();
  });

  it('flags an overpaid card and an overdrawn bank account', () => {
    expect(isAgainstExpectedSign('credit_card', m('5000'))).toBe(true);
    expect(isAgainstExpectedSign('bank', m('-8000'))).toBe(true);
  });

  it('does not flag the ordinary cases, a zero balance, or `other`', () => {
    expect(isAgainstExpectedSign('credit_card', m('-45000'))).toBe(false);
    expect(isAgainstExpectedSign('bank', m('120000'))).toBe(false);
    expect(isAgainstExpectedSign('credit_card', m('0'))).toBe(false);
    expect(isAgainstExpectedSign('other', m('-1'))).toBe(false);
  });

  // The flag must never feed back into classification: flagging is a display
  // act, reclassifying is an accounting one.
  it('never changes the role it flags', () => {
    expect(accountRole('credit_card', m('5000'))).toBe('asset');
    expect(isAgainstExpectedSign('credit_card', m('5000'))).toBe(true);
  });
});

/**
 * ADR-26 / N2 — an opening balance is valid only once the account exists.
 */
describe('openingContribution', () => {
  const opened = isoDate('2026-03-01');

  it('contributes nothing before the account was opened', () => {
    expect(toDbString(openingContribution(m('50000'), opened, isoDate('2020-12-31')))).toBe('0.0000');
  });

  it('contributes in full on the opening date itself', () => {
    expect(toDbString(openingContribution(m('50000'), opened, isoDate('2026-03-01')))).toBe('50000.0000');
  });

  it('contributes in full after the opening date', () => {
    expect(toDbString(openingContribution(m('50000'), opened, isoDate('2026-06-30')))).toBe('50000.0000');
  });

  it('contributes in full when no bound is given', () => {
    expect(toDbString(openingContribution(m('50000'), opened, null))).toBe('50000.0000');
  });

  it('keeps the currency when it gates the amount away', () => {
    const gated = openingContribution(m('50000'), opened, isoDate('2020-01-01'));
    expect(gated.currency).toBe(INR);
  });
});

describe('existedAt', () => {
  it('is false strictly before the opening date and true from it onward', () => {
    const opened = isoDate('2026-03-01');
    expect(existedAt(opened, isoDate('2026-02-28'))).toBe(false);
    expect(existedAt(opened, isoDate('2026-03-01'))).toBe(true);
    expect(existedAt(opened, isoDate('2026-03-02'))).toBe(true);
    expect(existedAt(opened, null)).toBe(true);
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
