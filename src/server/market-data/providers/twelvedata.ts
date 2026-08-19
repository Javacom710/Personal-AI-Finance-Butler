import 'server-only';

/**
 * Twelve Data — equity and ETF prices (decision **OD-3**).
 *
 * The only adapter in this application that needs a credential, and the only
 * file permitted to read `TWELVE_DATA_API_KEY`. Nothing above
 * `src/server/market-data/` learns that this provider exists
 * ([ADR-27](../../../../docs/DECISIONS.md#adr-27--market-data-adapters-return-observations-the-registry-classifies-freshness)).
 *
 * Endpoints used, and no others — a request for data nothing consumes is a cost
 * and a privacy surface for nothing:
 *
 * | Purpose | Endpoint | Verified |
 * |---|---|---|
 * | Instrument reference | `/quote` | 2026-08-18 |
 * | Latest close | `/quote?interval=1day` | 2026-08-18 |
 * | Daily history | `/time_series?interval=1day` | 2026-08-18 |
 * | Splits | `/splits` | 2026-08-18 |
 *
 * Fundamentals, analyst data, derivatives, crypto and forex are **not**
 * requested. Crypto and gold are deferred by OD-11 and OD-12; FX comes from a
 * central bank, which is better provenance than an equity vendor.
 *
 * ## Two provider quirks this file absorbs so nothing else has to
 *
 * 1. **An error can arrive with HTTP 200.** Twelve Data signals failure in the
 *    *body* — `{"code":429,"message":"…","status":"error"}` — and does not always
 *    set a matching HTTP status. Checking only the transport status would read a
 *    rate-limit refusal as a successful empty response, which is how a portfolio
 *    quietly stops updating. Every response is inspected for `status: "error"`
 *    before anything else, and the body's `code` is what selects the failure.
 *
 * 2. **Prices are strings.** `"148.85001"`, not `148.85001`. That is the good
 *    case for us: `UnitPrice.parseUserInput` reads the digits exactly, with no
 *    double in the path ([MARKET-DATA-DESIGN.md §9](../../../../docs/MARKET-DATA-DESIGN.md#9-price-precision)).
 *    `dp=8` is requested so the provider rounds once, at our storage scale,
 *    rather than handing us more precision than `NUMERIC(20,8)` can hold.
 *
 * ## Licensing
 *
 * Twelve Data's terms permit storing data for **internal use** and prohibit
 * redistribution without a separate add-on (verified 2026-08-17). This
 * application stores prices locally and shows them to the single user of the
 * installation; nothing is re-published.
 */

import { err, ok, type Result } from '../../../lib/result';
import { compareDates, type IsoDate } from '../../../lib/date';
import { currency, type CurrencyCode } from '../../../lib/decimal/money';
import { UnitPrice } from '../../../lib/decimal/price';
import { getJson, type FetchLike } from '../http';
import {
  exchangeCloseInstant,
  resolveMic,
  supportedMics,
  tradingDateFromLocal,
} from '../exchanges';
import {
  failure,
  refKey,
  type CorporateActionObservation,
  type InstrumentMetadata,
  type MarketDataProvider,
  type Mic,
  type PriceObservation,
  type ProviderCapabilities,
  type ProviderFailure,
  type ProviderRef,
  type ProviderRefKey,
} from '../types';

export const TWELVE_DATA_BASE_URL = 'https://api.twelvedata.com';
export const TWELVE_DATA_SOURCE = 'twelvedata';

/**
 * `NUMERIC(20,8)` is what we can store, so eight is what we ask for. Rounding
 * once at the provider beats receiving eleven decimals and rejecting the batch.
 */
const DECIMAL_PLACES = 8;

/** The most points `/time_series` will return in one call. */
const MAX_OUTPUTSIZE = 5000;

const CAPABILITIES: ProviderCapabilities = {
  assetClasses: ['equity', 'etf'],
  markets: supportedMics(),
  cadence: 'eod',
  // The provider's depth varies by plan and is not asserted here; `null` means
  // "unknown", which is honest, and a request beyond it returns `not_found`.
  historyFrom: null,
  provides: ['latest', 'history', 'corporate_actions', 'metadata'],
  requiresCredential: true,
};

