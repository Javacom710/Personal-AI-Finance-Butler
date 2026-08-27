/**
 * FX rate selection ([FINANCIAL-DOMAIN.md §2](../../../docs/FINANCIAL-DOMAIN.md#2-fx)).
 *
 * Pure: the caller fetches candidate rows, this decides which one applies. The
 * split matters because the *rule* is where the correctness lives:
 *
 * - Exact `as_of` match, else the most recent **earlier** date, else `no_rate`.
 * - **Never** interpolate, and never use a later rate for an earlier date. Doing
 *   so would make last March's totals change every time a new rate arrives.
 * - `rate(X, X, _) = 1` without a table lookup.
 * - Resolution order: `identity` → `direct` → `inverse` → `triangulated`. Each
 *   is recorded in `FxSelection.source` so an audit can see how a rate was
 *   arrived at, and **a direct rate always wins** even when a derived route has
 *   a more recent date — the stored direction is the one actually quoted.
 *
 * ## Why triangulation exists (finding M1)
 *
 * Reference FX feeds quote everything against one reference currency. A feed
 * publishing `EUR→INR` and `EUR→USD` and nothing else leaves a USD holding in an
 * INR-base portfolio with **no direct and no inverse route** — and under a
 * direct-or-inverse-only rule the whole foreign block silently disappears from
 * net worth. A silent omission is worse than a wrong number: nothing is
 * displayed, so there is nothing to notice.
 *
 * Four rules keep it from becoming a source of invented figures:
 *
 * 1. **Last resort.** Direct and inverse both win, at any date.
 * 2. **Both legs obey the same date rule** — exact, else most recent earlier,
 *    never later. A leg that would need a future rate disqualifies the route.
 * 3. **Dated by the stalest leg.** A composed rate is no fresher than the oldest
 *    observation it was built from, and dating it by the newer leg would present
 *    a month-old cross as current.
 * 4. **One pivot, never two.** Chaining through two pivots compounds two
 *    roundings against a rate no source ever published.
 *
 * Adapters still request base-quoted pairs, so a direct row is the everyday
 * path and this is the safety net. Both exist because either alone leaves a
 * gap: adapter normalisation cannot help a pair nobody thought to request, and
 * triangulation alone would put an avoidable rounding in the common case.
 */

import { compareDates, minDate, type IsoDate } from '../../lib/date';
import type { CurrencyCode } from '../../lib/decimal/money';
import { compose, invert, Rate } from '../../lib/decimal/rate';
import { err, ok, type Result } from '../../lib/result';

export interface FxRateRow {
  readonly baseCode: CurrencyCode;
  readonly quoteCode: CurrencyCode;
  readonly asOf: IsoDate;
  /** 1 base = `rate` quote. */
  readonly rate: Rate;
}

export interface FxSelection {
  readonly rate: Rate;
  /** The date of the row actually used, which may be earlier than the date asked for. */
  readonly asOf: IsoDate;
  readonly source: 'identity' | 'direct' | 'inverse' | 'triangulated';
  /** The intermediate currency, on a triangulated selection only. */
  readonly via?: CurrencyCode;
}

export type FxUnavailable = 'no_rate';

type PairIndex = Map<string, FxRateRow>;

const key = (base: CurrencyCode, quote: CurrencyCode): string => `${base}>${quote}`;

/**
 * The most recent row on or before `on`, per ordered pair.
 *
 * Building this once means every lookup below — direct, inverse, and both legs
 * of every candidate pivot — applies the same date rule, rather than each
 * re-implementing "most recent earlier" and one of them getting it wrong.
 */
function indexRows(rows: readonly FxRateRow[], on: IsoDate): PairIndex {
  const index: PairIndex = new Map();
  for (const row of rows) {
    if (compareDates(row.asOf, on) > 0) continue;
    const k = key(row.baseCode, row.quoteCode);
    const current = index.get(k);
    if (!current || compareDates(row.asOf, current.asOf) > 0) index.set(k, row);
  }
  return index;
}

interface Leg {
  readonly rate: Rate;
  readonly asOf: IsoDate;
}

/** One hop, direct or inverted. Used for the ends of a triangulated route. */
function leg(index: PairIndex, from: CurrencyCode, to: CurrencyCode): Leg | null {
  const direct = index.get(key(from, to));
  if (direct) return { rate: direct.rate, asOf: direct.asOf };

  const inverse = index.get(key(to, from));
  if (inverse && inverse.rate.value !== 0n) {
    return { rate: invert(inverse.rate, 'half_even'), asOf: inverse.asOf };
  }
  return null;
}

