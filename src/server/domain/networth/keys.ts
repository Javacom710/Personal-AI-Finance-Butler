/**
 * Source identity and the contributions map — the single-counting mechanism
 * ([FINANCIAL-DOMAIN.md §9.2](../../../../docs/FINANCIAL-DOMAIN.md#92-enforcement)).
 *
 * > **Every unit of value has exactly one owning source. A source contributes to
 * > net worth; a view of that source never does.**
 *
 * Prose is not enforcement. The calculator builds an explicit map keyed by
 * source identity and sums **only the map** — never concatenated arrays, because
 * concatenation is how a source gets counted twice without anyone noticing.
 * Inserting a duplicate key **throws** (invariant I-21): a source counted twice
 * is a crash in development and in CI, not a wrong number in production.
 */

import { add, Money, sum, type CurrencyCode, type Money as MoneyValue } from '../../../lib/decimal/money';
import type { Rate } from '../../../lib/decimal/rate';
import type { Quantity } from '../../../lib/decimal/quantity';
import type { UnitPrice } from '../../../lib/decimal/price';
import type { Freshness } from '../../market-data/freshness';
import type { IsoDate } from '../../../lib/date';
import { sideOfAmount, type AccountRole } from '../ledger/balance';
import type { MissingPriceReason } from '../pricing/price-result';

/**
 * Which source a contribution came from.
 *
 * Positions are keyed at `(account, instrument)` rather than per lot: the
 * at-cost figure is derived per lot, but several lots of one instrument in one
 * account collapse into one contribution. That is what keeps the key stable when
 * Phase 6 replaces the cost figure with a market figure computed per position.
 */
export type SourceKey =
  | { readonly t: 'account'; readonly accountId: string }
  | { readonly t: 'position'; readonly accountId: string; readonly instrumentId: string }
  | { readonly t: 'asset'; readonly assetId: string }
  | { readonly t: 'liability'; readonly liabilityId: string };

/** Stable, order-independent string form. The map's actual key. */
export function sourceKeyId(key: SourceKey): string {
  switch (key.t) {
    case 'account':
      return `account:${key.accountId}`;
    case 'position':
      return `position:${key.accountId}:${key.instrumentId}`;
    case 'asset':
      return `asset:${key.assetId}`;
    case 'liability':
      return `liability:${key.liabilityId}`;
  }
}

/** Display and reconciliation grouping. Never a second summation path. */
export type NetWorthGroup =
  | 'cash'
  | 'brokerage_cash'
  | 'investments'
  | 'property'
  | 'vehicle'
  | 'gold_physical'
  | 'collectible'
  | 'receivable'
  | 'other_assets'
  | 'credit_card'
  | 'loans'
  | 'overdrawn_accounts'
  | 'other_liabilities';

export type ContributionSide = Extract<AccountRole, 'asset' | 'liability'>;

/**
 * How a market-basis position was priced.
 *
 * Carried on the contribution so the reconciliation can answer *"why is it
 * ₹72,000?"* with **400 × ₹180.00, priced 21 Aug from twelvedata:XNSE** rather
 * than with the total again ([MARKET-VALUE-NET-WORTH-DESIGN.md §16](../../../../docs/MARKET-VALUE-NET-WORTH-DESIGN.md#16-reconciliation)).
 * Every field is already on the `PriceResult`; none is recomputed.
 *
 * Absent on a `cost` contribution, and on an account, manual asset or liability —
 * none of those has a price, and inventing one would misrepresent its provenance.
 */
export interface PriceProvenance {
  readonly quantity: Quantity;
  readonly unitPrice: UnitPrice;
  /** The session the observation belongs to. *"Priced as of …"*. */
  readonly tradingDate: IsoDate;
  /** `stale` contributes and is reported; it never becomes `current` (I-44). */
  readonly freshness: Freshness;
  readonly source: string;
  /** Days the close was carried back to reach the valuation date. Zero on an exact hit. */
  readonly carriedDays: number;
}

/** One source's contribution, with everything needed to explain it. */
export interface Contribution {
  readonly key: SourceKey;
  readonly keyId: string;
  readonly label: string;
  readonly group: NetWorthGroup;
  /**
   * `asset` / `liability` / `none`, decided by the **sign** of `native`
   * (ADR-25). `none` is a zero-valued source: it holds its key so the map stays
   * a complete account of what was considered, and adds nothing to either
   * subtotal.
   */
  readonly side: AccountRole;
  /** The component's own currency, signed as economic value. */
  readonly native: MoneyValue;
  readonly nativeCurrency: CurrencyCode;
  /** The currency the underlying is denominated in. Differs from `nativeCurrency` for a lot. */
  readonly sourceCurrency: CurrencyCode;
  /** The rate used, and the date of the row it came from — for the audit trail. */
  readonly rate: Rate;
  readonly rateAsOf: IsoDate;
  /** `round(native × rate, 4)`, signed. What the subtotals sum. */
  readonly base: MoneyValue;
  /** Where the figure came from, so the UI can link to it. */
  readonly sourceRef: { readonly type: string; readonly id: string };
  /** Present only on a **market-basis position**. See `PriceProvenance`. */
  readonly price?: PriceProvenance;
}

