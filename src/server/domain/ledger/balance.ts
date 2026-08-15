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

import { compareDates, type IsoDate } from '../../../lib/date';
import { abs, add, isNegative, isZero, Money, sum, type Money as MoneyValue } from '../../../lib/decimal/money';

export type AccountKind = 'bank' | 'cash' | 'credit_card' | 'wallet' | 'brokerage' | 'loan' | 'other';

/**
 * `balance(account, asOf) = (opening_date <= asOf ? opening_balance : 0)
 *                         + Σ transaction_entries.amount     (booked_on   <= asOf)
 *                         + Σ investment_transactions.net    (trade_date  <= asOf)`
 *
 * Both sums are in the **account's** currency; conversion to base currency
 * happens in the application service above this.
 *
 * The opening term is gated by `opening_date` — see `openingContribution()`.
 * The caller passes the already-gated figure, because only the caller knows the
 * dates.
 */
export function deriveBalance(
  openingBalance: MoneyValue,
  entryAmounts: readonly MoneyValue[],
  investmentNetAmounts: readonly MoneyValue[] = [],
): MoneyValue {
  const currency = openingBalance.currency;
  return add(
    add(openingBalance, sum(entryAmounts, currency)),
    sum(investmentNetAmounts, currency),
  );
}

/**
 * The opening balance an account contributes at `asOf`
 * ([ADR-26](../../../../docs/DECISIONS.md), FINANCIAL-DOMAIN.md §3).
 *
 * > An opening balance is valid only once the account exists.
 *
 * An account opened in 2026 with ₹50,000 opening must contribute **nothing** to
 * a balance — and therefore to a net worth — as of 2020. The date bound applied
 * to `transaction_entries` and `investment_transactions` covers the
 * **movements**, and an opening position is not a movement: without this gate
 * the ₹50,000 appears in every historical figure predating the account.
 *
 * `asOf === null` means "today, unbounded", which is what every present-tense
 * read passes. The gate is then a no-op unless `opening_date` is in the future.
 */
export function openingContribution(
  openingBalance: MoneyValue,
  openingDate: IsoDate,
  asOf: IsoDate | null,
): MoneyValue {
  if (asOf !== null && compareDates(openingDate, asOf) > 0) {
    return Money.zero(openingBalance.currency);
  }
  return openingBalance;
}

/**
 * Whether the account existed at `asOf` at all.
 *
 * An account that did not is **absent** from a net-worth breakdown rather than
 * present at zero, so it cannot be confused with one that genuinely held
 * nothing (FINANCIAL-DOMAIN.md §9.3).
 */
export function existedAt(openingDate: IsoDate, asOf: IsoDate | null): boolean {
  return asOf === null || compareDates(openingDate, asOf) <= 0;
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

export type AccountRole = 'asset' | 'liability' | 'none';

/**
 * How an account contributes to net worth — **by the economic sign of the
 * balance, never by `kind`** ([ADR-25](../../../../docs/DECISIONS.md),
 * FINANCIAL-DOMAIN.md §3).
 *
 * | `balance` | Contribution              |
 * |-----------|---------------------------|
 * | `> 0`     | asset at `balance`        |
 * | `< 0`     | liability at `abs(balance)`|
 * | `= 0`     | neither subtotal          |
 *
 * The rule this replaced classified by kind, and lost money in two directions
 * at once. A **credit card carrying an overpayment** — real money the issuer
 * owes back — was returned as a `liability` here while §9.3's asset term
 * excluded it by kind and its liability term excluded it by sign: the same row
 * was simultaneously a debt and invisible, a ₹10,000 spread on a ₹5,000
 * balance. An overdrawn `bank` account was symmetrically wrong as a negative
 * asset.
 *
 * `kind` still decides the display group and the **expected** sign — a `bank`
 * account in credit, or a `credit_card` in debit, is flagged on screen (see
 * `isAgainstExpectedSign`) — but never which side of the sheet the money lands
 * on. That is what makes the account block of net worth a plain sum of
 * balances, with nothing able to drop or duplicate a row via a kind test.
 */
export function accountRole(_kind: AccountKind, balance: MoneyValue): AccountRole {
  return sideOfAmount(balance);
}

/**
 * The rule itself, with no entity attached: which side of the balance sheet a
 * signed amount lands on.
 *
 * `accountRole` is this applied to an account balance, and the net-worth
 * calculator applies it to every other component — a manual asset's valuation,
 * a liability's negated outstanding, a position's cost basis. **One
 * implementation**, so an account's displayed role and its net-worth
 * contribution cannot disagree (FINANCIAL-DOMAIN.md §10.5).
 */
export function sideOfAmount(amount: MoneyValue): AccountRole {
  if (isZero(amount)) return 'none';
  return isNegative(amount) ? 'liability' : 'asset';
}

/** The magnitude an account contributes, whichever side of the sheet it lands on. */
export function contributionMagnitude(balance: MoneyValue): MoneyValue {
  return abs(balance);
}

/**
 * The sign an account of this kind normally carries. `null` where either sign
 * is ordinary.
 *
 * Display only: a row against its expected sign is **flagged**, never
 * reclassified (ADR-25).
 */
export function expectedSign(kind: AccountKind): 'positive' | 'negative' | null {
  if (kind === 'credit_card' || kind === 'loan') return 'negative';
  if (kind === 'other') return null;
  return 'positive';
}

/**
 * An overpaid credit card, or an overdrawn bank account: worth showing, never
 * worth reclassifying. A zero balance is against nothing.
 */
export function isAgainstExpectedSign(kind: AccountKind, balance: MoneyValue): boolean {
  const expected = expectedSign(kind);
  if (expected === null || isZero(balance)) return false;
  return expected === 'positive' ? isNegative(balance) : !isNegative(balance);
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
