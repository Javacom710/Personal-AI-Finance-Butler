import 'server-only';

/**
 * Prices (SCHEMA.md §5, [ADR-11](../../../docs/DECISIONS.md#adr-11--market-data-behind-a-provider-abstraction-with-an-always-available-manual-provider)).
 *
 * **A read never makes a network call.** This module reads what refresh jobs
 * have already written and classifies it; `services/market-data.ts` is the only
 * thing that talks to a provider, and it needs a `WriteCtx` to do so. One
 * consequence worth stating: a provider outage is invisible here, and only
 * becomes visible as a stored quote ages into `stale`.
 *
 * Three rules from the Phase 6 review shape this file:
 *
 * - **Freshness is measured in trading sessions, not wall-clock hours**
 *   ([ADR-28](../../../docs/DECISIONS.md#adr-28--staleness-is-measured-in-trading-sessions-not-wall-clock-hours)).
 *   The session calendar is read from `instrument_prices` — the price series
 *   *is* the calendar — so there is no calendar table to drift.
 * - **An unreconciled corporate action suppresses market value**
 *   ([ADR-29](../../../docs/DECISIONS.md#adr-29--provider-corporate-actions-are-detections-never-ledger-writes)),
 *   because post-split price × pre-split quantity is a large, internally
 *   consistent, wrong number.
 * - **A carried-back price is bounded** (finding M9): "greatest `as_of <= d`"
 *   without a bound values a dropped instrument at a years-old close forever.
 */

import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import { compareDates, daysBetween, isoDate, type IsoDate } from '../../lib/date';
import { currency, type CurrencyCode } from '../../lib/decimal/money';
import { UnitPrice, pToDbString } from '../../lib/decimal/price';
import { setManualPriceSchema, type SetManualPriceInput } from '../../lib/schemas/investments';
import { err, ok, type DomainError, type Result } from '../../lib/result';
import { classifyQuote, missing, type PriceResult } from '../domain/pricing/price-result';
import {
  cadenceForAssetClass,
  SESSION_BACKSTOP_DAYS,
  CONTINUOUS_BACKSTOP_DAYS,
  type Cadence,
} from '../market-data';
import { instrumentPrices, instrumentQuotes, instruments, settings } from '../db/schema';
import type { ReadCtx, WriteCtx } from './_ctx';
import { requireOwnership } from './_guards';
import { fieldErrors } from './_validation';

export interface StalenessSettings {
  readonly staleAfterHours: number;
  readonly staleAfterSessions: number;
}

export async function stalenessSettings(ctx: ReadCtx): Promise<StalenessSettings> {
  const [row] = await ctx.db
    .select({
      hours: settings.priceStaleAfterHours,
      sessions: settings.priceStaleAfterSessions,
    })
    .from(settings)
    .where(eq(settings.userId, ctx.userId))
    .limit(1);
  return {
    staleAfterHours: row?.hours ?? 24,
    staleAfterSessions: row?.sessions ?? 3,
  };
}

/** Retained for callers that only need the hours threshold. */
export async function priceStaleAfterHours(ctx: ReadCtx): Promise<number> {
  return (await stalenessSettings(ctx)).staleAfterHours;
}

/**
 * The sessions a market is known to have traded, ascending.
 *
 * Read from `instrument_prices`, because the price series **is** the trading
 * calendar (ADR-28): a date with a close is a session and a date without one is
 * not. That cannot drift from the prices it describes, needs no holiday list,
 * and is automatically correct for every exchange a provider covers.
 *
 * Keyed by exchange, with `''` standing for instruments that have none — mutual
 * funds share a NAV publication calendar of their own.
 */
export async function sessionCalendars(ctx: ReadCtx): Promise<Map<string, IsoDate[]>> {
  const { rows } = await ctx.db.execute<{ exchange: string | null; as_of: string }>(sql`
    select distinct coalesce(i.exchange, '') as exchange, p.as_of::text as as_of
      from ${instrumentPrices} p
      join ${instruments} i on i.id = p.instrument_id
     where i.user_id = ${ctx.userId}
     order by exchange, as_of
  `);

  const calendars = new Map<string, IsoDate[]>();
  for (const row of rows) {
    const market = row.exchange ?? '';
    const list = calendars.get(market) ?? [];
    list.push(isoDate(row.as_of));
    calendars.set(market, list);
  }
  return calendars;
}

/**
 * Instruments whose market value must be suppressed because a provider reported
 * a corporate action that is not in the ledger (ADR-29, finding M5).
 *
 * The test is not merely "a detection exists" but "the user **held units before
 * the ex-date**". Someone who bought after a split already has post-split
 * quantity, and their figures are correct; suppressing those would blank
 * holdings for no reason, which is its own kind of dishonesty.
 */
