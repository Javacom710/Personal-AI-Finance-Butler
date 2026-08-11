/**
 * The cost-basis engine — `replay()`
 * ([INVESTMENT-DOMAIN.md §4](../../../../docs/INVESTMENT-DOMAIN.md#4-cost-basis-engine-default-fifo)).
 *
 * Pure: no database, no clock, no I/O. It takes an array of investment
 * transactions for **one `(account, instrument)` pair** and returns the derived
 * lots, disposals and position totals. That is what makes every edge case a
 * table-driven unit test, and what makes `positions` a rebuildable cache rather
 * than a record (ADR-06).
 *
 * Two properties are guaranteed by construction rather than checked afterwards,
 * and both exist because the residue they prevent would land in **realised P&L,
 * a tax figure**:
 *
 * - `Σ proceeds = netProceeds` **exactly** — proceeds are `allocate`d across the
 *   slices, never divided-then-multiplied (FINANCIAL-DOMAIN.md §10.2).
 * - `Σ cost_consumed + remaining_cost = cost_total` **exactly**, over a lot's
 *   whole life — because the slice that drains a lot takes `remaining_cost`
 *   verbatim rather than recomputing it (invariant I-20).
 *
 * Therefore `realized_pnl = proceeds − cost_consumed` is enforceable as a
 * database `CHECK` (I-15) rather than trusted, and I-6 is an exact equality with
 * no tolerance.
 *
 * ## One correction to INVESTMENT-DOMAIN.md §4's pseudocode: `floor`, not `half_up`
 *
 * The pseudocode rounds a partial lot's consumed cost `half_up`. Its own prose,
 * two paragraphs later, says the opposite: *"the remainder stays in
 * `remaining_cost` … the residue is **retained**, not discarded."* Only `floor`
 * does that, and the difference is not cosmetic — it decides whether invariant
 * **I-19** holds, and I-19 is a database `CHECK`:
 *
 * ```
 * lot: remaining_cost = ₹0.0001 (1 minor unit) over 10 units; sell 6 of them
 *   half_up → consumed 1, retained 0 over 4 units  →  I-19 VIOLATED, INSERT rejected
 *   floor   → consumed 0, retained 1 over 4 units  →  I-19 holds
 * ```
 *
 * `floor` makes it unreachable rather than merely unlikely: for a slice that
 * does not drain its lot, `take < remainingQty`, so
 * `floor(cost × take / qty) < cost` strictly — the lot can never be left with
 * units and no basis. `half_up` has no such guarantee, and the failure surfaces
 * as an opaque constraint error on a legitimate trade.
 *
 * Nothing documented changes: every worked figure in `INVESTMENT-DOMAIN.md` §6.3
 * and every golden scenario divides exactly, where `floor` and `half_up` agree.
 * `Σ cost_consumed + remaining_cost = cost_total` still holds exactly (I-20),
 * because the slice that drains a lot takes `remaining_cost` verbatim.
 */

import { daysBetween, maxDate, minDate, type IsoDate } from '../../../lib/date';
import {
  Money,
  add,
  allocate,
  mulRate,
  sub,
  sum,
  type CurrencyCode,
} from '../../../lib/decimal/money';
import { Rate } from '../../../lib/decimal/rate';
import {
  Quantity,
  qAbs,
  qAdd,
  qIsZero,
  qScale,
  qSub,
  qSum,
  type Quantity as Qty,
} from '../../../lib/decimal/quantity';
import { mulQtyRatio } from '../../../lib/decimal/price';
import { err, ok, type Result } from '../../../lib/result';
import { isOversell, strategyFor, type CostBasisMethod } from './fifo';
import { isAcquire, isCorporateAction, isDispose, isIncome, sortByReplayOrder, type InvestmentKind } from './order';

// ------------------------------------------------------------------- inputs

/**
 * One ledger row, as the engine needs it.
 *
 * Every monetary field is in the **instrument's** currency — the engine never
 * sees `net_amount` (the account's currency) or `base_net_amount`, because
 * mixing those into a `positions` total would put two currencies in one column
 * with nothing able to detect it
 * ([INVESTMENT-DOMAIN.md §2.1](../../../../docs/INVESTMENT-DOMAIN.md#21-two-currencies-per-transaction-and-which-one-net_amount-is-in)).
 */
