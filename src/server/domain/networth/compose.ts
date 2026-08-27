/**
 * Composition — components in, `Net Worth at Cost` out
 * ([FINANCIAL-DOMAIN.md §9.3](../../../../docs/FINANCIAL-DOMAIN.md#93-calculation),
 * [ADR-23](../../../../docs/DECISIONS.md)).
 *
 * Pure. The service fetches the balances, the lots, the valuations and the
 * rates; this module classifies, converts, and adds them up **once**.
 *
 * ```
 * netWorth(asOf, basis) = assets − liabilities
 * assets                = Σ |base| where side = 'asset'
 * liabilities           = Σ |base| where side = 'liability'
 * ```
 *
 * Three properties hold by construction rather than by care:
 *
 * - **Every contribution is classified by the SIGN of its own value**, through
 *   the one `sideOfAmount` the money domain exports (ADR-25). No kind test
 *   exists here, so nothing can be dropped or duplicated by one.
 * - **The total is the map**, and the map rejects a duplicate key (I-21). A
 *   source counted twice throws rather than producing a wrong number.
 * - **Each component is converted once**, and the subtotals sum the
 *   already-rounded figures the map holds — so `assets − liabilities = Σ map`
 *   exactly, with no tolerance (I-22).
 */

import type { IsoDate } from '../../../lib/date';
import {
  Money,
  mulRate,
  sub,
  type CurrencyCode,
  type Money as MoneyValue,
} from '../../../lib/decimal/money';
import { RATE_SCALE, Rate } from '../../../lib/decimal/rate';
import { pow10 } from '../../../lib/decimal/rounding';
import {
  marketValuation,
  type MarketBuildSummary,
  type MarketValuation,
} from './market';
import {
  ContributionMap,
  sideOfAmount,
  sourceKeyId,
  type Contribution,
  type ExcludedComponent,
  type ExclusionReason,
  type NetWorthGroup,
  type PriceProvenance,
  type SourceKey,
} from './keys';

/**
 * The declared valuation basis — **part of the answer, not an implementation
 * detail** ([ADR-23](../../../../docs/DECISIONS.md#adr-23--net-worth-carries-a-declared-valuation-basis-phase-5-ships-net-worth-at-cost)).
 *
 * | | Investment contribution |
 * |---|---|
 * | `cost` | `Σ tax_lots.remaining_cost × lot.fx_rate_to_base`, per lot |
 * | `market` | `Σ quantityHeldOn × priceOn × fxRateOn`; unpriced holdings **excluded** and named |
 *
 * **`cost` is the default and remains so** ([ADR-32](../../../../docs/DECISIONS.md#adr-32--the-default-valuation-basis-remains-cost-market-is-an-explicit-alternate-view)):
 * `market` is a fully supported view that is reached by asking for it. Neither
 * replaces the other — they answer *what did I put in* versus *what is it worth
 * now* — and **a single figure never mixes them** (invariant **I-41**).
 *
 * Phase 5 shipped this as a one-member union precisely so that widening it would
 * be a compile error at every site that had to be reconsidered. Phase 6.11 used
 * that mechanism rather than circumventing it.
 */
export type ValuationBasis = 'cost' | 'market';

/** One eligible source, with the rate the service resolved for it. */
export interface ComponentInput {
  readonly key: SourceKey;
  readonly label: string;
  readonly group: NetWorthGroup;
  /** Signed economic value in the component's own currency. */
  readonly native: MoneyValue;
  readonly sourceRef: { readonly type: string; readonly id: string };
  /** `null` when no rate exists on or before the date — the component is excluded. */
  readonly fx: { readonly rate: Rate; readonly asOf: IsoDate } | null;
  /**
   * The currency the **underlying** is denominated in, where that differs from
   * `native.currency`.
   *
   * An investment lot is the case: its contribution arrives already in base,
   * because `tax_lots.fx_rate_to_base` was applied at acquisition and is never
   * revalued (INVESTMENT-DOMAIN.md §6.4). `native.currency` is therefore the
   * base currency and no conversion happens here — but the holding is still a
   * foreign one, and `singleCurrency` must know, because a foreign trade can
   * leave a rounding residue in the bridge that a genuinely single-currency
   * ledger cannot.
   */
  readonly sourceCurrency?: CurrencyCode;
  /**
   * The source is eligible but **cannot be valued on this basis**, and the
   * member says why.
   *
   * Two families reach here. A manual asset held on `asOf` with no valuation in
   * force is `unvalued`; a market-basis position with no usable price carries
   * the price cause. Either way it is **excluded and named**, never counted as
   * zero and never substituted with cost: a flat contributing ₹0 to a headline
   * figure is a materially wrong number presented as a right one, and a bond
   * contributing its 2019 purchase price to a market total is a figure in no
   * basis at all ([FINANCIAL-DOMAIN.md §9.3](../../../../docs/FINANCIAL-DOMAIN.md#93-calculation),
   * invariants **I-38**, **I-39**, **I-45**).
   *
   * Distinct from *not yet held*, which is ineligible and never reaches this
   * module at all.
   */
  readonly excluded?: ExclusionReason;
  /** Present only on a market-basis position that could be priced. */
  readonly price?: PriceProvenance;
}

