import 'server-only';

/**
 * Frankfurter — central-bank reference exchange rates.
 *
 * Free, open-source, **no API key**, and no published quota. It aggregates
 * reference rates from central banks (the ECB among them) and covers ~200
 * currencies including INR, with history back to 1948.
 *
 * Verified against the live service on 2026-08-17:
 *
 * ```
 * GET https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR
 * {"amount":1.0,"base":"USD","date":"2026-08-17","rates":{"INR":95.61}}
 * ```
 *
 * ## Two properties of this feed that the design depends on
 *
 * 1. **`base` is honoured server-side.** Reference rates are published against
 *    one reference currency, so `base=USD&symbols=INR` is a *cross* computed by
 *    the service. That is exactly what finding **M1** needs: the pairs the
 *    application actually uses are requested directly, quoted against the user's
 *    base currency, so `selectRate` normally finds a direct row and never has to
 *    triangulate. Triangulation remains as a safety net for a pair nobody thought
 *    to request — both mechanisms exist because either alone leaves a gap.
 *
 * 2. **The returned `date` is authoritative, and is often earlier than the date
 *    asked for.** Reference rates publish on business days, so a Saturday query
 *    answers with Friday's rate. We record the **returned** date, never the
 *    requested one. Recording the request date would claim a rate was observed on
 *    a day no rate was published, and would then satisfy an exact-date lookup
 *    with a value that is not that day's.
 *
 * ## Licensing
 *
 * Frankfurter states it is free for commercial use; the underlying central-bank
 * terms govern the data itself. Nothing here is redistributed — rates are stored
 * locally and shown to the single user of this installation.
 */

import { err, ok, type Result } from '../../../lib/result';
import { isIsoDate, isoDate, type IsoDate } from '../../../lib/date';
import { currency, type CurrencyCode } from '../../../lib/decimal/money';
import { Rate, RATE_SCALE } from '../../../lib/decimal/rate';
import { getJson, type FetchLike } from '../http';
import {
  failure,
  pairKey,
  type CurrencyPair,
  type FxObservation,
  type MarketDataProvider,
  type PairKey,
  type ProviderCapabilities,
  type ProviderFailure,
  type ProviderRef,
} from '../types';

export const FRANKFURTER_BASE_URL = 'https://api.frankfurter.dev/v1';
export const FRANKFURTER_SOURCE = 'frankfurter';

const CAPABILITIES: ProviderCapabilities = {
  // FX is not an instrument asset class; the registry routes FX by the `fx`
  // operation alone, so this list is deliberately empty rather than a fiction.
  assetClasses: [],
  markets: [],
  cadence: 'eod',
  historyFrom: isoDate('1948-01-01'),
  provides: ['fx'],
  requiresCredential: false,
};

interface FrankfurterResponse {
  readonly base?: unknown;
  readonly date?: unknown;
  readonly rates?: unknown;
}

export interface FrankfurterOptions {
  readonly fetch: FetchLike;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

/**
 * A JSON number is an IEEE-754 double by specification, so the provider's
 * decimal literal is already gone by the time `JSON.parse` returns.
 *
 * `toFixed(RATE_SCALE)` therefore rounds **once, at the storage scale**, which is
 * a deliberate boundary rounding rather than a silent truncation: `Rate` is
 * `NUMERIC(20,10)`, so ten decimal places is the most that can be stored, and
 * emitting more would only invent digits the double never carried. Everything
 * that is not a finite positive number is rejected outright — a zero, a
 * negative, an infinity or a NaN rate is a broken response, not a rate.
 */
export function rateFromJsonNumber(value: unknown): Result<Rate, ProviderFailure> {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return err(failure.malformed(`expected a positive finite rate, received ${JSON.stringify(value)}`));
  }
  // 1e9 is far outside any real FX rate and inside NUMERIC(20,10)'s integer room.
  if (value >= 1e9) {
    return err(failure.malformed(`rate ${value} is implausibly large`));
  }
  const parsed = Rate.parseUserInput(value.toFixed(RATE_SCALE));
  if (!parsed.ok) return err(failure.malformed(`rate ${value}: ${parsed.error.message}`));
  return ok(parsed.value);
}

