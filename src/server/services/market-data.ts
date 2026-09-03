import 'server-only';

/**
 * The market-data write path — the only place a provider observation becomes a
 * stored row.
 *
 * Everything here is a **command**: it takes a `WriteCtx`, so a caller that can
 * only build a `ReadCtx` cannot reach it at all. That is the same structural
 * guarantee the rest of the service layer relies on (ADR-21), and it is what
 * makes "a page render never fetches a price" true by type rather than by
 * convention.
 *
 * Three invariants are enforced here because nothing else can enforce them:
 *
 * - **I-33 / I-34** — an observation whose currency is not the instrument's is
 *   rejected. The database cannot express a cross-table equality, and a price in
 *   the wrong currency multiplied by a quantity is silently wrong.
 * - **I-35** — one `source` per price series
 *   ([ADR-30](../../../docs/DECISIONS.md#adr-30--one-provider-per-instrument-price-series-the-only-price-fallback-is-manual)).
 *   Two vendors' closes differ, and a blended series makes the splice
 *   indistinguishable from a real price move.
 * - **I-36** — the latest-quote write is age-guarded, so a late-arriving
 *   response cannot overwrite a newer quote and a refresh cannot silently
 *   replace a price the user just typed.
 *
 * And one rule that is not an invariant but a boundary: **no function in this
 * file writes to `investment_transactions`**
 * ([ADR-29](../../../docs/DECISIONS.md#adr-29--provider-corporate-actions-are-detections-never-ledger-writes)).
 * A provider's corporate action becomes a detection and nothing more.
 */

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { isoDate, type IsoDate } from '../../lib/date';
import { currency, type CurrencyCode } from '../../lib/decimal/money';
import { pToDbString } from '../../lib/decimal/price';
import { rToDbString } from '../../lib/decimal/rate';
import { err, ok, type DomainError, type Result } from '../../lib/result';
import { conflict } from '../../lib/result';
import { log } from '../log';
import {
  corporateActionDetections,
  fxRates,
  instrumentPrices,
  instrumentQuotes,
  instruments,
  positions,
} from '../db/schema';
import {
  cadenceForAssetClass,
  describeFailure,
  pairKey,
  type CorporateActionObservation,
  type CurrencyPair,
  type FxObservation,
  type PriceObservation,
  type ProviderKey,
  type ProviderRef,
  type Registry,
} from '../market-data';
import { resolveMic } from '../market-data/exchanges';
import type { AssetClass } from '../domain/pricing/valuation';
import type { ReadCtx, WriteCtx } from './_ctx';

// ------------------------------------------------------------------ refs

/** Every instrument the user still holds, as something a provider can be asked about. */
export async function heldInstrumentRefs(ctx: ReadCtx): Promise<readonly ProviderRef[]> {
  const rows = await ctx.db
    .select({
      id: instruments.id,
      symbol: instruments.symbol,
      providerSymbol: instruments.providerSymbol,
      exchange: instruments.exchange,
      isin: instruments.isin,
      currencyCode: instruments.currencyCode,
      assetClass: instruments.assetClass,
      priceProvider: instruments.priceProvider,
      quantity: positions.quantity,
    })
    .from(instruments)
    .innerJoin(positions, eq(positions.instrumentId, instruments.id))
    .where(eq(instruments.userId, ctx.userId));

  const seen = new Set<string>();
  const refs: ProviderRef[] = [];

  for (const row of rows) {
    // A fully disposed position is retained for its realised-P&L history
    // (edge case 18) and has nothing to price.
    if (Number(row.quantity) === 0) continue;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    refs.push(toRef(row));
  }
  return refs;
}

export async function instrumentRef(ctx: ReadCtx, instrumentId: string): Promise<ProviderRef | null> {
  const [row] = await ctx.db
    .select({
      id: instruments.id,
      symbol: instruments.symbol,
      providerSymbol: instruments.providerSymbol,
      exchange: instruments.exchange,
      isin: instruments.isin,
      currencyCode: instruments.currencyCode,
      assetClass: instruments.assetClass,
      priceProvider: instruments.priceProvider,
    })
    .from(instruments)
    .where(and(eq(instruments.id, instrumentId), eq(instruments.userId, ctx.userId)))
    .limit(1);

  return row ? toRef(row) : null;
}

interface InstrumentRow {
  id: string;
  symbol: string;
  providerSymbol: string | null;
  exchange: string | null;
  isin: string | null;
  currencyCode: string;
  assetClass: string;
  priceProvider: string | null;
}