export interface ReplayTxn {
  readonly id: string;
  readonly kind: InvestmentKind;
  readonly tradeDate: IsoDate;
  readonly createdAt: Date;

  /** Signed as stored: positive acquires, negative disposes, null otherwise. */
  readonly quantity: Qty | null;
  /** `|quantity| × price`, instrument currency. Null on corporate actions. */
  readonly grossAmount: Money | null;
  readonly fees: Money;
  readonly taxes: Money;
  /** Instrument currency. Only `fee` and `tax` rows accrue from it. */
  readonly netAmountInstrument: Money;

  readonly ratioNum: number | null;
  readonly ratioDen: number | null;

  /** Carried by a `transfer_in`; null on every other kind. */
  readonly originalAcquiredOn: IsoDate | null;

  /**
   * The **instrument → base** rate, dated by the row's role:
   *
   * - an acquire is dated by the lot's `acquired_on` (for a `transfer_in`, the
   *   *carried* date), so the destination lot's base-currency basis equals the
   *   source lot's and a transfer manufactures no currency gain;
   * - a disposal is dated by `trade_date`, which is what lets realised P&L split
   *   into a price and a currency component (§6.4).
   *
   * Distinct from `investment_transactions.fx_rate_to_base`, which converts the
   * **account's** currency. Both are resolved by the service; the engine holds
   * no FX table.
   */
  readonly fxInstrumentToBase: Rate;
}

export interface ReplayOptions {
  readonly method: CostBasisMethod;
  /** The instrument's currency. Every figure below is denominated in it. */
  readonly currency: CurrencyCode;
  readonly baseCurrency: CurrencyCode;
}

// ------------------------------------------------------------------ outputs

export interface ReplayLot {
  /** Stable within one replay. Links a disposal to its lot before either has an id. */
  readonly key: number;
  readonly openedByTxnId: string;
  readonly openedOn: IsoDate;
  /** The **original** acquisition, carried across a transfer. */
  readonly acquiredOn: IsoDate;
  readonly originalQuantity: Qty;
  readonly remainingQuantity: Qty;
  readonly costTotal: Money;
  readonly remainingCost: Money;
  /** The rate on `acquiredOn`. Never revalued. */
  readonly fxRateToBase: Rate;
}

export interface ReplayDisposal {
  readonly lotKey: number;
  readonly closedByTxnId: string;
  readonly closedOn: IsoDate;
  readonly quantity: Qty;
  readonly proceeds: Money;
  readonly costConsumed: Money;
  readonly realizedPnl: Money;
  readonly fxRateToBase: Rate;
  readonly baseRealizedPnl: Money;
  readonly baseFxComponent: Money;
  /** From the lot's `acquiredOn`, never from `openedOn`. */
  readonly holdingDays: number;
}

export interface PositionTotals {
  readonly quantity: Qty;
  /** `Σ remaining_cost`, instrument currency (I-6). */
  readonly costBasis: Money;
  /** `Σ (remaining_cost × lot.fxRateToBase)`, summed **per lot** (I-17). */
  readonly baseCostBasis: Money;
  readonly realizedPnl: Money;
  /** GROSS declared dividends and interest (I-12). */
  readonly incomeTotal: Money;
  readonly feesTotal: Money;
  readonly taxesTotal: Money;
  readonly firstTradeOn: IsoDate | null;
  readonly lastTradeOn: IsoDate | null;
}

export interface ReplayResult {
  readonly lots: readonly ReplayLot[];
  readonly disposals: readonly ReplayDisposal[];
  readonly totals: PositionTotals;
}

export type ReplayError =
  | {
      readonly kind: 'oversell';
      readonly txnId: string;
      readonly tradeDate: IsoDate;
      readonly shortBy: Qty;
      readonly held: Qty;
    }
  | {
      /**
       * A `split` or `bonus` whose ratio would round a still-held quantity down
       * to zero at `QTY_SCALE`, leaving basis with no units to sit on.
       *
       * Reachable only below 5×10⁻⁹ units — but the alternative is a row that
       * violates I-19 and is rejected by the database *after* the ledger row was
       * accepted, which would surface as an opaque constraint error rather than
       * as "this action extinguishes a holding; record the residue as a sale".
       */
      readonly kind: 'lot_extinguished_by_corporate_action';
      readonly txnId: string;
      readonly tradeDate: IsoDate;
      readonly lotOpenedOn: IsoDate;
    };