// ------------------------------------------------------------ error handling

interface ErrorBody {
  readonly status?: unknown;
  readonly code?: unknown;
  readonly message?: unknown;
}

/**
 * `{status: "error"}` in a 200 body → a typed failure.
 *
 * The mapping is by the body's `code`, because that is the field Twelve Data
 * actually varies; the HTTP status is unreliable. Returns `null` when the
 * response is not an error, so the caller can carry on.
 */
export function providerError(body: unknown): ProviderFailure | null {
  if (typeof body !== 'object' || body === null) return failure.malformed('response was not an object');
  const candidate = body as ErrorBody;
  if (candidate.status !== 'error') return null;

  const code = typeof candidate.code === 'number' ? candidate.code : 0;
  // Never echoed with the key in it — the message is provider prose, and the
  // key never appears in it, but the URL that produced it does carry the key and
  // is deliberately not included here (SECURITY.md).
  const message = typeof candidate.message === 'string' ? candidate.message : 'provider error';

  switch (code) {
    case 401:
    case 403:
      // An invalid or unentitled key. Permanent until a human changes it, so it
      // must not be retried: `unsupported` stops the job rather than burning
      // the quota that is left.
      return failure.unsupported(`authentication rejected (${code}): ${message}`);
    case 404:
      return failure.notFound();
    case 400:
      // A malformed request is our bug, not a transient outage; surfacing it as
      // `malformed` puts it in the log where it can be fixed.
      return failure.malformed(`invalid request: ${message}`);
    case 429:
      return failure.rateLimited(null);
    default:
      return code >= 500
        ? failure.transport(`provider error ${code}: ${message}`)
        : failure.malformed(`provider error ${code}: ${message}`);
  }
}

// -------------------------------------------------------------- parsing

/**
 * A price string → `UnitPrice`, rejecting rather than rounding.
 *
 * Parsed from the provider's own decimal text, so no `number` ever touches it.
 * More than eight decimal places is a rejection: a truncated price is a wrong
 * price that looks right.
 */
export function parsePrice(raw: unknown, field: string): Result<UnitPrice, ProviderFailure> {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return err(failure.malformed(`${field}: expected a decimal string, received ${JSON.stringify(raw)}`));
  }
  const parsed = UnitPrice.parseUserInput(raw.trim());
  if (!parsed.ok) return err(failure.malformed(`${field}: ${parsed.error.message}`));
  if (parsed.value.units < 0n) return err(failure.malformed(`${field}: negative price ${raw}`));
  return ok(parsed.value);
}

/**
 * A split ratio from `from_factor` / `to_factor` → the ledger's integer pair.
 *
 * Twelve Data reports "1 share became 5", so `to_factor` is new units and
 * `from_factor` is old — which maps onto `ratio_num` / `ratio_den` directly and
 * matches INVESTMENT-DOMAIN.md §11's worked 1:5 example.
 *
 * The factors arrive as JSON numbers and may be fractional (`0.2` for a reverse
 * split). `ratio_num` and `ratio_den` are `integer` with a `CHECK > 0`, so a
 * fraction is scaled to whole numbers and anything that will not scale cleanly
 * is **rejected**. Inventing a rounded ratio would silently rescale a position.
 */
