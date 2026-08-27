/**
 * The cost-to-market **restatement** — why two bases disagree at one date
 * ([ADR-31](../../../../docs/DECISIONS.md#adr-31--cost-to-market-is-a-restatement-at-an-instant-not-a-bridge-over-time),
 * [FINANCIAL-DOMAIN.md §9.5](../../../../docs/FINANCIAL-DOMAIN.md#95-the-cost-to-market-restatement)).
 *
 * > **A bridge explains movement between two dates on one basis. A restatement
 * > explains why two bases disagree at one date. They are different questions,
 * > they take different inputs, and they must never share a type.**
 *
 * `bridge()` already enforces half of this by throwing on a basis change, and
 * that check stays. This is the other half — the thing actually wanted when
 * someone asks *"why is market ₹2 lakh higher than cost?"*
 *
 * ```
 * NW(cost)
 *   − Σ baseCostBasis(unpriced positions)        removed: not valuable on this basis
 *   + Σ ( costAtSpot − costAtAcquisitionRates )  FX rebasis
 *   + Σ ( marketAtSpot − costAtSpot )            price effect
 * = NW(market)
 * ```
 *
 * ## Why it closes exactly (invariant I-48)
 *
 * Every non-investment component is **identical** on both bases — an account
 * balance is a recorded fact, a manual asset has a valuation rather than a
 * price, and a loan's outstanding principal is a contractual amount
 * ([§9.6](../../../../docs/FINANCIAL-DOMAIN.md#96-what-market-basis-does-not-change)).
 * So the whole difference lives in the investment block, and per position the
 * two middle terms telescope through `costAtSpot`:
 *
 * ```
 * (costAtSpot − cost) + (market − costAtSpot) = market − cost
 * ```
 *
 * **Neither term is a residual.** `costAtSpot` is computed independently — from
 * `tax_lots.remaining_cost`, which is held in the *instrument's* currency, at the
 * `asOf` rate — and the split between price and currency follows from it. Had
 * the price effect been defined as the plug, the identity would be trivially
 * true and would hide the bug it exists to surface, which is the same objection
 * that keeps `fx_effect` computed in the bridge.
 *
 * For **single-currency** data every FX rebasis term is identically zero, which
 * is what lets I-48 assert exact closure there rather than a tolerance.
 *
 * ## What it must never be read as
 *
 * - **It explains a difference, never a gain.** The price effect at one instant
 *   is unrealised and says nothing about what the user earned; realised P&L is a
 *   separate, already-correct figure.
 * - **The removed-unpriced line is not a loss.** It is what the comparison set
 *   aside for want of a price. A reader looking at `−₹5,00,000` beside a bond
 *   has to be able to tell that from a bond that fell by ₹5,00,000.
 * - **There is no liability term and no manual-asset term.** A line for either
 *   means something is wrong.
 */

import type { IsoDate } from '../../../lib/date';
import {
  add,
  Money,
  sub,
  type CurrencyCode,
  type Money as MoneyValue,
} from '../../../lib/decimal/money';
import type { NetWorthResult } from './compose';
import { sourceKeyId, type SourceKey } from './keys';

/**
 * One priced position's cost, restated at the `asOf` rate.
 *
 * `Σ tax_lots.remaining_cost × fxRateOn(instrumentCurrency → base, asOf)` —
 * the same money the `cost` basis carries, converted at spot instead of at
 * acquisition. **No new column**: `remaining_cost` is already in the
 * instrument's currency alongside the acquisition `fx_rate_to_base`.
 */
export interface PositionCostAtSpot {
  readonly key: SourceKey;
  readonly costAtSpot: MoneyValue;
}

export interface RestatementLine {
  readonly key: 'removed_unpriced' | 'fx_rebasis' | 'price_effect';
  readonly amount: MoneyValue;
}

export interface Restatement {
  readonly asOf: IsoDate;
  readonly base: CurrencyCode;
  /** **Net Worth at Cost** — unchanged, and still the default view (ADR-32). */
  readonly cost: MoneyValue;
  /** **Net Worth at Market Value**. `null` when the market figure is `unavailable`. */
  readonly market: MoneyValue;
  /** `market − cost`. A restatement, not something the user earned. */
  readonly difference: MoneyValue;
  /**
   * Signed as they contribute: `removed_unpriced` is negative (it leaves the
   * total), the other two carry their own sign.
   */
  readonly lines: readonly RestatementLine[];
  /** `difference − Σ lines`. **Exactly zero** — reported so the check is visible. */
  readonly residual: MoneyValue;
  readonly closes: boolean;
  /** Positions whose cost was set aside for want of a price. Named, so the line has referents. */
  readonly unpricedKeys: readonly string[];
}

