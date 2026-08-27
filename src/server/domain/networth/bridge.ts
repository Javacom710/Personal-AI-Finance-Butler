/**
 * Change attribution — the bridge from `netWorth(t0)` to `netWorth(t1)`
 * ([FINANCIAL-DOMAIN.md §9.3](../../../../docs/FINANCIAL-DOMAIN.md#93-calculation)).
 *
 * Pure arithmetic over figures the service has already computed in base
 * currency.
 *
 * **The decomposition is derived from the composition, not invented alongside
 * it.** Each line covers exactly one way a term of `netWorth` can move, which is
 * what makes the identity close rather than approximately balance:
 *
 * ```
 * NW = Σ_a balance(a)         ← savings, investment cash flows, transfers
 *    + Σ_ℓ remainingCost(ℓ)   ← purchases (netting to zero against cash),
 *                               disposals, unmatched transfers
 *    + Σ_m valuation(m)       ← asset revaluation, additions and disposals
 *    − Σ_L outstanding(L)     ← scheduled liabilities only
 * ```
 *
 * Four consequences, each a place the obvious version double-counts:
 *
 * - **A buy needs no line.** It is `−cash + basis = 0` exactly. A "purchases"
 *   line would subtract money that never left.
 * - **A sell needs no line beyond realised P&L.** `+proceeds − cost_consumed` is
 *   the realised figure, which `Realised P&L` already carries.
 * - **`Liability change` covers SCHEDULED liabilities only.** A credit card and
 *   a transacted loan move through their linked account, so their change is
 *   already inside `Savings` and the investment lines. Counting them here as
 *   well would subtract a card purchase twice — once as spending and once as
 *   debt.
 * - **`Savings` cannot double-count investment income**, because it sums
 *   `transactions` and investment income lives in `investment_transactions`
 *   ([FINANCIAL-DOMAIN.md §8](../../../../docs/FINANCIAL-DOMAIN.md#8-cash-flow-calculations)).
 *
 * `FX effect` is **computed**, never defined as the residual. Defining it as the
 * plug would make `unexplained` trivially zero and destroy the only assertion in
 * the suite that catches most engine regressions.
 */

import { add, isZero, Money, neg, sub, sum, type CurrencyCode, type Money as MoneyValue } from '../../../lib/decimal/money';
import type { NetWorthResult, ValuationBasis } from './compose';

export type BridgeLineKey =
  | 'savings'
  | 'investment_income'
  | 'investment_costs'
  | 'realized_pnl'
  | 'unrealized_gain'
  | 'investment_transfers'
  | 'asset_revaluation'
  | 'asset_additions'
  | 'liability_change'
  | 'fx_effect';

/** Base-currency figures for the period, each already netted by the service. */
export interface BridgeFlows {
  /** `income − expenses` over the period, from `transaction_entries.base_amount`. */
  readonly savings: MoneyValue;
  /** GROSS declared dividends + interest (I-12). */
  readonly investmentIncome: MoneyValue;
  /** Fees + taxes paid, as a **positive magnitude**. Subtracted by this module. */
  readonly investmentCosts: MoneyValue;
  /** `Σ lot_disposals.base_realized_pnl` with `closed_on` in the period. */
  readonly realizedPnl: MoneyValue;
  /** Unmatched `transfer_in` (+) / `transfer_out` (−) basis, at the lot's own rate. */
  readonly investmentTransfers: MoneyValue;
  /** `Σ (valuationInForce(t1) − valuationInForce(t0))` over assets held throughout. */
  readonly assetRevaluation: MoneyValue;
  /** Acquisitions (+) and disposals (−) of manual assets within the period. */
  readonly assetAdditions: MoneyValue;
  /** `−(scheduled liabilities at t1 − at t0)`. Transacted liabilities are excluded. */
  readonly liabilityChange: MoneyValue;
  /** Revaluation of non-base holdings, computed — never a plug. */
  readonly fxEffect: MoneyValue;
  /**
   * The change in `(market − cost)` across the period — **`basis: 'market'`
   * only**, and `null` on a cost bridge, where it is zero *by construction*
   * rather than unmeasured.
   *
   * ```
   * unrealisedGain = ( NW(t1,'market') − NW(t1,'cost') )
   *                − ( NW(t0,'market') − NW(t0,'cost') )
   * ```
   *
   * Every non-investment component is identical on both bases, so this is
   * exactly the investment block's price and FX movement over the period — and
   * with it the market bridge closes for the same reason the cost bridge does
   * ([ADR-23](../../../../docs/DECISIONS.md#adr-23--net-worth-carries-a-declared-valuation-basis-phase-5-ships-net-worth-at-cost),
   * invariant **I-30**).
   *
   * It also absorbs a **change in coverage**: a holding priced at `t0` and
   * unpriced at `t1` leaves the market total, and that difference has to land
   * somewhere for the identity to hold. The line is therefore a movement in the
   * *valuation*, not a gain the user made, and the UI must not call it one.
   */
  readonly unrealizedGain: MoneyValue | null;
}

export interface BridgeLine {
  readonly key: BridgeLineKey;
  readonly amount: MoneyValue;
  /**
   * `true` when the line is structurally zero rather than measured — the
   * unrealised gain at `basis: 'cost'`. The UI must render it as *"not
   * measured"*, never as `₹0`, which would read as *"the portfolio did not
   * move"*.
   */
  readonly notMeasured: boolean;
}

