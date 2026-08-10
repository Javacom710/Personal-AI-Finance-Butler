/**
 * Entry construction and the entry invariants (FINANCIAL-DOMAIN.md §4,
 * SCHEMA.md §4.1, invariants I-1 to I-3).
 *
 * **The caller supplies a positive amount and a `kind`; this module decides the
 * sign.** That single rule removes the largest class of data-entry bug in this
 * kind of software — an expense entered as a positive number that then increases
 * a balance. No call site anywhere passes a signed amount in.
 *
 * Pure: data in, values out. The database enforces the same invariants through
 * `check_transaction_shape()`; this copy exists so a user sees a field-level
 * error instead of a constraint violation, and so the rules are unit-testable
 * without a database.
 */

import {
  add,
  isZero,
  mulRate,
  neg,
  toDbString,
  type CurrencyCode,
  type Money,
} from '../../../lib/decimal/money';
import { isNegative, isPositive } from '../../../lib/decimal/money';
import type { Rate } from '../../../lib/decimal/rate';
import { err, ok, validationFailed, invariantViolation, type DomainError, type Result } from '../../../lib/result';

export type TransactionKind = 'income' | 'expense' | 'transfer';
export type CategoryKind = 'income' | 'expense';

/**
 * One leg as the user described it: which account, how much (a positive
 * magnitude), and the rate that converts it to base currency.
 */
export interface LegInput {
  readonly accountId: string;
  /** A positive magnitude. A signed amount here is a programming error, and is rejected. */
  readonly amount: Money;
  readonly fxRateToBase: Rate;
}

/** A row destined for `transaction_entries`. Signed, and with its base amount derived. */
export interface EntryDraft {
  readonly accountId: string;
  readonly amount: Money;
  readonly currency: CurrencyCode;
  readonly fxRateToBase: Rate;
  readonly baseAmount: Money;
  readonly sortOrder: number;
}

export type BuildEntriesInput =
  | { readonly kind: 'income'; readonly leg: LegInput }
  | { readonly kind: 'expense'; readonly leg: LegInput }
  | { readonly kind: 'transfer'; readonly from: LegInput; readonly to: LegInput };

/**
 * `base_amount = round(amount × fx_rate_to_base, 4)` — the same expression the
 * database `CHECK` evaluates (invariant I-11).
 *
 * `half_up` is not a preference here: Postgres `round(numeric, 4)` rounds halves
 * away from zero, and `mulRate(…, 'half_up')` does the same. Any other mode
 * would produce a value the `CHECK` rejects, which is why the mode is named at
 * this one call site and nowhere else.
 */
function toBase(amount: Money, rate: Rate, base: CurrencyCode): Money {
  const converted = mulRate(amount, rate, 'half_up');
  return { minor: converted.minor, currency: base };
}

function checkLeg(leg: LegInput, field: string): DomainError | null {
  if (isZero(leg.amount)) {
    return validationFailed({ [field]: ['Enter an amount greater than zero.'] });
  }
  if (isNegative(leg.amount)) {
    // The sign is the engine's to decide. A negative magnitude reaching here
    // means a caller tried to encode direction in the number.
    return validationFailed({
      [field]: ['Enter a positive amount — whether it adds to or leaves the account comes from the type.'],
    });
  }
  if (leg.fxRateToBase.value <= 0n) {
    return invariantViolation('I-11', 'An exchange rate must be greater than zero.');
  }
  return null;
}

/**
 * Build the entries for a transaction. The signs are derived from `kind`:
 *
 * | kind     | entries | signs                      |
 * |----------|---------|----------------------------|
 * | income   | 1       | `+amount`                  |
 * | expense  | 1       | `-amount`                  |
 * | transfer | 2       | `-from`, `+to`             |
 */
