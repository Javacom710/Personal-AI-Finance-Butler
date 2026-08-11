/**
 * Replay ordering for the lot engine
 * ([INVESTMENT-DOMAIN.md §3](../../../../docs/INVESTMENT-DOMAIN.md#ordering)).
 *
 * The engine replays in `(trade_date, kind_rank, created_at, id)` — a **total**
 * order, so two transactions on the same date replay identically on every
 * rebuild, on every machine.
 *
 * `kind_rank` is the part that is easy to leave out and expensive to leave out.
 * Without it a split and a buy sharing a `trade_date` replay in whichever order
 * the **rows were entered**: a backdated purchase entered after the split is not
 * scaled by it, while the same purchase entered before it is. One ledger, two
 * different answers, decided by data-entry history. `created_at` is a total
 * order over *rows* but not over *economic events*
 * ([FINANCIAL-DOMAIN.md §10.1](../../../../docs/FINANCIAL-DOMAIN.md#101-purity-and-determinism)).
 *
 * It is **derived from `kind`, never stored** — sorting one position's
 * transactions in memory is free, and a stored rank is another column that can
 * drift from the enum it mirrors.
 */

import type { IsoDate } from '../../../lib/date';

export type InvestmentKind =
  | 'buy'
  | 'sell'
  | 'dividend'
  | 'interest'
  | 'fee'
  | 'tax'
  | 'bonus'
  | 'split'
  | 'mf_purchase'
  | 'mf_redemption'
  | 'transfer_in'
  | 'transfer_out';

export const ACQUIRE_KINDS = ['buy', 'mf_purchase', 'transfer_in'] as const;
export const DISPOSE_KINDS = ['sell', 'mf_redemption', 'transfer_out'] as const;
export const INCOME_KINDS = ['dividend', 'interest'] as const;
export const COST_KINDS = ['fee', 'tax'] as const;
export const CORPORATE_ACTION_KINDS = ['split', 'bonus'] as const;

export type AcquireKind = (typeof ACQUIRE_KINDS)[number];
export type DisposeKind = (typeof DISPOSE_KINDS)[number];
export type IncomeKind = (typeof INCOME_KINDS)[number];
export type CostKind = (typeof COST_KINDS)[number];
export type CorporateActionKind = (typeof CORPORATE_ACTION_KINDS)[number];

// Type predicates rather than plain booleans, so a `switch`-free engine still
// narrows and `satisfies never` catches a kind nobody handled. Adding a member
// to `investment_kind` then fails to compile rather than falling through.

export function isAcquire(kind: InvestmentKind): kind is AcquireKind {
  return kind === 'buy' || kind === 'mf_purchase' || kind === 'transfer_in';
}

export function isDispose(kind: InvestmentKind): kind is DisposeKind {
  return kind === 'sell' || kind === 'mf_redemption' || kind === 'transfer_out';
}

export function isIncome(kind: InvestmentKind): kind is IncomeKind {
  return kind === 'dividend' || kind === 'interest';
}

export function isCost(kind: InvestmentKind): kind is CostKind {
  return kind === 'fee' || kind === 'tax';
}

export function isCorporateAction(kind: InvestmentKind): kind is CorporateActionKind {
  return kind === 'split' || kind === 'bonus';
}

/**
 * Corporate actions replay **after** same-day trades.
 *
 * Rank 0 before rank 1 matches reality: the shares are held by the end of the
 * day, and the ratio then applies to that holding. `split` (1) before `bonus`
 * (2) because a bonus declared alongside a split applies to the split-adjusted
 * base.
 */
export function kindRank(kind: InvestmentKind): 0 | 1 | 2 {
  if (kind === 'split') return 1;
  if (kind === 'bonus') return 2;
  return 0;
}

export interface ReplayOrderable {
  readonly id: string;
  readonly kind: InvestmentKind;
  readonly tradeDate: IsoDate;
  readonly createdAt: Date;
}

/**
 * A total order over economic events.
 *
 * Returns a new array; the input is not mutated, because the caller's array is
 * usually the repository's result and a replay must not have a side effect on
 * it. ISO dates compare correctly as strings, which is why they are strings.
 */
export function sortByReplayOrder<T extends ReplayOrderable>(rows: readonly T[]): T[] {
  return [...rows].sort(compareReplayOrder);
}

export function compareReplayOrder(a: ReplayOrderable, b: ReplayOrderable): number {
  if (a.tradeDate !== b.tradeDate) return a.tradeDate < b.tradeDate ? -1 : 1;

  const rankA = kindRank(a.kind);
  const rankB = kindRank(b.kind);
  if (rankA !== rankB) return rankA - rankB;

  const timeA = a.createdAt.getTime();
  const timeB = b.createdAt.getTime();
  if (timeA !== timeB) return timeA - timeB;

  // The final tie-break. Two rows can share a millisecond — a batch insert
  // routinely does — and without this the sort would be unstable across engines
  // and the "same ledger, same bytes" property would not hold.
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