function toRef(row: InstrumentRow): ProviderRef {
  return {
    instrumentId: row.id,
    // `provider_symbol` is the lookup key where set; the human symbol is the
    // fallback, which is what a user who typed a scheme code straight in gets.
    providerSymbol: (row.providerSymbol ?? row.symbol).trim(),
    // `instruments.exchange` is free text a user typed — `NSE`, not `XNSE` —
    // so it is *resolved*, never asserted. `resolveMic` returns null for
    // anything it cannot map, and an adapter that needs a venue then refuses
    // the instrument. Calling `mic()` here instead would throw on the ordinary
    // stored value and take the whole refresh down with it.
    exchange: resolveMic(row.exchange),
    isin: row.isin?.trim() ?? null,
    currency: currency(row.currencyCode.trim()),
    assetClass: row.assetClass as AssetClass,
  };
}

export async function pinnedProviderFor(ctx: ReadCtx, instrumentId: string): Promise<ProviderKey | null> {
  const [row] = await ctx.db
    .select({ provider: instruments.priceProvider })
    .from(instruments)
    .where(and(eq(instruments.id, instrumentId), eq(instruments.userId, ctx.userId)))
    .limit(1);
  return (row?.provider as ProviderKey | null) ?? null;
}

// ------------------------------------------------------------- price writes

export type RejectionReason =
  | 'unknown_instrument'
  | 'currency_mismatch'
  | 'source_conflict'
  | 'superseded';

export interface StoreOutcome {
  readonly stored: number;
  readonly quotesAdvanced: number;
  readonly rejected: readonly { readonly instrumentId: string; readonly reason: RejectionReason }[];
}

/**
 * Persist price observations.
 *
 * Every observation is checked against the instrument it claims to describe
 * before anything is written, and a rejection is **named** rather than dropped:
 * a refresh that silently skipped half its instruments would look identical to
 * one that succeeded.
 */
export async function storePriceObservations(
  ctx: WriteCtx,
  observations: readonly PriceObservation[],
): Promise<StoreOutcome> {
  const rejected: { instrumentId: string; reason: RejectionReason }[] = [];
  let stored = 0;
  let quotesAdvanced = 0;

  if (observations.length === 0) return { stored, quotesAdvanced, rejected };

  const ids = [...new Set(observations.map((o) => o.instrumentId))];
  const owned = await ctx.tx
    .select({ id: instruments.id, currencyCode: instruments.currencyCode })
    .from(instruments)
    .where(and(eq(instruments.userId, ctx.userId), inArray(instruments.id, ids)));

  const currencyById = new Map(owned.map((r) => [r.id, currency(r.currencyCode.trim())]));

  // One `source` per series (I-35). Read once for the whole batch rather than
  // per row, so a 30-instrument refresh is one query and not thirty.
  const existingSources = await ctx.tx
    .select({ instrumentId: instrumentPrices.instrumentId, source: instrumentPrices.source })
    .from(instrumentPrices)
    .where(inArray(instrumentPrices.instrumentId, ids))
    .groupBy(instrumentPrices.instrumentId, instrumentPrices.source);

  const seriesSource = new Map<string, string>();
  for (const row of existingSources) seriesSource.set(row.instrumentId, row.source);

  for (const observation of observations) {
    const instrumentCurrency = currencyById.get(observation.instrumentId);
    if (instrumentCurrency === undefined) {
      rejected.push({ instrumentId: observation.instrumentId, reason: 'unknown_instrument' });
      continue;
    }

    // I-33 / I-34. The cross-table rule the database cannot express.
    if (observation.currency !== instrumentCurrency) {
      rejected.push({ instrumentId: observation.instrumentId, reason: 'currency_mismatch' });
      continue;
    }

    const pinnedSource = seriesSource.get(observation.instrumentId);
    if (pinnedSource !== undefined && pinnedSource !== observation.source) {
      // Refused, not interleaved. Changing a provider is an explicit act that
      // purges and re-backfills (ADR-30).
      rejected.push({ instrumentId: observation.instrumentId, reason: 'source_conflict' });
      continue;
    }

    await ctx.tx
      .insert(instrumentPrices)
      .values({
        instrumentId: observation.instrumentId,
        asOf: observation.tradingDate,
        close: pToDbString(observation.close),
        currencyCode: observation.currency,
        source: observation.source,
        providerRef: observation.providerRef,
        fetchedAt: ctx.now,
      })
      .onConflictDoUpdate({
        target: [instrumentPrices.instrumentId, instrumentPrices.asOf],
        set: {
          close: pToDbString(observation.close),
          currencyCode: observation.currency,
          source: observation.source,
          providerRef: observation.providerRef,
          fetchedAt: ctx.now,
        },
      });
    stored += 1;
    seriesSource.set(observation.instrumentId, observation.source);

    if (await advanceQuote(ctx, observation)) quotesAdvanced += 1;
  }

  return { stored, quotesAdvanced, rejected };
}

