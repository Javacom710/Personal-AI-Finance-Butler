/**
 * Balance derivation (FINANCIAL-DOMAIN.md §3).
 *
 * > **Ledger transactions are source. Balances are derived.**
 * > Always computed, never stored, never edited.
 *
 * There is no `accounts.current_balance` column and there never will be. A
 * stored balance is a second source of truth that diverges from the ledger the
 * first time a write is retried, a transaction is edited, or two paths update it
 * in a different order. Every reconciliation bug in this class of software
 * traces back to a cached balance somebody trusted.
 *
 * This is the **single implementation** (FINANCIAL-DOMAIN.md §10.5). The UI, the
 * AI tools, the export and `verify:integrity` all call it, which is why they
 * cannot disagree.
 */

import { abs, add, isNegative, sum, type Money } from '../../../lib/decimal/money';

export type AccountKind = 'bank' | 'cash' | 'credit_card' | 'wallet' | 'brokerage' | 'loan' | 'other';

/**
 * `balance(account, asOf) = opening_balance
 *                         + Σ transaction_entries.amount     (booked_on   <= asOf)
 *                         + Σ investment_transactions.net    (trade_date  <= asOf)`
 *
 * Both sums are in the **account's** currency; conversion to base currency
 * happens in the application service above this.
 *
 * `investmentNetAmounts` is empty until Phase 4 builds the investment ledger.
 * The parameter exists now because the definition includes it: a balance that
 * omitted investment cash movements would be wrong the day that table appears,
 * and the omission would be invisible here rather than at the call site.
 */
export function deriveBalance(
  openingBalance: Money,
  entryAmounts: readonly Money[],
  investmentNetAmounts: readonly Money[] = [],
): Money {
  const currency = openingBalance.currency;
  return add(
    add(openingBalance, sum(entryAmounts, currency)),
    sum(investmentNetAmounts, currency),
  );
}

export interface RunningBalanceRow<T> {
  readonly row: T;
  readonly amount: Money;
  readonly balance: Money;
}

/**
 * A ledger view: each movement with the balance after it.
 *
 * `movements` must already be in ascending ledger order — the same total order
 * the repository applies (`booked_on, created_at, id`). Ordering is the caller's
 * responsibility because only the caller knows the sort; getting it wrong here
 * would silently produce a plausible but wrong running column.
 */
export function withRunningBalance<T>(
  openingBalance: Money,
  movements: readonly { readonly row: T; readonly amount: Money }[],
): RunningBalanceRow<T>[] {
  const out: RunningBalanceRow<T>[] = [];
  let balance = openingBalance;
  for (const movement of movements) {
    balance = add(balance, movement.amount);
    out.push({ row: movement.row, amount: movement.amount, balance });
  }
  return out;
}

export type AccountRole = 'asset' | 'liability';

/**
 * How an account contributes to net worth (FINANCIAL-DOMAIN.md §3).
 *
 * | Kind                              | Normal sign | Net worth               |
 * |-----------------------------------|-------------|-------------------------|
 * | bank, cash, wallet, brokerage     | positive    | asset at balance        |
 * | credit_card, loan                 | negative    | liability at abs(bal)   |
 * | other                             | either      | asset if ≥ 0 else liab. |
 *
 * Phase 5 consumes this; it lives here because the classification is a property
 * of the money domain, not of the net-worth calculator.
 */
export function accountRole(kind: AccountKind, balance: Money): AccountRole {
  if (kind === 'credit_card' || kind === 'loan') return 'liability';
  if (kind === 'other') return isNegative(balance) ? 'liability' : 'asset';
  return 'asset';
}

/** The magnitude an account contributes, whichever side of the sheet it lands on. */
export function contributionMagnitude(balance: Money): Money {
  return abs(balance);
}

/**
 * Credit available on a card: `credit_limit − abs(balance)` when the balance is
 * negative, the full limit when it is not.
 *
 * It is **not** an asset and is excluded from every total — it is shown on the
 * account row so the number is visible without being counted.
 */
export function availableCredit(creditLimit: Money, balance: Money): Money {
  return isNegative(balance) ? add(creditLimit, balance) : creditLimit;
}
