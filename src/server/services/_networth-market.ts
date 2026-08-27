import 'server-only';

/**
 * The market-basis inputs net worth needs, and the price rule that reads them
 * ([FINANCIAL-DOMAIN.md §9.3](../../../docs/FINANCIAL-DOMAIN.md#93-calculation),
 * [MARKET-VALUE-NET-WORTH-DESIGN.md §3](../../../docs/MARKET-VALUE-NET-WORTH-DESIGN.md#3-price-selection)).
 *
 * ```
 * marketValue(p, T) = quantityHeldOn(p, T) × priceOn(instrument, T) × fxRateOn(instrumentCcy → base, T)
 * ```
 *
 * This module owns the first two factors; `ctx.fx` already owns the third. It is
 * a **loader and a selector**, not a calculator: no money arithmetic happens
 * here, which is what keeps the valuation itself in `domain/`.
 *
 * Four rules from the canonical documents shape it, and each is the opposite of
 * a plausible shortcut:
 *
 * - **`positions` cannot answer an as-of question** ([ADR-06](../../../docs/DECISIONS.md#adr-06--holdings-are-derived-cached-and-rebuildable),
 *   invariant **I-47**). It is today's cache with no date bound, and the
 *   temptation is stronger here than anywhere else in the design because
 *   `positions.quantity` looks exactly like what is wanted. Quantity comes from
 *   the **ledger**, replayed, with every corporate-action ratio applied (**I-46**).
 * - **A read makes no network call.** Everything below reads what a refresh job
 *   already stored; a provider outage is invisible here and becomes visible only
 *   as a stored quote ageing into `stale` ([ADR-11](../../../docs/DECISIONS.md#adr-11--market-data-behind-a-provider-abstraction-with-an-always-available-manual-provider)).
 * - **A carried-back close is bounded.** Beyond the bound the point is a gap, not
 *   a value — otherwise an instrument the provider dropped in 2024 holds a 2024
 *   price for ever.
 * - **An unreconciled corporate action suppresses the value entirely**
 *   ([ADR-29](../../../docs/DECISIONS.md#adr-29--provider-corporate-actions-are-detections-never-ledger-writes)),
 *   because post-split price × pre-split quantity is a large, internally
 *   consistent, wrong number. Suppression is evaluated **at the valuation date**,
 *   not at today: before the ex-date price and quantity sit on the same side of
 *   the action and the figure is correct.
 */

import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import {
  addDays,
  compareDates,
  fromUtcDate,
  isoDate,
  toUtcDate,
  type IsoDate,
} from '../../lib/date';
import { Money, currency, type CurrencyCode } from '../../lib/decimal/money';
import { Quantity, type Quantity as Qty } from '../../lib/decimal/quantity';
import { Rate } from '../../lib/decimal/rate';
import type { UnitPrice } from '../../lib/decimal/price';
import { replay, type ReplayTxn } from '../domain/lots/engine';
import type { CostBasisMethod } from '../domain/lots/fifo';
import type { InvestmentKind } from '../domain/lots/order';
import { quantityHeldOn, type QuantityTimeline } from '../domain/lots/quantity';
import type { ExclusionReason } from '../domain/networth/keys';
import { isUsable, type PriceResult } from '../domain/pricing/price-result';
import { indexCloses, type PriceSeriesIndex } from '../domain/pricing/price-series';
import { carryBackLimitDays } from '../domain/pricing/price-series';
import { cadenceForAssetClass, classifyFreshness, type Freshness } from '../market-data/freshness';
import { exchangeCloseInstant, resolveMic } from '../market-data/exchanges';
import type { Cadence } from '../market-data/types';
import { instrumentPrices, instruments, investmentTransactions } from '../db/schema';
import type { ReadCtx } from './_ctx';
import { quotesFor, sessionCalendars, stalenessSettings, type StalenessSettings } from './prices';

/** The `(account, instrument)` key a position contributes under, as a string. */
export const positionKeyId = (accountId: string, instrumentId: string): string =>
  `${accountId}:${instrumentId}`;