// ------------------------------------------------------------------- engine

interface WorkingLot {
  readonly key: number;
  readonly openedByTxnId: string;
  readonly openedOn: IsoDate;
  readonly acquiredOn: IsoDate;
  originalQuantity: Qty;
  remainingQuantity: Qty;
  readonly costTotal: Money;
  remainingCost: Money;
  readonly fxRateToBase: Rate;
}

/**
 * Replay one position's whole history.
 *
 * There is no incremental-patch path, by design: incremental patching is where
 * derived state drifts ([ARCHITECTURE.md §6](../../../../docs/ARCHITECTURE.md#6-cache-invalidation)).
 * A mutation anywhere in a position's history re-replays that position entirely.
 */
export function replay(
  transactions: readonly ReplayTxn[],
  options: ReplayOptions,
): Result<ReplayResult, ReplayError> {
  const { currency, baseCurrency } = options;
  const strategy = strategyFor(options.method);
  const zero = Money.zero(currency);

  const ordered = sortByReplayOrder(transactions);

  const lots: WorkingLot[] = [];
  /** References into `lots`, oldest-first. A drained lot leaves this array; its row survives. */
  const open: WorkingLot[] = [];
  const disposals: ReplayDisposal[] = [];

  let incomeTotal = zero;
  let feesTotal = zero;
  let taxesTotal = zero;
  let realizedPnl = zero;
  let firstTradeOn: IsoDate | null = null;
  let lastTradeOn: IsoDate | null = null;

  for (const txn of ordered) {
    firstTradeOn = firstTradeOn === null ? txn.tradeDate : minDate(firstTradeOn, txn.tradeDate);
    lastTradeOn = lastTradeOn === null ? txn.tradeDate : maxDate(lastTradeOn, txn.tradeDate);

    if (isAcquire(txn.kind)) {
      const quantity = requireQuantity(txn);
      const gross = requireGross(txn);
      // Fees and taxes on a purchase are CAPITALISED into the lot and must
      // never also reach fees_total / taxes_total — totalReturn subtracts those,
      // and the amount is already inside the cost basis.
      const costTotal = add(add(gross, txn.fees), txn.taxes);
      if (costTotal.minor <= 0n) {
        // I-19 forbids a lot with units and no basis. `inv_txn_acquisition_has_cost`
        // makes this unreachable from the database; reaching it means a fixture
        // or a bypassed service, which is a bug and should be loud.
        throw new Error(
          `replay: ${txn.kind} ${txn.id} opens a lot with no cost. ` +
            'A CHECK constraint makes this unreachable from the database.',
        );
      }
      const acquiredOn = txn.originalAcquiredOn ?? txn.tradeDate;

      const lot: WorkingLot = {
        key: lots.length,
        openedByTxnId: txn.id,
        openedOn: txn.tradeDate,
        acquiredOn,
        originalQuantity: qAbs(quantity),
        remainingQuantity: qAbs(quantity),
        costTotal,
        remainingCost: costTotal,
        fxRateToBase: txn.fxInstrumentToBase,
      };
      lots.push(lot);
      open.push(lot);
      continue;
    }

    if (isDispose(txn.kind)) {
      const required = qAbs(requireQuantity(txn));
      const selected = strategy.select(open, required);

      if (isOversell(selected)) {
        return err({
          kind: 'oversell',
          txnId: txn.id,
          tradeDate: txn.tradeDate,
          shortBy: selected.shortBy,
          held: qSum(open.map((lot) => lot.remainingQuantity)),
        });
      }

      const isTransfer = txn.kind === 'transfer_out';

      // Cost is consumed first, because a transfer_out DEFINES its proceeds as
      // the cost consumed. Its realised P&L is therefore zero by construction,
      // not by a subtraction that happens to cancel — moving your own shares
      // between your own accounts cannot manufacture a taxable gain.
      const consumed: { lot: WorkingLot; take: Qty; costConsumed: Money }[] = [];
      for (const slice of selected) {
        const lot = lots[slice.lotKey]!;
        const drainsLot = lot.remainingQuantity.units === slice.take.units;
        const costConsumed = drainsLot
          ? lot.remainingCost // verbatim: drains the lot exactly, no residue
          : mulQtyRatio(lot.remainingCost, slice.take, lot.remainingQuantity, 'floor');

        lot.remainingCost = sub(lot.remainingCost, costConsumed);
        lot.remainingQuantity = qSub(lot.remainingQuantity, slice.take);
        consumed.push({ lot, take: slice.take, costConsumed });

        if (qIsZero(lot.remainingQuantity)) {
          const at = open.indexOf(lot);
          if (at >= 0) open.splice(at, 1);
        }
      }

      const proceeds = isTransfer
        ? consumed.map((c) => c.costConsumed)
        : allocate(
            sub(sub(requireGross(txn), txn.fees), txn.taxes),
            consumed.map((c) => c.take.units),
          );

      for (let i = 0; i < consumed.length; i += 1) {
        const { lot, take, costConsumed } = consumed[i]!;
        const slotProceeds = proceeds[i]!;
        const realized = sub(slotProceeds, costConsumed);

        // A transfer is valued at the LOT's own acquisition rate, so its base
        // P&L and FX component are both exactly zero. Using the transfer date's
        // rate would turn a move between two of the user's own accounts into a
        // base-currency currency gain — the same defect in a different currency.
        const disposalRate = isTransfer ? lot.fxRateToBase : txn.fxInstrumentToBase;
        const baseProceeds = mulRate(withCurrency(slotProceeds, baseCurrency), disposalRate, 'half_up');
        const baseCost = mulRate(withCurrency(costConsumed, baseCurrency), lot.fxRateToBase, 'half_up');
        const baseRealizedPnl = sub(baseProceeds, baseCost);

        // fx = cost_consumed × (fd − fl); the price component is DERIVED as the
        // difference, so the two can never fail to sum to the total (I-18).
        const baseFxComponent = mulRate(
          withCurrency(costConsumed, baseCurrency),
          Rate.fromValue(disposalRate.value - lot.fxRateToBase.value),
          'half_up',
        );

        realizedPnl = add(realizedPnl, realized);
        disposals.push({
          lotKey: lot.key,
          closedByTxnId: txn.id,
          closedOn: txn.tradeDate,
          quantity: take,
          proceeds: slotProceeds,
          costConsumed,
          realizedPnl: realized,
          fxRateToBase: disposalRate,
          baseRealizedPnl,
          baseFxComponent,
          holdingDays: holdingDays(lot.acquiredOn, txn.tradeDate),
        });
      }
      continue;
    }

    if (isIncome(txn.kind)) {
      // GROSS, never net (I-12). Accruing income net of tax *and* recording the
      // tax subtracts it twice; accruing net and not recording it reports a ₹500
      // dividend as ₹450, which makes the ledger useless for tax purposes.
      // No lot is touched, ever: a dividend is a return *on* the investment,
      // not a refund *of* it.
      incomeTotal = add(incomeTotal, requireGross(txn));
      feesTotal = add(feesTotal, txn.fees);
      taxesTotal = add(taxesTotal, txn.taxes);
      continue;
    }

    if (txn.kind === 'fee' || txn.kind === 'tax') {
      // Instrument currency, like every other positions total — NOT |net_amount|,
      // which is the account's currency.
      const magnitude = absMoney(txn.netAmountInstrument);
      if (txn.kind === 'fee') feesTotal = add(feesTotal, magnitude);
      else taxesTotal = add(taxesTotal, magnitude);
      continue;
    }

    if (isCorporateAction(txn.kind)) {
      const num = BigInt(requireRatio(txn, 'ratioNum'));
      const den = BigInt(requireRatio(txn, 'ratioDen'));

      for (const lot of open) {
        if (txn.kind === 'split') {
          const nextOriginal = qScale(lot.originalQuantity, num, den, 'half_up');
          const nextRemaining = qScale(lot.remainingQuantity, num, den, 'half_up');
          if (qIsZero(nextRemaining)) {
            return err({
              kind: 'lot_extinguished_by_corporate_action',
              txnId: txn.id,
              tradeDate: txn.tradeDate,
              lotOpenedOn: lot.openedOn,
            });
          }
          lot.originalQuantity = nextOriginal;
          lot.remainingQuantity = nextRemaining;
        } else {
          const bonusQty = qScale(lot.remainingQuantity, num, den, 'half_up');
          lot.remainingQuantity = qAdd(lot.remainingQuantity, bonusQty);
          // Keeps remaining <= original, which is a CHECK on the table.
          lot.originalQuantity = qAdd(lot.originalQuantity, bonusQty);
        }
        // costTotal and remainingCost are UNTOUCHED by both. No money
        // arithmetic occurs at all, which is why `Σ cost_total` is byte-identical
        // before and after — the basis is simply spread over more (or fewer)
        // units, and the DERIVED per-unit cost changes as a consequence.
      }
      continue;
    }

    throw new Error(`replay: unhandled investment kind "${txn.kind satisfies never}"`);
  }

  const quantity = qSum(open.map((lot) => lot.remainingQuantity));
  const costBasis = sum(
    open.map((lot) => lot.remainingCost),
    currency,
  );
  const baseCostBasis = sum(
    // Per lot, because lots acquired at different times carry different rates.
    // NOT `cost_basis × today's rate` (I-17).
    open.map((lot) => mulRate(withCurrency(lot.remainingCost, baseCurrency), lot.fxRateToBase, 'half_up')),
    baseCurrency,
  );

  return ok({
    // Every lot ever opened is emitted, including fully disposed ones. Dropping
    // the closed ones would shrink `costDeployed`'s denominator, orphan
    // `lot_disposals.lot_id`, and lose realised-P&L history on a position sold
    // down to zero (INVESTMENT-DOMAIN.md §4).
    lots: lots.map(freezeLot),
    disposals,
    totals: {
      quantity,
      costBasis,
      baseCostBasis,
      realizedPnl,
      incomeTotal,
      feesTotal,
      taxesTotal,
      firstTradeOn,
      lastTradeOn,
    },
  });
}

