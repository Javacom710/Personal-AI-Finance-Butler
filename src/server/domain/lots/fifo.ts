/**
 * The FIFO matching strategy — ADR-07's one seam.
 *
 * The **disposal-matching strategy is the only thing that varies** between
 * cost-basis methods. Lot opening, fee capitalisation, corporate actions, income
 * accrual, position totals and the `Σ remaining_cost = cost_basis` invariant are
 * all method-independent, which is why adding `average` or `specific_id` later
 * is a new `select()` plus its own test table rather than a second engine
 * ([INVESTMENT-DOMAIN.md §4](../../../../docs/INVESTMENT-DOMAIN.md#why-the-method-is-pluggable-but-only-one-is-implemented)).
 *
 * `select()` performs **no money arithmetic at all**. It decides *which* lots
 * and *how many units* from each; the cost consumed by each slice is computed by
 * the engine, which is what keeps the exactness guarantee in one place.
 */

import { qCmp, qIsZero, qSub, Quantity, type Quantity as Qty } from '../../../lib/decimal/quantity';

export type CostBasisMethod = 'fifo' | 'average' | 'specific_id';

/** The engine's view of a lot while replaying. Only what a strategy may read. */
export interface SelectableLot {
  readonly key: number;
  readonly remainingQuantity: Qty;
}

export interface LotSlice {
  readonly lotKey: number;
  /** Units taken from that lot. Always positive. */
  readonly take: Qty;
}

export interface Oversell {
  readonly shortBy: Qty;
}

export interface MatchingStrategy {
  readonly method: CostBasisMethod;
  /**
   * `open` is ordered oldest-first and is the engine's **working** array — a
   * fully consumed lot has already been removed from it, though the lot row
   * itself survives.
   */
  select(open: readonly SelectableLot[], required: Qty): LotSlice[] | Oversell;
}

export function isOversell(result: LotSlice[] | Oversell): result is Oversell {
  return !Array.isArray(result);
}

/**
 * Oldest lot first, taking as much as each holds until the requirement is met.
 *
 * Matches Indian tax treatment for listed equity and mutual funds, and is the
 * most informative choice besides: average cost is derivable from FIFO lots
 * (`cost_basis / quantity`), while the reverse is not true.
 */
export const fifo: MatchingStrategy = {
  method: 'fifo',

  select(open, required) {
    const slices: LotSlice[] = [];
    let remaining = required;
    let index = 0;

    while (!qIsZero(remaining)) {
      const lot = open[index];
      if (lot === undefined) {
        // Selling more units than are held is a **data error, not a short
        // position**: a missing purchase, bonus or split. Shorting is out of
        // scope at launch; when it arrives it becomes a distinct `short_sell`
        // kind rather than a negative position.
        return { shortBy: remaining };
      }

      const take = qCmp(lot.remainingQuantity, remaining) <= 0 ? lot.remainingQuantity : remaining;
      slices.push({ lotKey: lot.key, take });
      remaining = qSub(remaining, take);
      index += 1;
    }

    return slices;
  },
};

/**
 * Resolve a stored method to its strategy.
 *
 * `average` and `specific_id` are interface-only at launch and are rejected here
 * rather than silently falling back to FIFO — a portfolio quietly valued by the
 * wrong method is worse than one that refuses to value at all.
 */
export function strategyFor(method: CostBasisMethod): MatchingStrategy {
  if (method === 'fifo') return fifo;
  throw new Error(
    `Cost-basis method "${method}" is declared in the schema but not implemented. ` +
      'Only "fifo" has a matching strategy; see INVESTMENT-DOMAIN.md §4.',
  );
}

export { Quantity };