export interface MarketInstrument {
  readonly id: string;
  readonly symbol: string;
  readonly exchange: string | null;
  readonly currency: CurrencyCode;
  readonly cadence: Cadence;
}

/**
 * One open detection's suppression window.
 *
 * The test is not merely *"a detection exists"* but *"units were held before the
 * ex-date"*: someone who bought after a split already has post-split quantity and
 * their figures are correct, so suppressing those would blank a holding for no
 * reason — its own kind of dishonesty.
 */
export interface SuppressionWindow {
  readonly instrumentId: string;
  readonly exDate: IsoDate;
}

export interface MarketSources {
  readonly instruments: ReadonlyMap<string, MarketInstrument>;
  /** Keyed by `positionKeyId`. Ratio-aware, from the ledger — never from `positions`. */
  readonly timelines: ReadonlyMap<string, QuantityTimeline>;
  /** The latest quote per instrument, classified. The **today** path only. */
  readonly quotes: ReadonlyMap<string, PriceResult>;
  /** Sorted once, binary-searched per point. The **historical** path. */
  readonly closes: ReadonlyMap<string, PriceSeriesIndex>;
  /**
   * Instruments with **any** stored observation, unwindowed.
   *
   * `closes` is bounded by the series' own range, so an empty index there means
   * *"nothing in this window"* — which is a different statement from *"this
   * instrument has no price source"*. Conflating them would tell a user to enter
   * a price by hand for a date that has one everywhere else in the series
   * (**I-45**).
   */
  readonly priced: ReadonlySet<string>;
  /** Ascending sessions per exchange, `''` for instruments with none. */
  readonly sessions: ReadonlyMap<string, readonly IsoDate[]>;
  readonly suppressions: readonly SuppressionWindow[];
  readonly thresholds: StalenessSettings;
}

// ------------------------------------------------------------------ the fetch

interface LedgerRow {
  [column: string]: unknown;
  id: string;
  account_id: string;
  instrument_id: string;
  kind: InvestmentKind;
  trade_date: string;
  created_at: Date;
  quantity: string | null;
  gross_amount: string | null;
  fees: string;
  taxes: string;
  net_amount_instrument: string;
  ratio_num: number | null;
  ratio_den: number | null;
  original_acquired_on: string | null;
}

/**
 * Everything the market basis needs, fetched **once** regardless of how many
 * dates follow — the same shape `loadSources()` already established for the cost
 * basis (D-31).
 *
 * `window` bounds the price fetch. A series must pass its **own** range rather
 * than fetching everything ([§13](../../../docs/MARKET-VALUE-NET-WORTH-DESIGN.md#13-performance));
 * the range is widened backwards by the carry-back limit so the first point can
 * still reach the session before it.
 */