/**
 * Why a source that was eligible could not be valued on this basis.
 *
 * Nine members, not one, because each is a different instruction to the user and
 * collapsing them into "unpriced" would tell them to fix the wrong thing
 * (invariant **I-45**). The seven price causes are `MissingPriceReason` verbatim
 * — the same union the Investments pages already report — so a holding gives the
 * same account of itself on both screens.
 */
export type ExclusionReason =
  /** No FX rate on or before the date. Basis-independent. */
  | 'no_fx_rate'
  /** Held, but never valued by this date — a manual asset with no valuation in force. */
  | 'unvalued'
  /**
   * No observation exists on or before this date **within the carry-back bound**
   * — the instrument is younger than the date, or its history has not been
   * backfilled that far ([MARKET-VALUE-NET-WORTH-DESIGN.md §8.2](../../../../docs/MARKET-VALUE-NET-WORTH-DESIGN.md#82-historical-edge-rules)).
   *
   * Deliberately **not** a `MissingPriceReason`. Those seven are verdicts about a
   * *provider* — it does not know the symbol, it errored, it is rate limited —
   * and none of them is true here: the provider may be working perfectly and
   * simply have published nothing for a date before the instrument listed. Folding
   * this into `not_found` would tell the user to re-map a symbol that is mapped,
   * and into `no_provider` that they must enter a price by hand for a date that
   * has one everywhere else in the series. It is a gap in the point, not a fault
   * in the feed.
   */
  | 'no_price_on_date'
  | MissingPriceReason;

/** A source that is eligible but cannot be valued on the declared basis. */
export interface ExcludedComponent {
  readonly key: SourceKey;
  readonly keyId: string;
  readonly label: string;
  readonly group: NetWorthGroup;
  readonly side: AccountRole;
  /**
   * The magnitude that was left out, so the exclusion carries a size and not
   * only a name. For an unpriced position this is its **base cost basis** —
   * exactly what the `cost` basis would have used — which is what makes market
   * coverage value-weightable (D-29) while an unvalued asset's is not.
   */
  readonly native: MoneyValue;
  readonly nativeCurrency: CurrencyCode;
  readonly reason: ExclusionReason;
}

export class DuplicateContribution extends Error {
  constructor(readonly keyId: string) {
    super(
      `Net worth: source ${keyId} contributed twice. Every unit of value has exactly ` +
        'one owning source (FINANCIAL-DOMAIN.md §9.1); a duplicate key means a source ' +
        'is being counted through two paths.',
    );
    this.name = 'DuplicateContribution';
  }
}

/**
 * The accumulator. Insert-only, duplicate-rejecting, and the **only** place a
 * net-worth total is formed.
 */
export class ContributionMap {
  readonly #entries = new Map<string, Contribution>();
  readonly #excluded = new Map<string, ExcludedComponent>();

  /** @throws {DuplicateContribution} if this source has already contributed. */
  add(contribution: Contribution): void {
    this.#reserve(contribution.keyId);
    this.#entries.set(contribution.keyId, contribution);
  }

  /** @throws {DuplicateContribution} if this source has already contributed. */
  exclude(component: ExcludedComponent): void {
    this.#reserve(component.keyId);
    this.#excluded.set(component.keyId, component);
  }

  #reserve(keyId: string): void {
    if (this.#entries.has(keyId) || this.#excluded.has(keyId)) {
      throw new DuplicateContribution(keyId);
    }
  }

  contributions(): readonly Contribution[] {
    return [...this.#entries.values()];
  }

  excluded(): readonly ExcludedComponent[] {
    return [...this.#excluded.values()];
  }

  /** Contributions on one side, in insertion order. */
  bySide(side: ContributionSide): readonly Contribution[] {
    return this.contributions().filter((c) => c.side === side);
  }

  /**
   * `Σ |base|` over one side. The subtotals sum the **already-rounded** base
   * figures the map holds, which is what makes `assets − liabilities = Σ map`
   * exact with no tolerance (invariant I-22).
   */
  subtotal(side: ContributionSide, base: CurrencyCode): MoneyValue {
    return sum(
      this.bySide(side).map((c) => Money.fromMinor(c.base.minor < 0n ? -c.base.minor : c.base.minor, base)),
      base,
    );
  }

  /** `Σ base` over every contribution, signed. Equals `assets − liabilities`. */
  signedTotal(base: CurrencyCode): MoneyValue {
    return this.contributions().reduce(
      (acc, c) => add(acc, Money.fromMinor(c.base.minor, base)),
      Money.zero(base),
    );
  }

  get size(): number {
    return this.#entries.size + this.#excluded.size;
  }
}

/** Which side a signed amount lands on. Re-exported so callers need one import. */
export { sideOfAmount };