export function parseSplitRatio(
  fromFactor: unknown,
  toFactor: unknown,
): Result<{ ratioNum: number; ratioDen: number }, ProviderFailure> {
  const from = Number(fromFactor);
  const to = Number(toFactor);

  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= 0) {
    return err(
      failure.malformed(
        `split factors must be positive finite numbers, received ${JSON.stringify(fromFactor)}/${JSON.stringify(toFactor)}`,
      ),
    );
  }

  // Scale both by the smallest power of ten that makes each whole. Bounded at
  // 1e6, beyond which a "ratio" is not a corporate action anybody declared.
  let scale = 1;
  while (scale <= 1_000_000 && (!isWhole(from * scale) || !isWhole(to * scale))) scale *= 10;
  if (scale > 1_000_000) {
    return err(failure.malformed(`split ratio ${from}:${to} cannot be expressed in whole units`));
  }

  const num = Math.round(to * scale);
  const den = Math.round(from * scale);
  const divisor = gcd(num, den);
  const ratioNum = num / divisor;
  const ratioDen = den / divisor;

  if (!Number.isSafeInteger(ratioNum) || !Number.isSafeInteger(ratioDen) || ratioNum <= 0 || ratioDen <= 0) {
    return err(failure.malformed(`split ratio ${from}:${to} is out of range`));
  }
  return ok({ ratioNum, ratioDen });
}

function isWhole(value: number): boolean {
  return Math.abs(value - Math.round(value)) < 1e-9;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) [x, y] = [y, x % y];
  return x === 0 ? 1 : x;
}

// ------------------------------------------------------------------ adapter