export interface NetWorthBridge {
  readonly from: string;
  readonly to: string;
  readonly base: CurrencyCode;
  readonly basis: ValuationBasis;
  readonly opening: MoneyValue;
  readonly closing: MoneyValue;
  readonly delta: MoneyValue;
  readonly lines: readonly BridgeLine[];
  readonly explained: MoneyValue;
  /** `delta − explained`. Always computed, always reported. */
  readonly unexplained: MoneyValue;
  /** True when every component was denominated in the base currency. */
  readonly singleCurrency: boolean;
}

/**
 * @param opening net worth at `t0`
 * @param closing net worth at `t1`
 * @param flows   the period's movements, in base currency
 */
export function bridge(
  opening: NetWorthResult,
  closing: NetWorthResult,
  flows: BridgeFlows,
): NetWorthBridge {
  const base = closing.base;
  if (opening.base !== base) {
    throw new TypeError(
      `bridge: opening is in ${opening.base} and closing in ${base}. Both endpoints must ` +
        'share a base currency, and both must be on the same valuation basis.',
    );
  }
  if (opening.basis !== closing.basis) {
    throw new TypeError(
      `bridge: cannot bridge a '${opening.basis}' figure to a '${closing.basis}' one. ` +
        'A bridge explains movement, and a change of basis is not movement (ADR-23).',
    );
  }

  const lines: BridgeLine[] = [
    line('savings', flows.savings),
    line('investment_income', flows.investmentIncome),
    line('investment_costs', neg(flows.investmentCosts)),
    line('realized_pnl', flows.realizedPnl),
    // Zero BY CONSTRUCTION at cost basis: Δcost = purchases − consumed exactly,
    // so there is no price term to measure. Not skipped, not assumed — derived,
    // and rendered as "not measured" rather than as ₹0, which would read as "the
    // portfolio did not move". Under `market` it carries a real figure.
    {
      key: 'unrealized_gain',
      amount: flows.unrealizedGain ?? Money.zero(base),
      notMeasured: flows.unrealizedGain === null,
    },
    line('investment_transfers', flows.investmentTransfers),
    line('asset_revaluation', flows.assetRevaluation),
    line('asset_additions', flows.assetAdditions),
    line('liability_change', flows.liabilityChange),
    line('fx_effect', flows.fxEffect),
  ];

  const explained = sum(
    lines.map((l) => l.amount),
    base,
  );
  const delta = sub(closing.netWorth, opening.netWorth);

  return {
    from: opening.asOf,
    to: closing.asOf,
    base,
    basis: closing.basis,
    opening: opening.netWorth,
    closing: closing.netWorth,
    delta,
    lines,
    explained,
    unexplained: sub(delta, explained),
    singleCurrency: isSingleCurrency(opening, base) && isSingleCurrency(closing, base),
  };
}

function line(key: BridgeLineKey, amount: MoneyValue): BridgeLine {
  return { key, amount, notMeasured: false };
}

/**
 * Whether every component on both endpoints was already in base currency.
 *
 * For single-currency data every FX term is identically zero, so `unexplained`
 * must be **exactly** `0` — the one-base-unit tolerance in `TESTING.md` applies
 * to multi-currency data only (invariant I-30). Reporting which case this is
 * lets the test assert the stronger form where it holds.
 */
function isSingleCurrency(result: NetWorthResult, base: CurrencyCode): boolean {
  return (
    result.excluded.length === 0 &&
    result.contributions.every((c) => c.sourceCurrency === base)
  );
}

/** The bridge closes. Exactly for single-currency data; within `tolerance` otherwise. */
export function bridgeCloses(b: NetWorthBridge, toleranceMinorUnits = 0n): boolean {
  if (b.singleCurrency) return isZero(b.unexplained);
  const magnitude = b.unexplained.minor < 0n ? -b.unexplained.minor : b.unexplained.minor;
  return magnitude <= toleranceMinorUnits;
}

/** An empty period: every line zero. Used for a bridge over no movement at all. */
export function noFlows(base: CurrencyCode): BridgeFlows {
  const z = Money.zero(base);
  return {
    savings: z,
    investmentIncome: z,
    investmentCosts: z,
    realizedPnl: z,
    investmentTransfers: z,
    assetRevaluation: z,
    assetAdditions: z,
    liabilityChange: z,
    fxEffect: z,
    unrealizedGain: null,
  };
}

/** Sum two flow sets — used when a period is assembled from sub-periods. */
export function addFlows(a: BridgeFlows, b: BridgeFlows): BridgeFlows {
  return {
    savings: add(a.savings, b.savings),
    investmentIncome: add(a.investmentIncome, b.investmentIncome),
    investmentCosts: add(a.investmentCosts, b.investmentCosts),
    realizedPnl: add(a.realizedPnl, b.realizedPnl),
    investmentTransfers: add(a.investmentTransfers, b.investmentTransfers),
    assetRevaluation: add(a.assetRevaluation, b.assetRevaluation),
    assetAdditions: add(a.assetAdditions, b.assetAdditions),
    liabilityChange: add(a.liabilityChange, b.liabilityChange),
    fxEffect: add(a.fxEffect, b.fxEffect),
    // `null` is "not measured", and a measured figure plus an unmeasured one is
    // not a measurement. Only two market periods compose into a market period.
    unrealizedGain:
      a.unrealizedGain === null || b.unrealizedGain === null
        ? null
        : add(a.unrealizedGain, b.unrealizedGain),
  };
}