export class RestatementFailed extends Error {
  constructor(readonly residual: MoneyValue) {
    super(
      `The cost-to-market restatement does not close: it leaves ${residual.minor} minor units ` +
        'unexplained. Every term is computed and none is a residual, so a non-zero figure ' +
        'means the two bases disagree about a component that is not an investment (invariant I-48).',
    );
    this.name = 'RestatementFailed';
  }
}

/**
 * Restate a cost figure as a market one, at the same instant.
 *
 * @param cost      `netWorthAsOf(asOf, { basis: 'cost' })`
 * @param market    `netWorthAsOf(asOf, { basis: 'market' })` — the same date, same sources
 * @param atSpot    each **priced** position's cost, converted at the `asOf` rate
 *
 * @throws {TypeError} when the two results are not the same date, base or opposing bases —
 *   a restatement across dates is a bridge, and a bridge is a different question.
 */
export function restate(
  cost: NetWorthResult,
  market: NetWorthResult,
  atSpot: readonly PositionCostAtSpot[],
): Restatement {
  if (cost.basis !== 'cost' || market.basis !== 'market') {
    throw new TypeError(
      `restate: expected a 'cost' figure and a 'market' one, got '${cost.basis}' and '${market.basis}'. ` +
        'A restatement explains why two BASES disagree; two figures on one basis is a bridge (ADR-31).',
    );
  }
  if (cost.asOf !== market.asOf) {
    throw new TypeError(
      `restate: ${cost.asOf} and ${market.asOf} are different dates. A restatement is at ONE instant — ` +
        'explaining movement over time is what bridge() is for, and conflating them would let a ' +
        'valuation difference be read as a gain (ADR-31).',
    );
  }
  if (cost.base !== market.base) {
    throw new TypeError(
      `restate: ${cost.base} and ${market.base} are different base currencies.`,
    );
  }

  const base = cost.base;
  const costByKey = positionsOf(cost);
  const marketByKey = positionsOf(market);
  const spotByKey = new Map(atSpot.map((p) => [sourceKeyId(p.key), p.costAtSpot]));

  let removed = Money.zero(base);
  let fxRebasis = Money.zero(base);
  let priceEffect = Money.zero(base);
  const unpricedKeys: string[] = [];

  for (const [keyId, costBase] of costByKey) {
    const marketBase = marketByKey.get(keyId);

    if (marketBase === undefined) {
      // Priced or excluded, never cost-substituted (I-38, I-39). Its cost leaves
      // the comparison, and it is named so the line is not an anonymous negative.
      removed = add(removed, Money.fromMinor(costBase.minor, base));
      unpricedKeys.push(keyId);
      continue;
    }

    // `costAtSpot` is absent only for a position whose instrument currency has no
    // rate at this date — in which case the market side excluded it too and this
    // branch is unreachable. Falling back to the acquisition-rate figure attributes
    // the whole difference to price, which is the honest reading when no second
    // rate exists to compare against.
    const spot = spotByKey.get(keyId) ?? costBase;

    fxRebasis = add(fxRebasis, sub(Money.fromMinor(spot.minor, base), Money.fromMinor(costBase.minor, base)));
    priceEffect = add(
      priceEffect,
      sub(Money.fromMinor(marketBase.minor, base), Money.fromMinor(spot.minor, base)),
    );
  }

  const lines: RestatementLine[] = [
    { key: 'removed_unpriced', amount: Money.fromMinor(-removed.minor, base) },
    { key: 'fx_rebasis', amount: fxRebasis },
    { key: 'price_effect', amount: priceEffect },
  ];

  const difference = sub(market.netWorth, cost.netWorth);
  const explained = lines.reduce((acc, l) => add(acc, l.amount), Money.zero(base));
  const residual = sub(difference, explained);

  return {
    asOf: cost.asOf,
    base,
    cost: cost.netWorth,
    market: market.netWorth,
    difference,
    lines,
    residual,
    closes: residual.minor === 0n,
    unpricedKeys,
  };
}

/** `restate`, but a failure to close is an exception rather than a flag. */
export function assertRestates(
  cost: NetWorthResult,
  market: NetWorthResult,
  atSpot: readonly PositionCostAtSpot[],
): Restatement {
  const r = restate(cost, market, atSpot);
  if (!r.closes) throw new RestatementFailed(r.residual);
  return r;
}

/**
 * Every position's **signed base** figure on one result, whether it contributed
 * or was excluded at zero.
 *
 * Only `t: 'position'` keys — the restatement has no account, manual-asset or
 * liability term by construction, and one appearing here would mean the two
 * bases had disagreed about something that is identical in both.
 */
function positionsOf(result: NetWorthResult): Map<string, MoneyValue> {
  const out = new Map<string, MoneyValue>();
  for (const c of result.contributions) {
    if (c.key.t !== 'position') continue;
    out.set(c.keyId, c.base);
  }
  return out;
}