export async function loadMarketSources(
  ctx: ReadCtx,
  window: { readonly from: IsoDate; readonly to: IsoDate },
): Promise<MarketSources> {
  const [instrumentRows, ledger, thresholds, sessions, suppressions] = await Promise.all([
    ctx.db
      .select({
        id: instruments.id,
        symbol: instruments.symbol,
        exchange: instruments.exchange,
        currencyCode: instruments.currencyCode,
        assetClass: instruments.assetClass,
        costBasisMethod: instruments.costBasisMethod,
      })
      .from(instruments)
      // No `is_active` filter, deliberately and permanently: an instrument
      // deactivated this morning must still be priced in last year's figure (I-26, I-47).
      .where(eq(instruments.userId, ctx.userId)),

    ctx.db.execute<LedgerRow>(sql`
      select id::text, account_id::text as account_id, instrument_id::text as instrument_id,
             kind::text as kind, trade_date::text, created_at,
             quantity::text, gross_amount::text, fees::text, taxes::text,
             net_amount_instrument::text, ratio_num, ratio_den,
             original_acquired_on::text
        from ${investmentTransactions}
       where user_id = ${ctx.userId} and instrument_id is not null
       order by account_id, instrument_id, trade_date asc, created_at asc, id asc
    `),

    stalenessSettings(ctx),
    sessionCalendars(ctx),

    // Open, undismissed, and only where units were actually held before the
    // ex-date. `ex_date` is carried so suppression can be evaluated AT the
    // valuation date rather than at today.
    ctx.db.execute<{ instrument_id: string; ex_date: string }>(sql`
      select distinct d.instrument_id::text as instrument_id, d.ex_date::text as ex_date
        from corporate_action_detections d
       where d.user_id = ${ctx.userId}
         and d.resolved_txn_id is null
         and d.dismissed_at is null
         and exists (
           select 1 from tax_lots l
            where l.instrument_id = d.instrument_id
              and l.user_id = d.user_id
              and l.opened_on <= d.ex_date
         )
    `),
  ]);

  const instrumentById = new Map<string, MarketInstrument>();
  const methodById = new Map<string, CostBasisMethod>();
  for (const row of instrumentRows) {
    instrumentById.set(row.id, {
      id: row.id,
      symbol: row.symbol,
      exchange: row.exchange,
      currency: currency(row.currencyCode.trim()),
      cadence: cadenceForAssetClass(row.assetClass),
    });
    methodById.set(row.id, row.costBasisMethod as CostBasisMethod);
  }

  const timelines = buildTimelines(ledger.rows as LedgerRow[], instrumentById, methodById);

  const instrumentIds = [...instrumentById.keys()];
  const closes = await loadCloseIndexes(ctx, instrumentIds, instrumentById, window);
  const quotes = await quotesFor(ctx, instrumentIds);
  const priced = await pricedInstrumentIds(ctx);

  return {
    instruments: instrumentById,
    timelines,
    quotes,
    closes,
    priced,
    sessions,
    suppressions: suppressions.rows.map((row) => ({
      instrumentId: row.instrument_id,
      exDate: isoDate(row.ex_date),
    })),
    thresholds,
  };
}

/**
 * One quantity timeline per `(account, instrument)`, from the ledger.
 *
 * **The FX rate handed to `replay()` is the identity, and every money figure it
 * returns is discarded.** Only `quantityTimeline` is read here, and quantity is
 * denominated in units rather than in any currency — so there is no rate to be
 * wrong about. Resolving a real rate would make a *quantity* read fail whenever
 * an FX row happened to be missing, which is a failure with no cause.
 */
function buildTimelines(
  rows: readonly LedgerRow[],
  instrumentById: ReadonlyMap<string, MarketInstrument>,
  methodById: ReadonlyMap<string, CostBasisMethod>,
): Map<string, QuantityTimeline> {
  const grouped = new Map<string, LedgerRow[]>();
  for (const row of rows) {
    const key = positionKeyId(row.account_id, row.instrument_id);
    const list = grouped.get(key);
    if (list) list.push(row);
    else grouped.set(key, [row]);
  }

  const out = new Map<string, QuantityTimeline>();

  for (const [key, group] of grouped) {
    const instrumentId = group[0]!.instrument_id;
    const instrument = instrumentById.get(instrumentId);
    if (!instrument) continue; // another user's instrument; the join above cannot produce one

    const txns: ReplayTxn[] = group.map((row) => {
      const tradeDate = isoDate(row.trade_date);
      return {
        id: row.id,
        kind: row.kind,
        tradeDate,
        createdAt: row.created_at,
        quantity: row.quantity === null ? null : Quantity.fromDbString(row.quantity),
        grossAmount:
          row.gross_amount === null
            ? null
            : Money.fromDbString(row.gross_amount, instrument.currency),
        fees: Money.fromDbString(row.fees, instrument.currency),
        taxes: Money.fromDbString(row.taxes, instrument.currency),
        netAmountInstrument: Money.fromDbString(row.net_amount_instrument, instrument.currency),
        ratioNum: row.ratio_num,
        ratioDen: row.ratio_den,
        originalAcquiredOn:
          row.original_acquired_on === null ? null : isoDate(row.original_acquired_on),
        fxInstrumentToBase: Rate.one(),
      };
    });

    const replayed = replay(txns, {
      method: methodById.get(instrumentId) ?? 'fifo',
      currency: instrument.currency,
      // Identical to the instrument currency, so no conversion happens at all.
      baseCurrency: instrument.currency,
    });

    if (!replayed.ok) {
      // The stored ledger already replayed successfully when it was written, and
      // the rebuild shares the mutation's transaction. Reaching here means the
      // ledger was changed behind the service — a data-integrity fault, and a bug
      // should be loud rather than silently reporting zero units held.
      throw new Error(
        `Net worth at market: replaying ${instrument.symbol} for the quantity timeline failed ` +
          `with '${replayed.error.kind}' on ${replayed.error.tradeDate}. The ledger is valid when ` +
          'written, so this means rows were changed outside the service.',
      );
    }

    out.set(key, replayed.value.quantityTimeline);
  }

  return out;
}