function parseResponse(
  body: FrankfurterResponse,
  expectedBase: CurrencyCode,
  wanted: readonly CurrencyCode[],
): Result<{ asOf: IsoDate; rates: Map<CurrencyCode, Rate> }, ProviderFailure> {
  if (typeof body.date !== 'string' || !isIsoDate(body.date)) {
    return err(failure.malformed(`missing or malformed date: ${JSON.stringify(body.date)}`));
  }
  if (typeof body.base !== 'string' || body.base.trim().toUpperCase() !== expectedBase) {
    return err(failure.malformed(`response base ${JSON.stringify(body.base)} is not ${expectedBase}`));
  }
  if (typeof body.rates !== 'object' || body.rates === null) {
    return err(failure.malformed('missing rates object'));
  }

  const raw = body.rates as Record<string, unknown>;
  const rates = new Map<CurrencyCode, Rate>();

  for (const code of wanted) {
    const value = raw[code];
    if (value === undefined) continue; // absent is not-found, handled by the caller
    const rate = rateFromJsonNumber(value);
    if (!rate.ok) return err(rate.error);
    rates.set(code, rate.value);
  }

  return ok({ asOf: isoDate(body.date), rates });
}

export function createFrankfurterProvider(options: FrankfurterOptions): MarketDataProvider {
  const baseUrl = options.baseUrl ?? FRANKFURTER_BASE_URL;

  return {
    key: 'frankfurter',
    capabilities: CAPABILITIES,

    // FX is not instrument-scoped. Nothing resolves an instrument to this
    // adapter, so saying "no" here is the truthful answer rather than a refusal.
    supports(_ref: ProviderRef): boolean {
      return false;
    },

    async getFxRates(
      pairs: readonly CurrencyPair[],
      on?: IsoDate,
    ): Promise<Map<PairKey, Result<FxObservation, ProviderFailure>>> {
      const out = new Map<PairKey, Result<FxObservation, ProviderFailure>>();
      if (pairs.length === 0) return out;

      // One request per distinct base: the service returns every requested
      // symbol in one response, so a 30-currency portfolio is still one call.
      const byBase = new Map<CurrencyCode, CurrencyCode[]>();
      for (const pair of pairs) {
        if (pair.base === pair.quote) {
          // Identity needs no provider and no table row; `selectRate` answers it
          // without a lookup. Fetching it would store a meaningless 1.0.
          out.set(pairKey(pair), err(failure.unsupported('identity pair needs no rate')));
          continue;
        }
        const quotes = byBase.get(pair.base);
        if (quotes) quotes.push(pair.quote);
        else byBase.set(pair.base, [pair.quote]);
      }

      for (const [base, quotes] of byBase) {
        const path = on === undefined ? 'latest' : on;
        const url = `${baseUrl}/${path}?base=${encodeURIComponent(base)}&symbols=${encodeURIComponent(quotes.join(','))}`;

        const response = await getJson<FrankfurterResponse>(url, {
          fetch: options.fetch,
          ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        });

        if (!response.ok) {
          for (const quote of quotes) out.set(pairKey({ base, quote }), err(response.error));
          continue;
        }

        const parsed = parseResponse(response.value, base, quotes);
        if (!parsed.ok) {
          for (const quote of quotes) out.set(pairKey({ base, quote }), err(parsed.error));
          continue;
        }

        for (const quote of quotes) {
          const rate = parsed.value.rates.get(quote);
          if (rate === undefined) {
            out.set(pairKey({ base, quote }), err(failure.notFound()));
            continue;
          }
          out.set(
            pairKey({ base, quote }),
            ok({
              base,
              quote,
              rate,
              // The date the service published, never the date requested.
              asOf: parsed.value.asOf,
              source: FRANKFURTER_SOURCE,
            }),
          );
        }
      }

      return out;
    },
  };
}

/** Exported for the adapter tests, which build refs without a database. */
export function currencyOf(code: string): CurrencyCode {
  return currency(code.trim().toUpperCase());
}