export interface GroupSubtotal {
  readonly group: NetWorthGroup;
  readonly side: 'asset' | 'liability';
  readonly total: MoneyValue;
  readonly count: number;
}

export interface NetWorthResult {
  readonly asOf: IsoDate;
  readonly basis: ValuationBasis;
  readonly base: CurrencyCode;

  readonly assets: MoneyValue;
  readonly liabilities: MoneyValue;
  readonly netWorth: MoneyValue;

  /**
   * Reported **separately per side, deliberately**: an excluded asset makes the
   * figure look *lower* and an excluded liability makes it look *higher*, and
   * one blended ratio would hide which direction the figure is wrong in.
   *
   * **In Phase 5 this is a component-count ratio, not a value ratio.** The only
   * exclusion cause is a missing FX rate, and a component with no rate has no
   * expressible base value to weight by — so a value-weighted denominator is not
   * computable. `excluded` carries each component's native amount and currency
   * so the magnitude is still visible. Phase 6's price-driven exclusions are
   * value-weightable, because cost basis is known in base even when a price is
   * not.
   */
  readonly assetCoverage: Rate;
  readonly liabilityCoverage: Rate;

  readonly excluded: readonly ExcludedComponent[];
  readonly contributions: readonly Contribution[];
  readonly groups: readonly GroupSubtotal[];

  /**
   * Completeness under `basis: 'market'` — status, value-weighted investment
   * coverage, the excluded cost and the staleness summary.
   *
   * **`null` under `cost`**, and that is a statement rather than an omission:
   * acquisition cost is always known, so a cost figure has nothing to be partial
   * about and coverage of its investment block is `1.0` by construction.
   */
  readonly market: MarketValuation | null;
}

export interface ComposeOptions {
  readonly asOf: IsoDate;
  readonly base: CurrencyCode;
  readonly basis: ValuationBasis;
  /**
   * What only the market component builder knows — which positions it could
   * price, and how old those prices are.
   *
   * `compose()` still **never branches on the basis**: it branches on whether
   * this was supplied, which is a fact about the inputs it was given. That is
   * what keeps the basis a property of component *construction* and lets
   * `reconcile()` work unchanged for both.
   */
  readonly market?: MarketBuildSummary;
}

const RATE_UNIT = pow10(RATE_SCALE);

/**
 * Build the map, then read the totals off it.
 *
 * @throws {DuplicateContribution} when two inputs share a source key.
 */