/**
 * Move `instrument_quotes` forward — and only forward (I-36).
 *
 * Two ways this write can be wrong, and the `WHERE` refuses both:
 *
 * 1. A response that arrives late, or a backfill running after a daily refresh,
 *    carrying an **older** observation than the one already stored.
 * 2. A provider price landing on top of a price the **user** typed for the same
 *    date. A manual price is a user's assertion about their own holding and
 *    outranks a feed at equal `as_of`; a *newer* provider price still wins,
 *    because it is genuinely later information.
 */
async function advanceQuote(ctx: WriteCtx, observation: PriceObservation): Promise<boolean> {
  const result = await ctx.tx.execute<{ instrument_id: string }>(sql`
    insert into ${instrumentQuotes}
      (instrument_id, price, currency_code, as_of, source, fetched_at)
    values (
      ${observation.instrumentId},
      ${pToDbString(observation.close)}::numeric,
      ${observation.currency},
      ${observation.observedAt.toISOString()}::timestamptz,
      ${observation.source},
      ${ctx.now.toISOString()}::timestamptz
    )
    on conflict (instrument_id) do update
       set price         = excluded.price,
           currency_code = excluded.currency_code,
           as_of         = excluded.as_of,
           source        = excluded.source,
           fetched_at    = excluded.fetched_at
     where excluded.as_of > ${instrumentQuotes}.as_of
        or (excluded.as_of = ${instrumentQuotes}.as_of
            and (${instrumentQuotes}.source <> 'manual' or excluded.source = 'manual'))
    returning instrument_id
  `);
  return result.rows.length > 0;
}

// ---------------------------------------------------------------- fx writes

/**
 * Persist FX observations.
 *
 * `fx_rates` is reference data with no `user_id`: a rate is a market-wide fact,
 * not one user's opinion of one. `(base, quote, as_of)` is its natural key, so a
 * re-run on the same day is an update rather than a duplicate.
 *
 * Unlike a price series, FX **may** come from more than one source
 * ([ADR-30](../../../docs/DECISIONS.md#adr-30--one-provider-per-instrument-price-series-the-only-price-fallback-is-manual)) —
 * a rate is not an instrument-specific series, so there is no continuity to
 * splice. `source` still records which feed each row came from.
 */
export async function storeFxObservations(
  ctx: WriteCtx,
  observations: readonly FxObservation[],
): Promise<number> {
  let stored = 0;
  for (const observation of observations) {
    await ctx.tx
      .insert(fxRates)
      .values({
        baseCode: observation.base,
        quoteCode: observation.quote,
        asOf: observation.asOf,
        rate: rToDbString(observation.rate),
        source: observation.source,
        fetchedAt: ctx.now,
      })
      .onConflictDoUpdate({
        target: [fxRates.baseCode, fxRates.quoteCode, fxRates.asOf],
        set: {
          rate: rToDbString(observation.rate),
          source: observation.source,
          fetchedAt: ctx.now,
        },
      });
    stored += 1;
  }
  return stored;
}

/**
 * The currencies this user's data actually needs converted, paired against base.
 *
 * Derived rather than configured, so a newly added foreign instrument is covered
 * by the next refresh without anyone remembering to add it.
 */
export async function requiredFxPairs(ctx: ReadCtx): Promise<readonly CurrencyPair[]> {
  const { rows } = await ctx.db.execute<{ code: string }>(sql`
    select distinct currency_code as code from accounts     where user_id = ${ctx.userId}
    union
    select distinct currency_code as code from instruments  where user_id = ${ctx.userId}
    union
    select distinct currency_code as code from manual_assets where user_id = ${ctx.userId}
    union
    select distinct currency_code as code from liabilities  where user_id = ${ctx.userId}
  `);

  const pairs: CurrencyPair[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const code = currency(row.code.trim());
    if (code === ctx.base) continue; // identity needs no row
    const pair: CurrencyPair = { base: code, quote: ctx.base };
    if (seen.has(pairKey(pair))) continue;
    seen.add(pairKey(pair));
    pairs.push(pair);
  }
  return pairs;
}