/**
 * Every instrument that has **ever** had an observation stored.
 *
 * Distinct ids only — a set membership test, not a series. It exists to keep
 * *"no price source"* and *"no price on this date"* apart, which are different
 * instructions to the user.
 */
async function pricedInstrumentIds(ctx: ReadCtx): Promise<Set<string>> {
  const { rows } = await ctx.db.execute<{ instrument_id: string }>(sql`
    select distinct p.instrument_id::text as instrument_id
      from ${instrumentPrices} p
      join ${instruments} i on i.id = p.instrument_id
     where i.user_id = ${ctx.userId}
  `);
  return new Set(rows.map((row) => row.instrument_id));
}

/** Historical closes for the window, indexed per instrument (one sort, then binary search). */
async function loadCloseIndexes(
  ctx: ReadCtx,
  instrumentIds: readonly string[],
  instrumentById: ReadonlyMap<string, MarketInstrument>,
  window: { readonly from: IsoDate; readonly to: IsoDate },
): Promise<Map<string, PriceSeriesIndex>> {
  const out = new Map<string, PriceSeriesIndex>();
  if (instrumentIds.length === 0) return out;

  // Widened backwards by the largest carry-back limit, so the first point of a
  // series can still reach the session before it. Never widened forwards: a later
  // price must not reach an earlier date.
  const from = addDays(window.from, -carryBackLimitDays('eod'));

  const rows = await ctx.db
    .select({
      instrumentId: instrumentPrices.instrumentId,
      asOf: instrumentPrices.asOf,
      close: instrumentPrices.close,
    })
    .from(instrumentPrices)
    .innerJoin(instruments, eq(instruments.id, instrumentPrices.instrumentId))
    .where(
      and(
        inArray(instrumentPrices.instrumentId, [...instrumentIds]),
        eq(instruments.userId, ctx.userId),
        gte(instrumentPrices.asOf, from),
        lte(instrumentPrices.asOf, window.to),
      ),
    );

  const grouped = new Map<string, { asOf: string; close: string }[]>();
  for (const row of rows) {
    const list = grouped.get(row.instrumentId);
    if (list) list.push({ asOf: row.asOf, close: row.close });
    else grouped.set(row.instrumentId, [{ asOf: row.asOf, close: row.close }]);
  }

  for (const [instrumentId, series] of grouped) {
    const cadence = instrumentById.get(instrumentId)?.cadence ?? 'eod';
    out.set(instrumentId, indexCloses(series, cadence));
  }

  return out;
}

// ------------------------------------------------------------- price selection

/** A price that can be used, with everything the reconciliation needs to explain it. */
export interface UsableAt {
  readonly ok: true;
  readonly price: UnitPrice;
  /** The session the observation belongs to. *"Priced as of …"*. */
  readonly tradingDate: IsoDate;
  readonly freshness: Freshness;
  readonly source: string;
  /** Days between that session and the date asked for. Zero on an exact hit. */
  readonly carriedDays: number;
}

export type ResolvedPrice = UsableAt | { readonly ok: false; readonly reason: ExclusionReason };

/**
 * The price in force for one instrument on one date.
 *
 * | Question | Answered by |
 * |---|---|
 * | today | the stored quote, classified — freshness, suppression, currency guard |
 * | as of `T` | the greatest `instrument_prices.as_of <= T`, **bounded** |
 *
 * Both paths run through the same suppression test and both report a freshness
 * verdict, so a figure explains itself identically whichever produced it. Routing
 * today through the quote is what keeps the last point of a series ending today
 * identical to `netWorthAsOf(today)` (**I-29**).
 */
