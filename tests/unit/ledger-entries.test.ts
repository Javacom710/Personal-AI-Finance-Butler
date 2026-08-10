import { describe, expect, it } from 'vitest';

import { currency, Money, toDbString } from '@/lib/decimal/money';
import { Rate } from '@/lib/decimal/rate';
import { assertEntryInvariants, buildEntries, type EntryDraft } from '@/server/domain/ledger/entries';

/**
 * Entry construction and invariants I-1 to I-3.
 *
 * The property under test throughout: **the caller supplies a positive amount
 * and a kind; the engine decides the sign.** Every case here would be a data
 * bug in the ledger if it were wrong, not merely a failing assertion.
 */

const INR = currency('INR');
const USD = currency('USD');
const ONE = Rate.one();

const leg = (accountId: string, amount: string, rate: Rate = ONE, c = INR) => ({
  accountId,
  amount: Money.of(amount, c),
  fxRateToBase: rate,
});

const draft = (overrides: Partial<EntryDraft> = {}): EntryDraft => ({
  accountId: 'a',
  amount: Money.of('-100', INR),
  currency: INR,
  fxRateToBase: ONE,
  baseAmount: Money.of('-100', INR),
  sortOrder: 0,
  ...overrides,
});

describe('buildEntries — signs come from the kind', () => {
  it('makes an income entry positive', () => {
    const result = buildEntries({ kind: 'income', leg: leg('bank', '50000') }, INR);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toHaveLength(1);
    expect(toDbString(result.value[0]!.amount)).toBe('50000.0000');
  });

  it('makes an expense entry negative even though the caller passed a positive amount', () => {
    const result = buildEntries({ kind: 'expense', leg: leg('card', '1250.50') }, INR);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The single most common data-entry bug in this class of software is an
    // expense stored positive, which then increases a balance.
    expect(toDbString(result.value[0]!.amount)).toBe('-1250.5000');
  });

  it('gives a transfer one leaving leg and one arriving leg, in that order', () => {
    const result = buildEntries(
      { kind: 'transfer', from: leg('bank', '5000'), to: leg('wallet', '5000') },
      INR,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.map((e) => toDbString(e.amount))).toEqual(['-5000.0000', '5000.0000']);
    expect(result.value.map((e) => e.sortOrder)).toEqual([0, 1]);
  });
});