export interface TwelveDataOptions {
  readonly fetch: FetchLike;
  /**
   * Resolved by the caller from the environment, so this module never reads
   * `process.env` directly and a test never needs one. `null` means unconfigured
   * — every call then returns a typed failure rather than a fabricated price.
   */
  readonly apiKey: string | null;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

/** The failure every call returns when no key is configured. */
const NOT_CONFIGURED: ProviderFailure = failure.unsupported(
  'TWELVE_DATA_API_KEY is not configured — equity prices are unavailable until it is set',
);

export function createTwelveDataProvider(options: TwelveDataOptions): MarketDataProvider {
  const baseUrl = options.baseUrl ?? TWELVE_DATA_BASE_URL;

  /**
   * Build a request URL.
   *
   * The key is a query parameter because that is what the provider accepts. It
   * is therefore in the URL, which is exactly why **no failure message in this
   * file ever includes a URL** — an error echoing the request would put the
   * credential into the log.
   */
  function url(path: string, params: Record<string, string>): string | null {
    if (options.apiKey === null) return null;
    const query = new URLSearchParams({ ...params, apikey: options.apiKey });
    return `${baseUrl}/${path}?${query.toString()}`;
  }

  async function call<T>(path: string, params: Record<string, string>): Promise<Result<T, ProviderFailure>> {
    const target = url(path, params);
    if (target === null) return err(NOT_CONFIGURED);

    const response = await getJson<unknown>(target, {
      fetch: options.fetch,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });
    if (!response.ok) return err(response.error);

    // Checked before anything is read out of the body: an error arrives with
    // HTTP 200 often enough that trusting the transport status alone would let a
    // rate-limit refusal pass as a successful empty response.
    const problem = providerError(response.value);
    if (problem) return err(problem);

    return ok(response.value as T);
  }

  /** The venue an instrument trades on, or a refusal. Never a guess. */
  function venueOf(ref: ProviderRef): Result<Mic, ProviderFailure> {
    const venue = ref.exchange ?? resolveMic(null);
    if (venue === null) {
      return err(
        failure.unsupported(
          'no recognised exchange — set the instrument’s exchange so it cannot be confused with a same-named listing elsewhere',
        ),
      );
    }
    return ok(venue);
  }

  /**
   * Turn one provider bar into an observation.
   *
   * `datetime` is already exchange-local, so its date part *is* the trading
   * date. `observedAt` is then the venue's official close on that date, never
   * the fetch time and never midnight (SCHEMA.md §5).
   */
  function toObservation(
    ref: ProviderRef,
    venue: Mic,
    datetime: unknown,
    close: unknown,
    responseCurrency: unknown,
  ): Result<PriceObservation, ProviderFailure> {
    if (typeof datetime !== 'string') {
      return err(failure.malformed(`datetime: expected a string, received ${JSON.stringify(datetime)}`));
    }
    const tradingDate = tradingDateFromLocal(datetime);
    if (tradingDate === null) {
      return err(failure.malformed(`datetime: unparseable value ${JSON.stringify(datetime)}`));
    }

    const price = parsePrice(close, 'close');
    if (!price.ok) return err(price.error);

    const observedAt = exchangeCloseInstant(venue, tradingDate);
    if (observedAt === null) {
      return err(failure.unsupported(`no session times known for ${venue}`));
    }

    // The instrument's own currency governs. A response in another currency is a
    // provider error the registry surfaces, never a conversion opportunity
    // (I-33) — and it is caught here as well as at the storage boundary,
    // because a mismatched batch should not be written and then rejected.
    if (typeof responseCurrency === 'string' && responseCurrency.trim() !== '') {
      const reported = safeCurrency(responseCurrency);
      if (reported !== null && reported !== ref.currency) {
        return err(
          failure.malformed(`currency mismatch: provider says ${reported}, instrument is ${ref.currency}`),
        );
      }
    }

    return ok({
      instrumentId: ref.instrumentId,
      close: price.value,
      currency: ref.currency,
      tradingDate,
      observedAt,
      kind: 'eod',
      // Scoped by venue, so a series can never silently mix two listings of one
      // company (I-35).
      source: `${TWELVE_DATA_SOURCE}:${venue}`,
      providerRef: ref.providerSymbol,
    });
  }

  return {
    key: 'twelvedata',
    capabilities: CAPABILITIES,

    supports(ref: ProviderRef): boolean {
      if (ref.assetClass !== 'equity' && ref.assetClass !== 'etf') return false;
      // A venue is mandatory. Without one, `INFY` could be the NSE listing or a
      // same-named foreign one, and pricing the wrong security is worse than
      // pricing nothing.
      if (ref.exchange === null) return false;
      return ref.providerSymbol.trim() !== '';
    },

    async getInstrument(ref: ProviderRef): Promise<Result<InstrumentMetadata, ProviderFailure>> {
      const venue = venueOf(ref);
      if (!venue.ok) return err(venue.error);

      const body = await call<Record<string, unknown>>('quote', {
        symbol: ref.providerSymbol,
        mic_code: venue.value,
        interval: '1day',
        dp: String(DECIMAL_PLACES),
      });
      if (!body.ok) return err(body.error);

      const name = body.value['name'];
      const reported = safeCurrency(body.value['currency']);
      if (typeof name !== 'string' || reported === null) {
        return err(failure.malformed('quote is missing name or currency'));
      }

      return ok({
        name,
        currency: reported,
        exchange: venue.value,
        // The quote endpoint does not return an ISIN; leaving it null is honest,
        // and the user's own value is authoritative anyway (M13).
        isin: null,
        assetClass: ref.assetClass,
        providerSymbol: ref.providerSymbol,
      });
    },

    /**
     * Latest closes.
     *
     * Issued one request per instrument rather than as a batch: Twelve Data
     * bills `/quote` at one credit per symbol either way, and a per-symbol call
     * means one unknown ticker returns `not_found` for itself instead of
     * poisoning the whole response. At this application's volume — a few dozen
     * instruments once a day — the round trips are free.
     */
    async getLatestPrices(
      refs: readonly ProviderRef[],
    ): Promise<Map<ProviderRefKey, Result<PriceObservation, ProviderFailure>>> {
      const out = new Map<ProviderRefKey, Result<PriceObservation, ProviderFailure>>();

      for (const ref of refs) {
        const venue = venueOf(ref);
        if (!venue.ok) {
          out.set(refKey(ref), err(venue.error));
          continue;
        }

        const body = await call<Record<string, unknown>>('quote', {
          symbol: ref.providerSymbol,
          mic_code: venue.value,
          interval: '1day',
          dp: String(DECIMAL_PLACES),
        });
        if (!body.ok) {
          out.set(refKey(ref), err(body.error));
          continue;
        }

        out.set(
          refKey(ref),
          toObservation(ref, venue.value, body.value['datetime'], body.value['close'], body.value['currency']),
        );
      }

      return out;
    },

    async getHistoricalPrices(
      ref: ProviderRef,
      from: IsoDate,
      to: IsoDate,
    ): Promise<Result<readonly PriceObservation[], ProviderFailure>> {
      if (compareDates(from, to) > 0) {
        return err(failure.malformed(`from ${from} is after to ${to}`));
      }
      const venue = venueOf(ref);
      if (!venue.ok) return err(venue.error);

      const body = await call<{ meta?: Record<string, unknown>; values?: unknown }>('time_series', {
        symbol: ref.providerSymbol,
        mic_code: venue.value,
        interval: '1day',
        start_date: from,
        end_date: to,
        order: 'asc',
        outputsize: String(MAX_OUTPUTSIZE),
        dp: String(DECIMAL_PLACES),
      });
      if (!body.ok) return err(body.error);

      const values = body.value.values;
      // An empty range is a legitimate answer — a holiday week, or a listing
      // younger than the window — and must not read as an outage.
      if (values === undefined || values === null) return ok([]);
      if (!Array.isArray(values)) return err(failure.malformed('time_series values was not an array'));

      const responseCurrency = body.value.meta?.['currency'];
      const observations: PriceObservation[] = [];

      for (const value of values) {
        if (typeof value !== 'object' || value === null) {
          return err(failure.malformed('time_series contained a non-object value'));
        }
        const bar = value as Record<string, unknown>;
        const observation = toObservation(ref, venue.value, bar['datetime'], bar['close'], responseCurrency);
        // One bad bar rejects the batch rather than storing a partial series
        // with an invisible hole in it.
        if (!observation.ok) return err(observation.error);
        observations.push(observation.value);
      }

      return ok(observations);
    },

    /**
     * Splits, as **detections**.
     *
     * Nothing in this file writes a ledger row, and nothing it returns is
     * applied automatically
     * ([ADR-29](../../../../docs/DECISIONS.md#adr-29--provider-corporate-actions-are-detections-never-ledger-writes)).
     * The value of this call is that an unrecorded split becomes *visible*, so
     * the affected valuation is suppressed instead of silently reporting
     * post-split price × pre-split quantity.
     *
     * Bonus issues are not reported by this endpoint and are not inferred from a
     * split — they are economically distinct, and guessing one from the other
     * would put a fabricated corporate action in front of the user.
     */
    async getCorporateActions(
      ref: ProviderRef,
      from: IsoDate,
      to: IsoDate,
    ): Promise<Result<readonly CorporateActionObservation[], ProviderFailure>> {
      const venue = venueOf(ref);
      if (!venue.ok) return err(venue.error);

      const body = await call<{ splits?: unknown }>('splits', {
        symbol: ref.providerSymbol,
        mic_code: venue.value,
        start_date: from,
        end_date: to,
      });
      if (!body.ok) return err(body.error);

      const splits = body.value.splits;
      if (splits === undefined || splits === null) return ok([]);
      if (!Array.isArray(splits)) return err(failure.malformed('splits was not an array'));

      const observations: CorporateActionObservation[] = [];

      for (const value of splits) {
        if (typeof value !== 'object' || value === null) {
          return err(failure.malformed('splits contained a non-object value'));
        }
        const split = value as Record<string, unknown>;

        const exDate = typeof split['date'] === 'string' ? tradingDateFromLocal(split['date']) : null;
        if (exDate === null) {
          return err(failure.malformed(`split date unparseable: ${JSON.stringify(split['date'])}`));
        }

        const ratio = parseSplitRatio(split['from_factor'], split['to_factor']);
        if (!ratio.ok) return err(ratio.error);

        observations.push({
          instrumentId: ref.instrumentId,
          kind: 'split',
          exDate,
          ratioNum: ratio.value.ratioNum,
          ratioDen: ratio.value.ratioDen,
          source: `${TWELVE_DATA_SOURCE}:${venue.value}`,
        });
      }

      return ok(observations);
    },
  };
}

/** ISO 4217 or nothing. A malformed code is not worth throwing over. */
function safeCurrency(raw: unknown): CurrencyCode | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(value)) return null;
  try {
    return currency(value);
  } catch {
    return null;
  }
}