export function priceAt(
  market: MarketSources,
  instrument: MarketInstrument,
  asOf: IsoDate,
  today: IsoDate,
): ResolvedPrice {
  if (suppressedAt(market.suppressions, instrument.id, asOf)) {
    return { ok: false, reason: 'unreconciled_corporate_action' };
  }

  return asOf === today
    ? fromQuote(market.quotes.get(instrument.id))
    : fromHistory(market, instrument, asOf);
}

/**
 * Suppressed when an open detection's ex-date has passed **by the valuation
 * date**. Before it, price and quantity are on the same side of the action and
 * the figure is correct — suppressing then would blank a holding that is right.
 */
function suppressedAt(
  suppressions: readonly SuppressionWindow[],
  instrumentId: string,
  asOf: IsoDate,
): boolean {
  return suppressions.some(
    (s) => s.instrumentId === instrumentId && compareDates(s.exDate, asOf) <= 0,
  );
}

function fromQuote(quote: PriceResult | undefined): ResolvedPrice {
  if (quote === undefined) return { ok: false, reason: 'no_provider' };
  if (!isUsable(quote)) return { ok: false, reason: quote.reason };

  return {
    ok: true,
    price: quote.price,
    tradingDate: fromUtcDate(quote.asOf),
    freshness: quote.freshness,
    source: quote.source,
    carriedDays: 0,
  };
}

/**
 * A historical close, with its staleness measured **as of that date**.
 *
 * A stale historical observation is a different thing from a stale current one:
 * *"nine sessions behind on 3 March 2025"* is a property of the point, not of
 * now. So the classifier is given `today: T` and the sessions known **up to
 * `T`** — feeding it the whole calendar would count sessions that had not
 * happened yet and report every historical point as stale.
 */
function fromHistory(
  market: MarketSources,
  instrument: MarketInstrument,
  asOf: IsoDate,
): ResolvedPrice {
  // No adapter has ever produced an observation and nobody has typed a price:
  // the user has to act, and the reason says which act.
  if (!market.priced.has(instrument.id)) return { ok: false, reason: 'no_provider' };

  const index = market.closes.get(instrument.id);
  const carried = index === undefined ? null : index.closeAsOf(asOf);

  // Beyond the carry-back bound, before the first stored observation, or outside
  // the fetched window. The point is a GAP — never zero, and never the cost
  // figure (I-38, I-39).
  if (carried === null) return { ok: false, reason: 'no_price_on_date' };

  const calendar = market.sessions.get(instrument.exchange ?? '') ?? [];
  const upToDate = calendar.filter((session) => compareDates(session, asOf) <= 0);

  const verdict = classifyFreshness({
    cadence: instrument.cadence,
    tradingDate: carried.asOf,
    observedAt: instantOf(instrument, carried.asOf),
    now: instantOf(instrument, asOf),
    today: asOf,
    sessions: upToDate,
    thresholds: market.thresholds,
  });

  return {
    ok: true,
    price: carried.close,
    tradingDate: carried.asOf,
    freshness: verdict.freshness,
    source: 'instrument_prices',
    carriedDays: carried.carriedDays,
  };
}

/**
 * The instant a trading date's value was true.
 *
 * The exchange's official close where the venue is known, midnight UTC where it
 * is not — a mutual fund has no exchange, and its NAV cadence is measured in
 * sessions rather than hours anyway. Both dates in a comparison go through this
 * one function, so the ages it produces are consistent even on the fallback.
 */
function instantOf(instrument: MarketInstrument, on: IsoDate): Date {
  const venue = resolveMic(instrument.exchange);
  return (venue === null ? null : exchangeCloseInstant(venue, on)) ?? toUtcDate(on);
}

/** Units held on a date — ratio-aware, from the ledger, never from `positions`. */
export function unitsHeldOn(
  market: MarketSources,
  accountId: string,
  instrumentId: string,
  asOf: IsoDate,
): Qty {
  const timeline = market.timelines.get(positionKeyId(accountId, instrumentId));
  return timeline === undefined ? Quantity.zero() : quantityHeldOn(timeline, asOf);
}