export function compose(
  inputs: readonly ComponentInput[],
  options: ComposeOptions,
): NetWorthResult {
  const { asOf, base, basis } = options;
  const map = new ContributionMap();

  for (const input of inputs) {
    const keyId = sourceKeyId(input.key);
    // The side is decided by the NATIVE sign, so an excluded component still
    // knows which side of the sheet it belongs to and coverage lands on the
    // right one. Rates are always positive, so this agrees with the base sign
    // wherever a base figure exists.
    const side = sideOfAmount(input.native);

    // Eligible but unvaluable on this basis: excluded and named before any
    // conversion is attempted, because there is no figure to convert.
    if (input.excluded !== undefined) {
      map.exclude({
        key: input.key,
        keyId,
        label: input.label,
        group: input.group,
        // An unvaluable source is an asset by construction — a liability with no
        // recorded balance is simply not yet a debt and never reaches here, and
        // an unpriced holding is not a debt either. Forcing the side also keeps a
        // zero-magnitude exclusion counted against ASSET coverage rather than
        // against neither, which is where a missing valuation actually hurts.
        side: 'asset',
        native: input.native,
        nativeCurrency: input.native.currency,
        reason: input.excluded,
      });
      continue;
    }

    if (input.fx === null) {
      // A zero-valued component needs no rate and is never excluded for one:
      // `0 × anything` is `0`, and reporting it as unconvertible would invent a
      // gap where there is none.
      if (side === 'none') {
        map.add(zeroContribution(input, keyId, base, asOf));
        continue;
      }
      map.exclude({
        key: input.key,
        keyId,
        label: input.label,
        group: input.group,
        side,
        native: input.native,
        nativeCurrency: input.native.currency,
        reason: 'no_fx_rate',
      });
      continue;
    }

    const converted =
      input.fx.rate.value === RATE_UNIT
        ? Money.fromMinor(input.native.minor, base)
        : mulRate(Money.fromMinor(input.native.minor, base), input.fx.rate, 'half_up');

    map.add({
      key: input.key,
      keyId,
      label: input.label,
      group: input.group,
      side,
      native: input.native,
      nativeCurrency: input.native.currency,
      sourceCurrency: input.sourceCurrency ?? input.native.currency,
      rate: input.fx.rate,
      rateAsOf: input.fx.asOf,
      base: converted,
      sourceRef: input.sourceRef,
      ...(input.price === undefined ? {} : { price: input.price }),
    });
  }

  const assets = map.subtotal('asset', base);
  const liabilities = map.subtotal('liability', base);

  return {
    asOf,
    basis,
    base,
    assets,
    liabilities,
    netWorth: sub(assets, liabilities),
    assetCoverage: coverageOf(map.bySide('asset').length, countExcluded(map.excluded(), 'asset')),
    liabilityCoverage: coverageOf(
      map.bySide('liability').length,
      countExcluded(map.excluded(), 'liability'),
    ),
    excluded: map.excluded(),
    contributions: map.contributions(),
    groups: groupSubtotals(map, base),
    market: options.market === undefined ? null : marketValuation(options.market, map.excluded()),
  };
}

/** A source with no value: keeps its key, adds nothing, needs no rate. */
function zeroContribution(
  input: ComponentInput,
  keyId: string,
  base: CurrencyCode,
  asOf: IsoDate,
): Contribution {
  return {
    key: input.key,
    keyId,
    label: input.label,
    group: input.group,
    side: 'none',
    native: input.native,
    nativeCurrency: input.native.currency,
    sourceCurrency: input.sourceCurrency ?? input.native.currency,
    rate: Rate.one(),
    rateAsOf: asOf,
    base: Money.zero(base),
    sourceRef: input.sourceRef,
  };
}

function countExcluded(excluded: readonly ExcludedComponent[], side: 'asset' | 'liability'): number {
  return excluded.filter((e) => e.side === side).length;
}

/**
 * `covered / (covered + excluded)`.
 *
 * A side with nothing on it is **fully covered**: there is nothing left out. A
 * zero coverage would read as "we could not value anything", which is a
 * different statement.
 */
function coverageOf(covered: number, excluded: number): Rate {
  const total = covered + excluded;
  if (total === 0) return Rate.one();
  return Rate.fromValue((BigInt(covered) * RATE_UNIT) / BigInt(total));
}

/**
 * Group subtotals for display and for the reconciliation's second path.
 *
 * A `none`-side contribution appears in no group: it has no side to sit on, and
 * inventing one would put a zero row under a heading it does not belong to.
 */
function groupSubtotals(map: ContributionMap, base: CurrencyCode): GroupSubtotal[] {
  const acc = new Map<string, { group: NetWorthGroup; side: 'asset' | 'liability'; total: bigint; count: number }>();

  for (const side of ['asset', 'liability'] as const) {
    for (const c of map.bySide(side)) {
      const k = `${side}:${c.group}`;
      const magnitude = c.base.minor < 0n ? -c.base.minor : c.base.minor;
      const existing = acc.get(k);
      if (existing) {
        existing.total += magnitude;
        existing.count += 1;
      } else {
        acc.set(k, { group: c.group, side, total: magnitude, count: 1 });
      }
    }
  }

  return [...acc.values()].map((g) => ({
    group: g.group,
    side: g.side,
    total: Money.fromMinor(g.total, base),
    count: g.count,
  }));
}
