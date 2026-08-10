import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { currency, Money, toDbString } from '@/lib/decimal/money';
import { Rate } from '@/lib/decimal/rate';
import { buildEntries } from '@/server/domain/ledger/entries';
import { deriveBalance, withRunningBalance } from '@/server/domain/ledger/balance';
import {
  cashflow,
  totalOverAllKinds,
  totalsByGroup,
  type CashflowEntry,
  type GroupedEntry,
} from '@/server/domain/calc/cashflow';

/**
 * Algebraic laws over the money ledger.
 *
 * These are the properties the whole product rests on. A table-driven test can
 * only show that the cases somebody thought of hold; these show that the law
 * holds over the space.
 */

const INR = currency('INR');

/** Amounts up to ±10 million rupees, at full scale-4 precision. */
const money = fc.bigInt({ min: -100_000_000_000n, max: 100_000_000_000n }).map((minor) => Money.fromMinor(minor, INR));

/** A strictly positive amount, as a user would type it. */
const positiveMoney = fc
  .bigInt({ min: 1n, max: 100_000_000_000n })
  .map((minor) => Money.fromMinor(minor, INR));

describe('deriveBalance', () => {
  it('is independent of the order the entries arrive in', () => {
    fc.assert(
      fc.property(money, fc.array(money, { maxLength: 40 }), (opening, entries) => {
        const forward = deriveBalance(opening, entries);
        const reversed = deriveBalance(opening, [...entries].reverse());
        expect(toDbString(forward)).toBe(toDbString(reversed));
      }),
    );
  });

  it('is the opening balance plus the exact sum of the entries', () => {
    fc.assert(
      fc.property(money, fc.array(money, { maxLength: 40 }), (opening, entries) => {
        const expected = entries.reduce((acc, e) => acc + e.minor, opening.minor);
        expect(deriveBalance(opening, entries).minor).toBe(expected);
      }),
    );
  });

  it('agrees with the last row of the running balance', () => {
    fc.assert(
      fc.property(money, fc.array(money, { minLength: 1, maxLength: 40 }), (opening, entries) => {
        const lines = withRunningBalance(
          opening,
          entries.map((amount, index) => ({ row: index, amount })),
        );
        expect(lines.at(-1)!.balance.minor).toBe(deriveBalance(opening, entries).minor);
      }),
    );
  });

  it('splitting the entries in two and summing the parts gives the same balance', () => {
    fc.assert(
      fc.property(
        money,
        fc.array(money, { maxLength: 40 }),
        fc.nat({ max: 40 }),
        (opening, entries, cut) => {
          const at = Math.min(cut, entries.length);
          const first = deriveBalance(opening, entries.slice(0, at));
          const both = deriveBalance(first, entries.slice(at));
          expect(both.minor).toBe(deriveBalance(opening, entries).minor);
        },
      ),
    );
  });
});

