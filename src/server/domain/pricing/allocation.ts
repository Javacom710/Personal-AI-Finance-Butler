/**
 * Asset allocation and concentration
 * ([INVESTMENT-DOMAIN.md §9](../../../../docs/INVESTMENT-DOMAIN.md#9-asset-allocation)).
 *
 * ```
 * allocation(dimension) = [{ key, label, marketValue, weightPct, costBasis, unrealizedPnl }]
 * ```
 *
 * Weights are over **priced** market value, and the response carries
 * `unpricedValue` so the UI can say "94% of portfolio classified; 2 holdings
 * unpriced" instead of presenting a partial total as a whole one.
 *
 * Concentration is computed here, deterministically, rather than by a model —
 * "how concentrated is my portfolio?" is a calculation, and the AI's job is to
 * explain the answer, not to produce it (FINANCIAL-DOMAIN.md §10.5).
 */

import { Money, add, sum, type CurrencyCode } from '../../../lib/decimal/money';
import { divRound, pow10 } from '../../../lib/decimal/rounding';
import { RATE_SCALE, Rate } from '../../../lib/decimal/rate';
import { qIsZero } from '../../../lib/decimal/quantity';
import { metric, unavailable, type Metric } from '../../../lib/metric';
import { ratio } from '../calc/ratio';
import type { HoldingView } from './valuation';

export type AllocationDimension = 'asset_class' | 'instrument' | 'account' | 'currency' | 'country';

export interface AllocationSlice {
  readonly key: string;
  readonly label: string;
  /** Base currency, priced holdings only. */
  readonly marketValue: Money;
  readonly weightPct: Metric<Rate>;
  readonly costBasis: Money;
  readonly unrealizedPnl: Money;
  readonly holdingCount: number;
}

export interface Allocation {
  readonly dimension: AllocationDimension;
  readonly slices: readonly AllocationSlice[];
  readonly total: Money;
  /** Base-currency cost of the holdings that could not be priced or converted. */
  readonly unpricedValue: Money;
  readonly unpricedCount: number;
}

const ASSET_CLASS_LABELS: Record<string, string> = {
  equity: 'Equities',
  mutual_fund: 'Mutual funds',
  etf: 'ETFs',
  bond: 'Bonds',
  fixed_deposit: 'Fixed deposits',
  gold: 'Gold',
  crypto: 'Crypto',
  cash_equivalent: 'Cash equivalents',
  other: 'Other',
};

/**
 * Group priced holdings along one dimension.
 *
 * A **closed** position (quantity zero, retained for its realised-P&L history)
 * appears in no slice — it is not an allocation of anything (edge case 18). An
 * **unpriced** one appears in no slice either, and its cost is reported in
 * `unpricedValue` so it is visibly absent rather than silently so (edge case 10).
 */
export function allocation(
  holdings: readonly HoldingView[],
  dimension: AllocationDimension,
  baseCurrency: CurrencyCode,
): Allocation {
  const open = holdings.filter((h) => !qIsZero(h.quantity));
  const priced = open.filter((h) => h.baseMarketValue !== null);
  const unpriced = open.filter((h) => h.baseMarketValue === null);

  const total = sum(
    priced.map((h) => h.baseMarketValue!),
    baseCurrency,
  );

  const grouped = new Map<string, { label: string; holdings: HoldingView[] }>();
  for (const holding of priced) {
    const { key, label } = classify(holding, dimension);
    const bucket = grouped.get(key);
    if (bucket) bucket.holdings.push(holding);
    else grouped.set(key, { label, holdings: [holding] });
  }

  const slices: AllocationSlice[] = [];
  for (const [key, bucket] of grouped) {
    const marketValue = sum(
      bucket.holdings.map((h) => h.baseMarketValue!),
      baseCurrency,
    );
    const costBasis = sum(
      bucket.holdings.map((h) => h.baseInvested),
      baseCurrency,
    );
    slices.push({
      key,
      label: bucket.label,
      marketValue,
      weightPct: ratio(marketValue, total),
      costBasis,
      unrealizedPnl: Money.fromMinor(marketValue.minor - costBasis.minor, baseCurrency),
      holdingCount: bucket.holdings.length,
    });
  }

  // Largest first, ties by label, so the order is deterministic across runs.
  slices.sort((a, b) =>
    a.marketValue.minor === b.marketValue.minor
      ? a.label.localeCompare(b.label)
      : a.marketValue.minor > b.marketValue.minor
        ? -1
        : 1,
  );

  return {
    dimension,
    slices,
    total,
    unpricedValue: sum(
      unpriced.map((h) => h.baseInvested),
      baseCurrency,
    ),
    unpricedCount: unpriced.length,
  };
}