export async function suppressedInstrumentIds(ctx: ReadCtx): Promise<Set<string>> {
  const { rows } = await ctx.db.execute<{ instrument_id: string }>(sql`
    select distinct d.instrument_id
      from corporate_action_detections d
     where d.user_id = ${ctx.userId}
       and d.resolved_txn_id is null
       and d.dismissed_at is null
       and d.ex_date <= ${ctx.today}::date
       and exists (
         select 1 from tax_lots l
          where l.instrument_id = d.instrument_id
            and l.user_id = d.user_id
            and l.opened_on <= d.ex_date
       )
  `);
  return new Set(rows.map((r) => r.instrument_id));
}

/**
 * The latest price for each instrument, classified by age.
 *
 * An instrument with no quote gets `missing: 'no_provider'`, which is the
 * truthful reason: no adapter has produced one and nobody has typed a price.
 */
export async function quotesFor(
  ctx: ReadCtx,
  instrumentIds: readonly string[],
): Promise<Map<string, PriceResult>> {
  const out = new Map<string, PriceResult>();
  if (instrumentIds.length === 0) return out;

  const [thresholds, calendars, suppressed] = await Promise.all([
    stalenessSettings(ctx),
    sessionCalendars(ctx),
    suppressedInstrumentIds(ctx),
  ]);

  const rows = await ctx.db
    .select({
      instrumentId: instrumentQuotes.instrumentId,
      price: instrumentQuotes.price,
      quoteCurrency: instrumentQuotes.currencyCode,
      asOf: instrumentQuotes.asOf,
      source: instrumentQuotes.source,
      instrumentCurrency: instruments.currencyCode,
      assetClass: instruments.assetClass,
      exchange: instruments.exchange,
      userId: instruments.userId,
    })
    .from(instrumentQuotes)
    .innerJoin(instruments, eq(instruments.id, instrumentQuotes.instrumentId))
    .where(inArray(instrumentQuotes.instrumentId, [...instrumentIds]));

  for (const row of rows) {
    if (row.userId !== ctx.userId) continue;

    // Checked before the price is even classified: a suppressed instrument has
    // no usable value, and dressing one up with a freshness badge would imply
    // the figure is merely old rather than not computable.
    if (suppressed.has(row.instrumentId)) {
      out.set(row.instrumentId, missing('unreconciled_corporate_action'));
      continue;
    }

    const cadence = cadenceForAssetClass(row.assetClass);
    out.set(
      row.instrumentId,
      classifyQuote({
        price: UnitPrice.fromDbString(row.price),
        currency: currency(row.quoteCurrency.trim()),
        instrumentCurrency: currency(row.instrumentCurrency.trim()),
        asOf: row.asOf,
        source: row.source,
        now: ctx.now,
        staleAfterHours: thresholds.staleAfterHours,
        staleAfterSessions: thresholds.staleAfterSessions,
        cadence,
        today: ctx.today,
        sessions: calendars.get(row.exchange ?? '') ?? [],
      }),
    );
  }

  for (const id of instrumentIds) {
    if (!out.has(id)) {
      out.set(id, suppressed.has(id) ? missing('unreconciled_corporate_action') : missing('no_provider'));
    }
  }
  return out;
}

/**
 * Record a price the user typed.
 *
 * The currency is taken from the **instrument**, never from the input: a quote
 * in another currency is a provider error, and there is no user-facing reason to
 * be able to express one. `as_of` is when the price was *true*, which is why it
 * is an input rather than `now()` — a NAV entered on Monday for Friday's close
 * is Friday's price and should age from Friday.
 *
 * The write is **age-guarded** (invariant I-36, finding M7): entering a price
 * dated before the one already stored does not move the latest quote backwards.
 * A manual price does outrank a provider price at the same `as_of` — it is the
 * user asserting a fact about their own holding — and a manual price replaces an
 * earlier manual one, which is what correcting a typo looks like.
 */
export async function setManualPrice(
  ctx: WriteCtx,
  raw: unknown,
): Promise<Result<PriceResult, DomainError>> {
  const parsed = setManualPriceSchema.safeParse(raw);
  if (!parsed.success) return err(fieldErrors(parsed.error));
  const input: SetManualPriceInput = parsed.data;

  const [instrument] = await ctx.tx
    .select({
      id: instruments.id,
      userId: instruments.userId,
      symbol: instruments.symbol,
      currencyCode: instruments.currencyCode,
      assetClass: instruments.assetClass,
      exchange: instruments.exchange,
    })
    .from(instruments)
    .where(eq(instruments.id, input.instrumentId))
    .limit(1);

  const owned = requireOwnership(instrument, ctx.userId, 'instrument', input.instrumentId);
  if (!owned.ok) return owned;

  const instrumentCurrency: CurrencyCode = currency(owned.value.currencyCode.trim());
  const price = UnitPrice.of(input.price);
  const asOf = input.asOf === undefined ? ctx.now : new Date(input.asOf);

  await ctx.tx.execute(sql`
    insert into ${instrumentQuotes}
      (instrument_id, price, currency_code, as_of, source, fetched_at)
    values (
      ${owned.value.id},
      ${pToDbString(price)}::numeric,
      ${instrumentCurrency},
      ${asOf.toISOString()}::timestamptz,
      'manual',
      ${ctx.now.toISOString()}::timestamptz
    )
    on conflict (instrument_id) do update
       set price         = excluded.price,
           currency_code = excluded.currency_code,
           as_of         = excluded.as_of,
           source        = excluded.source,
           fetched_at    = excluded.fetched_at
     where excluded.as_of >= ${instrumentQuotes}.as_of
  `);

  await ctx.audit.record({
    actor: 'user',
    action: 'instrument.price_set',
    entityType: 'instrument',
    entityId: owned.value.id,
    after: { price: pToDbString(price), currency: instrumentCurrency, asOf: asOf.toISOString() },
  });

  const thresholds = await stalenessSettings(ctx);
  const calendars = await sessionCalendars(ctx);

  return ok(
    classifyQuote({
      price,
      currency: instrumentCurrency,
      instrumentCurrency,
      asOf,
      source: 'manual',
      now: ctx.now,
      staleAfterHours: thresholds.staleAfterHours,
      staleAfterSessions: thresholds.staleAfterSessions,
      cadence: cadenceForAssetClass(owned.value.assetClass),
      today: ctx.today,
      sessions: calendars.get(owned.value.exchange ?? '') ?? [],
    }),
  );
}