export interface FxRefreshOutcome {
  readonly requested: number;
  readonly stored: number;
  readonly failed: readonly { readonly pair: string; readonly reason: string }[];
}

/**
 * Fetch and store the rates this user needs.
 *
 * Pairs are requested **quoted against the base currency** so the provider
 * computes any cross server-side and `selectRate` finds a direct row — finding
 * **M1**. Triangulation in the domain remains the safety net for a pair that was
 * never requested, not the everyday path.
 */
export async function refreshFxRates(
  ctx: WriteCtx,
  registry: Registry,
  on?: IsoDate,
): Promise<FxRefreshOutcome> {
  const pairs = await requiredFxPairs(ctx);
  if (pairs.length === 0) return { requested: 0, stored: 0, failed: [] };

  const results = await registry.fxRates(pairs, on);
  const observations: FxObservation[] = [];
  const failed: { pair: string; reason: string }[] = [];

  for (const pair of pairs) {
    const result = results.get(pairKey(pair));
    if (result === undefined) {
      failed.push({ pair: pairKey(pair), reason: 'no result returned' });
      continue;
    }
    if (!result.ok) {
      failed.push({ pair: pairKey(pair), reason: describeFailure(result.error) });
      continue;
    }
    observations.push(result.value);
  }

  const stored = await storeFxObservations(ctx, observations);
  return { requested: pairs.length, stored, failed };
}

// ------------------------------------------------------------- price refresh

export interface PriceRefreshOutcome {
  readonly requested: number;
  readonly stored: number;
  readonly quotesAdvanced: number;
  readonly failed: readonly { readonly instrumentId: string; readonly reason: string }[];
  readonly rejected: readonly { readonly instrumentId: string; readonly reason: RejectionReason }[];
}

export async function refreshPrices(ctx: WriteCtx, registry: Registry): Promise<PriceRefreshOutcome> {
  const refs = await heldInstrumentRefs(ctx);
  if (refs.length === 0) {
    return { requested: 0, stored: 0, quotesAdvanced: 0, failed: [], rejected: [] };
  }

  const pinned = new Map<string, ProviderKey | null>();
  for (const ref of refs) {
    pinned.set(ref.instrumentId, await pinnedProviderFor(ctx, ref.instrumentId));
  }

  const results = await registry.latestPrices(refs, (ref) => pinned.get(ref.instrumentId) ?? null);

  const observations: PriceObservation[] = [];
  const failed: { instrumentId: string; reason: string }[] = [];

  for (const ref of refs) {
    const result = results.get(ref.instrumentId);
    if (result === undefined || !result.ok) {
      // A provider that cannot answer leaves the previous quote in place. It
      // will age into `stale` and say so, which is the honest outcome — far
      // better than blanking a holding because a feed had a bad morning.
      failed.push({
        instrumentId: ref.instrumentId,
        reason: result === undefined ? 'no result returned' : describeFailure(result.error),
      });
      continue;
    }
    observations.push(result.value);
  }

  const outcome = await storePriceObservations(ctx, observations);
  return {
    requested: refs.length,
    stored: outcome.stored,
    quotesAdvanced: outcome.quotesAdvanced,
    failed,
    rejected: outcome.rejected,
  };
}

/**
 * Backfill one instrument's history.
 *
 * The only operation that fetches a long range, and the one that makes TWR and
 * the growth series possible at all. Bounded by an explicit range rather than
 * "everything", so a mis-click cannot pull a decade for thirty instruments.
 */
export async function backfillPrices(
  ctx: WriteCtx,
  registry: Registry,
  instrumentId: string,
  from: IsoDate,
  to: IsoDate,
): Promise<Result<StoreOutcome, DomainError>> {
  const ref = await instrumentRef(ctx, instrumentId);
  if (ref === null) return err(conflict(`instrument ${instrumentId} is not yours or does not exist`));

  const pinned = await pinnedProviderFor(ctx, instrumentId);
  const history = await registry.historicalPrices(ref, pinned, from, to);
  if (!history.ok) {
    return err(conflict(`price history unavailable: ${describeFailure(history.error)}`));
  }
  return ok(await storePriceObservations(ctx, history.value));
}

// ------------------------------------------------- corporate action detection

export interface DetectionOutcome {
  readonly detected: number;
  readonly failed: readonly { readonly instrumentId: string; readonly reason: string }[];
}