function classify(holding: HoldingView, dimension: AllocationDimension): { key: string; label: string } {
  switch (dimension) {
    case 'asset_class':
      return {
        key: holding.instrument.assetClass,
        label: ASSET_CLASS_LABELS[holding.instrument.assetClass] ?? holding.instrument.assetClass,
      };
    case 'instrument':
      return { key: holding.instrument.id, label: holding.instrument.symbol };
    case 'account':
      return { key: holding.accountId, label: holding.accountName };
    case 'currency':
      return { key: holding.instrument.currency, label: holding.instrument.currency };
    case 'country':
      // A country is genuinely unknown for many instruments, and "Unknown" is a
      // truthful slice. Dropping them would make the weights sum to less than 1
      // with nothing to explain the gap.
      return {
        key: holding.instrument.country ?? 'unknown',
        label: holding.instrument.country ?? 'Unknown',
      };
  }
}

export interface Concentration {
  readonly top1: Metric<Rate>;
  readonly top3: Metric<Rate>;
  readonly top5: Metric<Rate>;
  /** Holdings whose weight exceeds 10%. */
  readonly above10Pct: number;
  /**
   * Herfindahl–Hirschman index over instrument weights, on 0…1. `1` is a single
   * holding; `1/n` is n equal ones. Reported as a `Rate` for the same reason
   * every other ratio is: so it cannot be confused with a money figure.
   */
  readonly hhi: Metric<Rate>;
  readonly holdingCount: number;
}

const RATE_UNIT = pow10(RATE_SCALE);
const TEN_PERCENT = RATE_UNIT / 10n;

/**
 * Concentration over **instrument** weights, priced holdings only.
 *
 * Computed from one allocation pass rather than from the holdings directly, so
 * an instrument held in two accounts counts once — which is what "how
 * concentrated am I?" means. Counting the accounts separately would report a
 * ₹10 lakh position split across two demat accounts as two ₹5 lakh ones and
 * halve the apparent concentration.
 */
export function concentration(byInstrument: Allocation): Concentration {
  const weights = byInstrument.slices
    .map((s) => s.weightPct.value)
    .filter((w): w is Rate => w !== null)
    .map((w) => w.value)
    .sort((a, b) => (a === b ? 0 : a > b ? -1 : 1));

  if (weights.length === 0) {
    return {
      top1: unavailable('no_data'),
      top3: unavailable('no_data'),
      top5: unavailable('no_data'),
      above10Pct: 0,
      hhi: unavailable('no_data'),
      holdingCount: 0,
    };
  }

  const topN = (n: number): Metric<Rate> =>
    metric(Rate.fromValue(weights.slice(0, n).reduce((acc, w) => acc + w, 0n)));

  // Σ w², at RATE_SCALE. Each square is divided back down once, at full width.
  const hhi = weights.reduce((acc, w) => acc + divRound(w * w, RATE_UNIT, 'half_up'), 0n);

  return {
    top1: topN(1),
    top3: topN(3),
    top5: topN(5),
    above10Pct: weights.filter((w) => w > TEN_PERCENT).length,
    hhi: metric(Rate.fromValue(hhi)),
    holdingCount: weights.length,
  };
}

/** Total across every slice — used by the UI footer and asserted in tests. */
export function allocationTotal(a: Allocation): Money {
  return a.slices.reduce((acc, s) => add(acc, s.marketValue), Money.zero(a.total.currency));
}