export function buildEntries(
  input: BuildEntriesInput,
  base: CurrencyCode,
): Result<EntryDraft[], DomainError> {
  const draft = (leg: LegInput, amount: Money, sortOrder: number): Result<EntryDraft, DomainError> => {
    const baseAmount = toBase(amount, leg.fxRateToBase, base);
    if (isZero(baseAmount)) {
      // The database `CHECK (base_amount <> 0)` would reject this. Catching it
      // here names the cause: the amount is too small to register in base
      // currency at this rate, so storing it would silently lose the movement.
      return err(
        invariantViolation(
          'I-11',
          `${toDbString(amount)} ${amount.currency} converts to zero in ${base} at this rate. ` +
            'The movement would be invisible in every total.',
        ),
      );
    }
    return ok({
      accountId: leg.accountId,
      amount,
      currency: amount.currency,
      fxRateToBase: leg.fxRateToBase,
      baseAmount,
      sortOrder,
    });
  };

  if (input.kind === 'income' || input.kind === 'expense') {
    const problem = checkLeg(input.leg, 'amount');
    if (problem) return err(problem);

    const signed = input.kind === 'income' ? input.leg.amount : neg(input.leg.amount);
    const entry = draft(input.leg, signed, 0);
    return entry.ok ? ok([entry.value]) : entry;
  }

  const fromProblem = checkLeg(input.from, 'fromAmount');
  if (fromProblem) return err(fromProblem);
  const toProblem = checkLeg(input.to, 'toAmount');
  if (toProblem) return err(toProblem);

  if (input.from.accountId === input.to.accountId) {
    return err(
      validationFailed({
        toAccountId: ['A transfer must move money between two different accounts.'],
      }),
    );
  }

  const fromEntry = draft(input.from, neg(input.from.amount), 0);
  if (!fromEntry.ok) return fromEntry;
  const toEntry = draft(input.to, input.to.amount, 1);
  if (!toEntry.ok) return toEntry;

  return ok([fromEntry.value, toEntry.value]);
}

export interface EntryInvariantInput {
  readonly kind: TransactionKind;
  readonly categoryId: string | null;
  /** The kind of the referenced category, or `null` when there is none. */
  readonly categoryKind: CategoryKind | null;
  readonly entries: readonly EntryDraft[];
}

/**
 * Assert I-1, I-2 and I-3 over a complete transaction.
 *
 * Returns a `Result` rather than throwing, despite the name kept from
 * FINANCIAL-DOMAIN.md §4: an invalid shape reaching here is usually bad input,
 * and the service needs a field-level error to show rather than a stack trace.
 * A genuinely impossible shape is still an `invariant_violation`.
 */
export function assertEntryInvariants(input: EntryInvariantInput): Result<void, DomainError> {
  const { kind, categoryId, categoryKind, entries } = input;

  if (kind === 'transfer') {
    if (categoryId !== null) {
      // I-2. Structural, and the reason transfers can never leak into category
      // reporting: there is no category on the row to leak.
      return err(validationFailed({ categoryId: ['A transfer is not income or spending, so it carries no category.'] }));
    }

    if (entries.length !== 2) {
      return err(invariantViolation('I-1', `A transfer must have exactly two entries, got ${entries.length}.`));
    }

    const [first, second] = entries as [EntryDraft, EntryDraft];
    const positives = entries.filter(isPositiveEntry).length;
    const negatives = entries.filter((e) => isNegative(e.amount)).length;

    if (positives !== 1 || negatives !== 1) {
      return err(invariantViolation('I-1', 'A transfer must have one entry leaving and one entry arriving.'));
    }
    if (first.accountId === second.accountId) {
      return err(validationFailed({ toAccountId: ['A transfer must move money between two different accounts.'] }));
    }

    // I-3. Same currency on both legs means the base amounts must cancel
    // exactly. Different currencies leave a residual — the realised FX
    // difference — which is reported rather than absorbed.
    if (first.currency === second.currency) {
      const residual = add(first.baseAmount, second.baseAmount);
      if (!isZero(residual)) {
        return err(
          invariantViolation(
            'I-3',
            `A same-currency transfer must net to zero in base currency; this one leaves ${toDbString(residual)}.`,
          ),
        );
      }
    }

    return ok(undefined);
  }

  if (entries.length !== 1) {
    return err(invariantViolation('I-1', `An ${kind} transaction must have exactly one entry, got ${entries.length}.`));
  }

  const entry = entries[0]!;
  if (kind === 'income' && !isPositive(entry.amount)) {
    // Edge case 20: a salary clawback is not negative income. It is an expense
    // or a correcting entry, and calling it income would understate both totals.
    return err(
      validationFailed({
        amount: ['Income must increase an account. Record a clawback or refund as an expense instead.'],
      }),
    );
  }
  if (kind === 'expense' && !isNegative(entry.amount)) {
    return err(
      validationFailed({ amount: ['An expense must reduce an account. Record a refund as income instead.'] }),
    );
  }

  if (categoryId === null) {
    return err(validationFailed({ categoryId: [`Choose a category — every ${kind} has one.`] }));
  }
  if (categoryKind !== null && categoryKind !== kind) {
    // Edge case 5: an expense against an income category.
    return err(
      validationFailed({
        categoryId: [`That is an ${categoryKind} category and this is an ${kind}.`],
      }),
    );
  }

  return ok(undefined);
}

function isPositiveEntry(e: EntryDraft): boolean {
  return isPositive(e.amount);
}