describe('buildEntries — rejections', () => {
  it('rejects a zero amount (edge case 1)', () => {
    const result = buildEntries({ kind: 'expense', leg: leg('card', '0') }, INR);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('validation_failed');
  });

  it('rejects a negative amount — the sign is not the caller’s to give', () => {
    const result = buildEntries({ kind: 'income', leg: leg('bank', '-100') }, INR);
    expect(result.ok).toBe(false);
  });

  it('rejects a transfer to and from the same account (edge case 4)', () => {
    const result = buildEntries(
      { kind: 'transfer', from: leg('bank', '100'), to: leg('bank', '100') },
      INR,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('validation_failed');
    if (result.error.code !== 'validation_failed') return;
    expect(result.error.fieldErrors['toAccountId']).toBeDefined();
  });

  it('rejects an amount that converts to zero in base currency', () => {
    // 0.0001 USD at a rate of 0.0001 rounds to 0.0000 INR: the database CHECK
    // would reject it, and storing it would make the movement invisible in
    // every total.
    const tiny = {
      accountId: 'usd',
      amount: Money.of('0.0001', USD),
      fxRateToBase: Rate.of('0.0001'),
    };
    const result = buildEntries({ kind: 'expense', leg: tiny }, INR);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invariant_violation');
  });
});

describe('base amount derivation matches the database CHECK', () => {
  it('rounds half away from zero, as Postgres round(numeric, 4) does', () => {
    // 1 USD at 83.12345 → 83.12345 INR → rounds to 83.1235 (half away from zero).
    const result = buildEntries(
      {
        kind: 'income',
        leg: { accountId: 'usd', amount: Money.of('1', USD), fxRateToBase: Rate.of('83.12345') },
      },
      INR,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toDbString(result.value[0]!.baseAmount)).toBe('83.1235');
  });

  it('rounds a negative amount away from zero too', () => {
    const result = buildEntries(
      {
        kind: 'expense',
        leg: { accountId: 'usd', amount: Money.of('1', USD), fxRateToBase: Rate.of('83.12345') },
      },
      INR,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(toDbString(result.value[0]!.baseAmount)).toBe('-83.1235');
  });
});

describe('assertEntryInvariants', () => {
  it('accepts a well-formed expense', () => {
    const result = assertEntryInvariants({
      kind: 'expense',
      categoryId: 'cat',
      categoryKind: 'expense',
      entries: [draft()],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects an expense against an income category (edge case 5)', () => {
    const result = assertEntryInvariants({
      kind: 'expense',
      categoryId: 'cat',
      categoryKind: 'income',
      entries: [draft()],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    if (result.error.code !== 'validation_failed') throw new Error('expected a field error');
    expect(result.error.fieldErrors['categoryId']?.[0]).toContain('income category');
  });

  it('rejects negative income rather than storing a clawback as income (edge case 20)', () => {
    const result = assertEntryInvariants({
      kind: 'income',
      categoryId: 'cat',
      categoryKind: 'income',
      entries: [draft({ amount: Money.of('-100', INR), baseAmount: Money.of('-100', INR) })],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    if (result.error.code !== 'validation_failed') throw new Error('expected a field error');
    expect(result.error.fieldErrors['amount']?.[0]).toContain('clawback');
  });

  it('rejects income or expense with no category', () => {
    const result = assertEntryInvariants({
      kind: 'expense',
      categoryId: null,
      categoryKind: null,
      entries: [draft()],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a transfer that carries a category (I-2)', () => {
    const result = assertEntryInvariants({
      kind: 'transfer',
      categoryId: 'cat',
      categoryKind: 'expense',
      entries: [
        draft({ accountId: 'a' }),
        draft({ accountId: 'b', amount: Money.of('100', INR), baseAmount: Money.of('100', INR), sortOrder: 1 }),
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    if (result.error.code !== 'validation_failed') throw new Error('expected a field error');
    expect(result.error.fieldErrors['categoryId']).toBeDefined();
  });

  it('rejects a transfer with one entry', () => {
    const result = assertEntryInvariants({
      kind: 'transfer',
      categoryId: null,
      categoryKind: null,
      entries: [draft()],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invariant_violation');
  });

  it('rejects two entries with the same sign', () => {
    const result = assertEntryInvariants({
      kind: 'transfer',
      categoryId: null,
      categoryKind: null,
      entries: [draft({ accountId: 'a' }), draft({ accountId: 'b', sortOrder: 1 })],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a same-currency transfer whose base amounts do not cancel (I-3)', () => {
    const result = assertEntryInvariants({
      kind: 'transfer',
      categoryId: null,
      categoryKind: null,
      entries: [
        draft({ accountId: 'a', amount: Money.of('-100', INR), baseAmount: Money.of('-100', INR) }),
        draft({
          accountId: 'b',
          amount: Money.of('99', INR),
          baseAmount: Money.of('99', INR),
          sortOrder: 1,
        }),
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invariant_violation');
    if (result.error.code !== 'invariant_violation') return;
    expect(result.error.invariant).toBe('I-3');
  });

  it('allows a cross-currency transfer to leave a residual (edge case 3)', () => {
    // 100 USD out at 83.00, 8,250 INR in: the 50 INR difference is the realised
    // exchange effect, and it is reported rather than absorbed.
    const result = assertEntryInvariants({
      kind: 'transfer',
      categoryId: null,
      categoryKind: null,
      entries: [
        draft({
          accountId: 'usd',
          amount: Money.of('-100', USD),
          currency: USD,
          fxRateToBase: Rate.of('83'),
          baseAmount: Money.of('-8300', INR),
        }),
        draft({
          accountId: 'inr',
          amount: Money.of('8250', INR),
          baseAmount: Money.of('8250', INR),
          sortOrder: 1,
        }),
      ],
    });
    expect(result.ok).toBe(true);
  });
});