describe('transfers', () => {
  it('always produce two legs that cancel exactly in base currency', () => {
    fc.assert(
      fc.property(positiveMoney, (amount) => {
        const result = buildEntries(
          {
            kind: 'transfer',
            from: { accountId: 'a', amount, fxRateToBase: Rate.one() },
            to: { accountId: 'b', amount, fxRateToBase: Rate.one() },
          },
          INR,
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        // Invariant I-3, over the whole amount space rather than a few examples.
        expect(result.value[0]!.baseAmount.minor + result.value[1]!.baseAmount.minor).toBe(0n);
      }),
    );
  });

  it('never contribute to income or expenses, whatever their amounts', () => {
    fc.assert(
      fc.property(
        fc.array(positiveMoney, { maxLength: 15 }),
        fc.array(positiveMoney, { maxLength: 15 }),
        fc.array(positiveMoney, { maxLength: 15 }),
        (incomes, expenses, transfers) => {
          const base: CashflowEntry[] = [
            ...incomes.map((baseAmount) => ({ kind: 'income' as const, baseAmount })),
            ...expenses.map((amount) => ({
              kind: 'expense' as const,
              baseAmount: Money.fromMinor(-amount.minor, INR),
            })),
          ];

          const withTransfers: CashflowEntry[] = [
            ...base,
            ...transfers.flatMap((amount) => [
              { kind: 'transfer' as const, baseAmount: Money.fromMinor(-amount.minor, INR) },
              { kind: 'transfer' as const, baseAmount: amount },
            ]),
          ];

          const without = cashflow(base, INR);
          const with_ = cashflow(withTransfers, INR);

          expect(with_.income.minor).toBe(without.income.minor);
          expect(with_.expenses.minor).toBe(without.expenses.minor);
          expect(with_.savings.minor).toBe(without.savings.minor);
          expect(with_.fxEffect.minor).toBe(0n);
        },
      ),
    );
  });

  it('leave an unfiltered sum equal to net cash flow (edge case 28)', () => {
    fc.assert(
      fc.property(
        fc.array(positiveMoney, { maxLength: 15 }),
        fc.array(positiveMoney, { maxLength: 15 }),
        fc.array(positiveMoney, { maxLength: 15 }),
        (incomes, expenses, transfers) => {
          const entries: CashflowEntry[] = [
            ...incomes.map((baseAmount) => ({ kind: 'income' as const, baseAmount })),
            ...expenses.map((amount) => ({
              kind: 'expense' as const,
              baseAmount: Money.fromMinor(-amount.minor, INR),
            })),
            ...transfers.flatMap((amount) => [
              { kind: 'transfer' as const, baseAmount: Money.fromMinor(-amount.minor, INR) },
              { kind: 'transfer' as const, baseAmount: amount },
            ]),
          ];

          expect(totalOverAllKinds(entries, INR).minor).toBe(cashflow(entries, INR).netCashFlow.minor);
        },
      ),
    );
  });
});

describe('grouped totals', () => {
  it('sum back to the headline figure for the same kind', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(positiveMoney, fc.constantFrom('a', 'b', 'c')), { maxLength: 30 }),
        (rows) => {
          const entries: GroupedEntry[] = rows.map(([amount, key]) => ({
            kind: 'expense',
            baseAmount: Money.fromMinor(-amount.minor, INR),
            groupKey: key,
          }));

          const totals = totalsByGroup(entries, 'expense', INR);
          const summed = totals.reduce((acc, t) => acc + t.total.minor, 0n);

          // The breakdown and the headline cannot disagree, because they are the
          // same sum over the same array.
          expect(summed).toBe(cashflow(entries, INR).expenses.minor);
        },
      ),
    );
  });

  it('are ordered largest first', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(positiveMoney, fc.constantFrom('a', 'b', 'c', 'd')), { maxLength: 30 }),
        (rows) => {
          const totals = totalsByGroup(
            rows.map(([amount, key]) => ({
              kind: 'expense' as const,
              baseAmount: Money.fromMinor(-amount.minor, INR),
              groupKey: key,
            })),
            'expense',
            INR,
          );

          for (let i = 1; i < totals.length; i += 1) {
            expect(totals[i - 1]!.total.minor >= totals[i]!.total.minor).toBe(true);
          }
        },
      ),
    );
  });
});

describe('entry construction', () => {
  it('always produces the sign the kind demands', () => {
    fc.assert(
      fc.property(positiveMoney, fc.constantFrom('income' as const, 'expense' as const), (amount, kind) => {
        const result = buildEntries(
          { kind, leg: { accountId: 'a', amount, fxRateToBase: Rate.one() } },
          INR,
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const entry = result.value[0]!;
        expect(entry.amount.minor > 0n).toBe(kind === 'income');
        expect(entry.amount.minor).toBe(kind === 'income' ? amount.minor : -amount.minor);
      }),
    );
  });

  it('derives a base amount the database CHECK would accept', () => {
    fc.assert(
      fc.property(
        positiveMoney,
        fc.bigInt({ min: 1n, max: 1_000_000_000_000n }),
        (amount, rateValue) => {
          const rate = Rate.fromValue(rateValue);
          const result = buildEntries(
            { kind: 'expense', leg: { accountId: 'a', amount, fxRateToBase: rate } },
            INR,
          );
          if (!result.ok) return; // Rejected as converting to zero — a separate law.

          // round(amount × rate, 4) with halves away from zero, which is exactly
          // what Postgres `round(numeric, 4)` does.
          const product = -amount.minor * rate.value;
          const divisor = 10n ** 10n;
          const magnitude = product < 0n ? -product : product;
          const quotient = magnitude / divisor;
          const remainder = magnitude % divisor;
          const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;
          const expected = product < 0n ? -rounded : rounded;

          expect(result.value[0]!.baseAmount.minor).toBe(expected);
        },
      ),
    );
  });
});