/**
 * Record what a provider says happened — **as a detection, never as a ledger row**
 * ([ADR-29](../../../docs/DECISIONS.md#adr-29--provider-corporate-actions-are-detections-never-ledger-writes)).
 *
 * `investment_transactions` is not touched by this function, by anything it
 * calls, or by any job that calls it. Invariant **I-40** asserts that with a
 * source scan, because a rule that depends on every future author remembering it
 * is not a rule.
 *
 * `UNIQUE (instrument_id, kind, ex_date)` makes a weekly re-run idempotent: the
 * same split found ten times is one row, so nothing accumulates and nothing
 * suppresses twice.
 */
export async function recordCorporateActionDetections(
  ctx: WriteCtx,
  observations: readonly CorporateActionObservation[],
): Promise<number> {
  let detected = 0;
  for (const observation of observations) {
    const [owned] = await ctx.tx
      .select({ id: instruments.id })
      .from(instruments)
      .where(and(eq(instruments.id, observation.instrumentId), eq(instruments.userId, ctx.userId)))
      .limit(1);
    if (!owned) continue;

    await ctx.tx
      .insert(corporateActionDetections)
      .values({
        userId: ctx.userId,
        instrumentId: observation.instrumentId,
        kind: observation.kind,
        exDate: observation.exDate,
        ratioNum: observation.ratioNum,
        ratioDen: observation.ratioDen,
        source: observation.source,
        detectedAt: ctx.now,
      })
      .onConflictDoNothing({
        target: [
          corporateActionDetections.instrumentId,
          corporateActionDetections.kind,
          corporateActionDetections.exDate,
        ],
      });
    detected += 1;
  }
  return detected;
}

export interface OpenDetection {
  readonly id: string;
  readonly instrumentId: string;
  readonly kind: 'split' | 'bonus';
  readonly exDate: IsoDate;
  readonly ratioNum: number;
  readonly ratioDen: number;
  readonly source: string;
}

/** Detections that are neither accepted into the ledger nor dismissed. */
export async function openDetections(ctx: ReadCtx): Promise<readonly OpenDetection[]> {
  const rows = await ctx.db
    .select({
      id: corporateActionDetections.id,
      instrumentId: corporateActionDetections.instrumentId,
      kind: corporateActionDetections.kind,
      exDate: corporateActionDetections.exDate,
      ratioNum: corporateActionDetections.ratioNum,
      ratioDen: corporateActionDetections.ratioDen,
      source: corporateActionDetections.source,
    })
    .from(corporateActionDetections)
    .where(
      and(
        eq(corporateActionDetections.userId, ctx.userId),
        isNull(corporateActionDetections.resolvedTxnId),
        isNull(corporateActionDetections.dismissedAt),
      ),
    );

  return rows.map((row) => ({
    id: row.id,
    instrumentId: row.instrumentId,
    kind: row.kind as 'split' | 'bonus',
    exDate: isoDate(row.exDate),
    ratioNum: row.ratioNum,
    ratioDen: row.ratioDen,
    source: row.source,
  }));
}

/**
 * Mark a detection dismissed — the user's judgement that it does not apply.
 *
 * The counterpart, *accepting* a detection, deliberately does not live here: it
 * creates an `investment_transactions` row and therefore belongs to the
 * investment service's validated write path, where every other ledger row is
 * created. Splitting them is what keeps this file free of ledger writes.
 */
export async function dismissDetection(
  ctx: WriteCtx,
  detectionId: string,
): Promise<Result<void, DomainError>> {
  const [row] = await ctx.tx
    .select({ id: corporateActionDetections.id })
    .from(corporateActionDetections)
    .where(
      and(
        eq(corporateActionDetections.id, detectionId),
        eq(corporateActionDetections.userId, ctx.userId),
      ),
    )
    .limit(1);

  if (!row) return err(conflict(`detection ${detectionId} is not yours or does not exist`));

  await ctx.tx
    .update(corporateActionDetections)
    .set({ dismissedAt: ctx.now })
    .where(eq(corporateActionDetections.id, detectionId));

  await ctx.audit.record({
    actor: 'user',
    action: 'corporate_action.dismiss',
    entityType: 'corporate_action_detection',
    entityId: detectionId,
    after: { dismissedAt: ctx.now.toISOString() },
  });

  return ok(undefined);
}

/** Cadence per instrument, for the freshness classifier. Derived, never stored. */
export function cadenceFor(assetClass: AssetClass) {
  return cadenceForAssetClass(assetClass);
}

/** Structured, and deliberately carrying no figures — SECURITY.md forbids logging amounts. */
export function logRefresh(kind: string, outcome: Record<string, unknown>): void {
  log.info(`market-data ${kind}`, outcome);
}

export type { CurrencyCode };