// ------------------------------------------------------------------ helpers

function freezeLot(lot: WorkingLot): ReplayLot {
  return Object.freeze({
    key: lot.key,
    openedByTxnId: lot.openedByTxnId,
    openedOn: lot.openedOn,
    acquiredOn: lot.acquiredOn,
    originalQuantity: lot.originalQuantity,
    remainingQuantity: lot.remainingQuantity,
    costTotal: lot.costTotal,
    remainingCost: lot.remainingCost,
    fxRateToBase: lot.fxRateToBase,
  });
}

/** Reinterpret an exact amount in another currency, for a conversion about to happen. */
function withCurrency(m: Money, c: CurrencyCode): Money {
  return Money.fromMinor(m.minor, c);
}

function absMoney(m: Money): Money {
  return m.minor < 0n ? Money.fromMinor(-m.minor, m.currency) : m;
}

/**
 * The shape guarantees below are database `CHECK` constraints, so a row that
 * violates one cannot exist. Reaching these throws is a programming error —
 * a hand-built fixture or a bypassed service — and a bug should be loud.
 */
function requireQuantity(txn: ReplayTxn): Qty {
  if (txn.quantity === null || qIsZero(txn.quantity)) {
    throw new Error(
      `replay: ${txn.kind} ${txn.id} has no quantity. A CHECK constraint makes this unreachable from the database.`,
    );
  }
  return txn.quantity;
}

function requireGross(txn: ReplayTxn): Money {
  if (txn.grossAmount === null) {
    throw new Error(
      `replay: ${txn.kind} ${txn.id} has no gross_amount. A CHECK constraint makes this unreachable from the database.`,
    );
  }
  return txn.grossAmount;
}

function requireRatio(txn: ReplayTxn, field: 'ratioNum' | 'ratioDen'): number {
  const value = txn[field];
  if (value === null || !Number.isInteger(value) || value <= 0) {
    throw new Error(
      `replay: ${txn.kind} ${txn.id} has an invalid ${field}. A CHECK constraint makes this unreachable from the database.`,
    );
  }
  return value;
}

function holdingDays(acquiredOn: IsoDate, closedOn: IsoDate): number {
  const days = daysBetween(acquiredOn, closedOn);
  if (days < 0) {
    throw new Error(
      `replay: a lot acquired on ${acquiredOn} cannot be disposed of on ${closedOn}. ` +
        'The service rejects a transfer_in whose carried acquisition date is after its trade date.',
    );
  }
  return days;
}

export { Quantity };