/**
 * Historical closes for a date range — the input TWR and the growth series need.
 *
 * Populated by `market-data`'s backfill and daily refresh. AMFI fills it for
 * Indian mutual funds today; equities and ETFs wait on the OD-3 adapter, and
 * until then both consumers correctly report a labelled gap rather than a
 * figure.
 */
export async function historicalCloses(
  ctx: ReadCtx,
  instrumentIds: readonly string[],
  from: string,
  to: string,
): Promise<Map<string, { readonly asOf: string; readonly close: string }[]>> {
  const out = new Map<string, { asOf: string; close: string }[]>();
  if (instrumentIds.length === 0) return out;

  // Built through the query builder rather than by interpolating ids into SQL
  // text: every value here is a bind parameter, so no caller can widen the
  // query by controlling an id.
  const rows = await ctx.db
    .select({
      instrumentId: instrumentPrices.instrumentId,
      asOf: instrumentPrices.asOf,
      close: instrumentPrices.close,
      userId: instruments.userId,
    })
    .from(instrumentPrices)
    .innerJoin(instruments, eq(instruments.id, instrumentPrices.instrumentId))
    .where(
      and(
        inArray(instrumentPrices.instrumentId, [...instrumentIds]),
        eq(instruments.userId, ctx.userId),
        gte(instrumentPrices.asOf, from),
        lte(instrumentPrices.asOf, to),
      ),
    )
    .orderBy(asc(instrumentPrices.instrumentId), asc(instrumentPrices.asOf));

  for (const row of rows) {
    const list = out.get(row.instrumentId) ?? [];
    list.push({ asOf: row.asOf, close: row.close });
    out.set(row.instrumentId, list);
  }
  return out;
}

/** How far back a close may be carried before the point becomes a gap. */
export function carryBackLimitDays(cadence: Cadence): number {
  return cadence === 'continuous' ? CONTINUOUS_BACKSTOP_DAYS : SESSION_BACKSTOP_DAYS;
}

export interface CarriedClose {
  readonly close: UnitPrice;
  readonly asOf: IsoDate;
  /** Days between the close's session and the date asked for. Zero on an exact hit. */
  readonly carriedDays: number;
}

/**
 * The close in force on `on`: the greatest `as_of <= on`, **bounded**.
 *
 * The carry-back is required — Sundays, market holidays and TWR boundary dates
 * all fall on days with no session, and `twr()` matches boundary dates exactly,
 * so without it a SIP dated on a holiday would return `insufficient_price_history`
 * forever.
 *
 * Unbounded, though, it lies: an instrument whose provider stopped covering it
 * in 2024 would be valued at its 2024 close for the rest of time with no gap
 * shown anywhere. Beyond the bound this returns `null`, and a `null` renders as
 * a break in the series with the instrument named — never as zero, and never as
 * a stale figure presented as current.
 */
export function closeAsOf(
  series: readonly { readonly asOf: string; readonly close: string }[],
  on: IsoDate,
  cadence: Cadence,
): CarriedClose | null {
  let best: { asOf: IsoDate; close: string } | null = null;

  for (const point of series) {
    const asOf = isoDate(point.asOf);
    if (compareDates(asOf, on) > 0) continue;
    if (best === null || compareDates(asOf, best.asOf) > 0) best = { asOf, close: point.close };
  }

  if (best === null) return null;

  // `daysBetween` is the domain's epoch-day arithmetic, already property-tested
  // across leap years and month ends. Hand-rolling it here with `Date.UTC` would
  // silently overflow a month boundary — 31 January plus a one-indexed month is
  // 3 March — and the bound would be wrong on exactly the dates that matter.
  const carriedDays = daysBetween(best.asOf, on);
  if (carriedDays > carryBackLimitDays(cadence)) return null;

  return { close: UnitPrice.fromDbString(best.close), asOf: best.asOf, carriedDays };
}
