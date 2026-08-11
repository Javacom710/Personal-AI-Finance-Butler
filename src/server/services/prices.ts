import 'server-only';

/**
 * Prices (SCHEMA.md §5, [ADR-11](../../../docs/DECISIONS.md#adr-11--market-data-behind-a-provider-abstraction-with-an-always-available-manual-provider)).
 *
 * **Phase 4 has one price source: the user.** There is no provider registry, no
 * adapter and no refresh job — those are Phase 6, along with the `OD-3` decision
 * on a commercial equity feed. What exists here is the always-available manual
 * path, which needs no network and no credential, plus the reader that
 * classifies a stored quote by age.
 *
 * That split is deliberate rather than partial: `PriceResult` and the staleness
 * rule are the contract every future adapter returns, so adding one is a new
 * file plus a registry line, and nothing above this layer changes.
 *
 * Provider credentials will be read inside `src/server/market-data/` and never
 * cross into `app/**` or any client bundle (SECURITY.md).
 */

import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';

import { currency, type CurrencyCode } from '../../lib/decimal/money';
import { UnitPrice, pToDbString } from '../../lib/decimal/price';
import { setManualPriceSchema, type SetManualPriceInput } from '../../lib/schemas/investments';
import { err, ok, type DomainError, type Result } from '../../lib/result';
import { classifyQuote, missing, type PriceResult } from '../domain/pricing/price-result';
import { instrumentPrices, instrumentQuotes, instruments, settings } from '../db/schema';
import type { ReadCtx, WriteCtx } from './_ctx';
import { requireOwnership } from './_guards';
import { fieldErrors } from './_validation';

/** How long a quote stays `cached` before it is reported as `stale`. */
export async function priceStaleAfterHours(ctx: ReadCtx): Promise<number> {
  const [row] = await ctx.db
    .select({ hours: settings.priceStaleAfterHours })
    .from(settings)
    .where(eq(settings.userId, ctx.userId))
    .limit(1);
  return row?.hours ?? 24;
}

/**
 * The latest price for each instrument, classified by age.
 *
 * A read **never** triggers a network call — pages render from the cache and
 * show staleness; a manual refresh will enqueue the job in Phase 6. An
 * instrument with no quote gets `missing: 'no_provider'`, which is the truthful
 * reason today: no adapter claims it and nobody has typed a price.
 */
export async function quotesFor(
  ctx: ReadCtx,
  instrumentIds: readonly string[],
): Promise<Map<string, PriceResult>> {
  const out = new Map<string, PriceResult>();
  if (instrumentIds.length === 0) return out;

  const staleAfterHours = await priceStaleAfterHours(ctx);

  const rows = await ctx.db
    .select({
      instrumentId: instrumentQuotes.instrumentId,
      price: instrumentQuotes.price,
      quoteCurrency: instrumentQuotes.currencyCode,
      asOf: instrumentQuotes.asOf,
      source: instrumentQuotes.source,
      instrumentCurrency: instruments.currencyCode,
      userId: instruments.userId,
    })
    .from(instrumentQuotes)
    .innerJoin(instruments, eq(instruments.id, instrumentQuotes.instrumentId))
    .where(inArray(instrumentQuotes.instrumentId, [...instrumentIds]));

  for (const row of rows) {
    if (row.userId !== ctx.userId) continue;
    out.set(
      row.instrumentId,
      classifyQuote({
        price: UnitPrice.fromDbString(row.price),
        currency: currency(row.quoteCurrency.trim()),
        instrumentCurrency: currency(row.instrumentCurrency.trim()),
        asOf: row.asOf,
        source: row.source,
        now: ctx.now,
        staleAfterHours,
      }),
    );
  }

  for (const id of instrumentIds) {
    if (!out.has(id)) out.set(id, missing('no_provider'));
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
    })
    .from(instruments)
    .where(eq(instruments.id, input.instrumentId))
    .limit(1);

  const owned = requireOwnership(instrument, ctx.userId, 'instrument', input.instrumentId);
  if (!owned.ok) return owned;

  const instrumentCurrency: CurrencyCode = currency(owned.value.currencyCode.trim());
  const price = UnitPrice.of(input.price);
  const asOf = input.asOf === undefined ? ctx.now : new Date(input.asOf);

  await ctx.tx
    .insert(instrumentQuotes)
    .values({
      instrumentId: owned.value.id,
      price: pToDbString(price),
      currencyCode: instrumentCurrency,
      asOf,
      source: 'manual',
      fetchedAt: ctx.now,
    })
    .onConflictDoUpdate({
      target: instrumentQuotes.instrumentId,
      set: {
        price: pToDbString(price),
        currencyCode: instrumentCurrency,
        asOf,
        source: 'manual',
        fetchedAt: ctx.now,
      },
    });

  await ctx.audit.record({
    actor: 'user',
    action: 'instrument.price_set',
    entityType: 'instrument',
    entityId: owned.value.id,
    after: { price: pToDbString(price), currency: instrumentCurrency, asOf: asOf.toISOString() },
  });

  const staleAfterHours = await priceStaleAfterHours(ctx);
  return ok(
    classifyQuote({
      price,
      currency: instrumentCurrency,
      instrumentCurrency,
      asOf,
      source: 'manual',
      now: ctx.now,
      staleAfterHours,
    }),
  );
}

/**
 * Historical closes for a date range — the input TWR and the growth series need.
 *
 * `instrument_prices` is populated by `getHistoricalPrices()` in Phase 6, so
 * today it is empty for every instrument and both consumers correctly report a
 * gap rather than a figure. The query exists now so the consumers are written
 * against real shapes rather than against a placeholder.
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