/**
 * Choose the rate converting `from` into `to`, in force on `on`.
 *
 * `rows` may contain anything; rows dated after `on` are ignored rather than
 * trusted, so passing an unfiltered table is safe.
 */
export function selectRate(
  rows: readonly FxRateRow[],
  from: CurrencyCode,
  to: CurrencyCode,
  on: IsoDate,
): Result<FxSelection, FxUnavailable> {
  return resolve(indexRows(rows, on), from, to, on);
}

/**
 * The same rule, with the per-date index built **once per date** instead of once
 * per call.
 *
 * `indexRows` is `O(rows)`, and its result depends on nothing but `(rows, on)`.
 * One conversion on one page cannot tell the difference; a **market-value series**
 * can, because it asks for a rate per foreign position per point. Over 2,500
 * stored observations that is the difference between a lookup and a table scan —
 * the same shape of mistake the price series had, and the same fix
 * ([MARKET-VALUE-NET-WORTH-DESIGN.md §13](../../../docs/MARKET-VALUE-NET-WORTH-DESIGN.md#13-performance)).
 *
 * **The resolution rule is untouched**, and deliberately so: identity → direct →
 * inverse → triangulated, dated by the stalest leg, one pivot only. Memoising the
 * index changes what is recomputed, never what is decided, so every Phase 3, 4
 * and 5 figure is byte-identical.
 */
export function rateSelector(
  rows: readonly FxRateRow[],
): (from: CurrencyCode, to: CurrencyCode, on: IsoDate) => Result<FxSelection, FxUnavailable> {
  const byDate = new Map<string, PairIndex>();

  return (from, to, on) => {
    // The identity case needs no index at all, so a single-currency ledger never
    // builds one.
    if (from === to) return ok({ rate: Rate.one(), asOf: on, source: 'identity' });

    let index = byDate.get(on);
    if (index === undefined) {
      index = indexRows(rows, on);
      byDate.set(on, index);
    }
    return resolve(index, from, to, on);
  };
}

/** The resolution order, over an already-built index. One implementation, two callers. */
function resolve(
  index: PairIndex,
  from: CurrencyCode,
  to: CurrencyCode,
  on: IsoDate,
): Result<FxSelection, FxUnavailable> {
  if (from === to) {
    return ok({ rate: Rate.one(), asOf: on, source: 'identity' });
  }

  // A direct rate always wins, even when an inverse or triangulated route is
  // more recent: the stored direction is the one that was actually quoted.
  const direct = index.get(key(from, to));
  if (direct) return ok({ rate: direct.rate, asOf: direct.asOf, source: 'direct' });

  const inverse = index.get(key(to, from));
  if (inverse) {
    if (inverse.rate.value === 0n) return err('no_rate');
    return ok({ rate: invert(inverse.rate, 'half_even'), asOf: inverse.asOf, source: 'inverse' });
  }

  return triangulate(index, from, to);
}

/**
 * `from → P → to`, over every currency `P` the loaded rows mention.
 *
 * The best route is the one whose **effective** date — the stalest of its two
 * legs — is latest. Ties break on the pivot code so the choice is deterministic:
 * the same rows must always produce the same rate, or a historical total would
 * depend on row ordering.
 */
function triangulate(
  index: PairIndex,
  from: CurrencyCode,
  to: CurrencyCode,
): Result<FxSelection, FxUnavailable> {
  const pivots = new Set<CurrencyCode>();
  for (const k of index.keys()) {
    const [base, quote] = k.split('>') as [CurrencyCode, CurrencyCode];
    if (base !== from && base !== to) pivots.add(base);
    if (quote !== from && quote !== to) pivots.add(quote);
  }

  let best: { selection: FxSelection; asOf: IsoDate; via: CurrencyCode } | null = null;

  for (const pivot of [...pivots].sort()) {
    const first = leg(index, from, pivot);
    if (!first) continue;
    const second = leg(index, pivot, to);
    if (!second) continue;

    // A composed rate is only as fresh as the oldest observation behind it.
    const effective = minDate(first.asOf, second.asOf);

    if (best === null || compareDates(effective, best.asOf) > 0) {
      best = {
        asOf: effective,
        via: pivot,
        selection: {
          rate: compose(first.rate, second.rate, 'half_even'),
          asOf: effective,
          source: 'triangulated',
          via: pivot,
        },
      };
    }
  }

  return best === null ? err('no_rate') : ok(best.selection);
}
