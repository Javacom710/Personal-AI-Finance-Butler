import 'server-only';

/**
 * AMFI — Indian mutual-fund NAV.
 *
 * The Association of Mutual Funds in India publishes every scheme's NAV daily as
 * a delimited text file, with no authentication and no key. It is the **primary**
 * source: a commercial vendor selling Indian MF NAV is redistributing this same
 * publication, usually a day later and with its own scheme-mapping errors.
 *
 * ```
 * GET https://www.amfiindia.com/spages/NAVAll.txt
 *
 * Scheme Code;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date
 * 119551;INF209K01YM2;INF209K01YN0;Aditya Birla Sun Life Banking & PSU Debt Fund;349.5136;17-Aug-2026
 * ```
 *
 * The file interleaves blank lines, AMC names and scheme-category headings
 * between data rows. Those are skipped, not parsed — a heading has no semicolons
 * and a data row has five.
 *
 * ## Licensing — OD-13, open and deliberately not assumed
 *
 * AMFI publishes this file publicly and without authentication, and the Indian
 * fintech industry consumes it. **No machine-readable licence or explicit reuse
 * grant was located**, so none is asserted here. This adapter is written for
 * personal, non-redistributing use: NAVs are stored locally and shown to the
 * single user of this installation, and nothing is re-published. Confirm terms
 * with AMFI before any non-personal use. See
 * [DECISIONS.md OD-13](../../../../docs/DECISIONS.md#open-decisions-requiring-the-user).
 *
 * ## What this adapter must not do
 *
 * NAV is **observation data**. It never becomes an `investment_transaction`, it
 * never adjusts a quantity, and it never touches a lot. It lands in
 * `instrument_quotes` and `instrument_prices` and nowhere else.
 */

import { err, ok, type Result } from '../../../lib/result';
import { isoDate, type IsoDate } from '../../../lib/date';
import { currency, type CurrencyCode } from '../../../lib/decimal/money';
import { UnitPrice } from '../../../lib/decimal/price';
import { getText, type FetchLike } from '../http';
import {
  failure,
  refKey,
  type MarketDataProvider,
  type PriceObservation,
  type ProviderCapabilities,
  type ProviderFailure,
  type ProviderRef,
  type ProviderRefKey,
} from '../types';

export const AMFI_NAV_ALL_URL = 'https://www.amfiindia.com/spages/NAVAll.txt';
export const AMFI_SOURCE = 'amfi';

/** Every Indian mutual fund is denominated in rupees; the file carries no currency column. */
const INR: CurrencyCode = currency('INR');

/**
 * NAVs are published each business evening. 18:00 IST — 12:30 UTC — is the
 * instant a NAV dated `D` is treated as having been true at, for the same reason
 * an exchange close is used for an equity: `as_of` must be an instant that sits
 * inside the day it belongs to, and never the fetch time (SCHEMA.md §5).
 */
const NAV_PUBLICATION_UTC_HOUR = 12;
const NAV_PUBLICATION_UTC_MINUTE = 30;

const CAPABILITIES: ProviderCapabilities = {
  assetClasses: ['mutual_fund'],
  // A mutual fund has no exchange, so this adapter is market-agnostic.
  markets: [],
  cadence: 'nav',
  historyFrom: isoDate('2006-04-01'),
  provides: ['latest', 'metadata'],
  requiresCredential: false,
};

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** `17-Aug-2026` → `2026-08-17`. Returns `null` for anything else, including `N.A.`. */
export function parseAmfiDate(raw: string): IsoDate | null {
  const match = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(raw.trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = MONTHS[match[2]!.toLowerCase()];
  const year = Number(match[3]);
  if (month === undefined || day < 1 || day > 31) return null;
  const iso = `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
    .toString()
    .padStart(2, '0')}`;
  // Round-trips through the domain's own validator, so 31-Feb is rejected here
  // rather than becoming a plausible-looking wrong date downstream.
  try {
    return isoDate(iso);
  } catch {
    return null;
  }
}

export interface AmfiRow {
  readonly schemeCode: string;
  readonly isinPayout: string | null;
  readonly isinReinvest: string | null;
  readonly schemeName: string;
  readonly nav: UnitPrice;
  readonly navDate: IsoDate;
}

/**
 * Parse the whole file into rows, skipping everything that is not one.
 *
 * Skipping is not the same as failing. The file legitimately contains headings,
 * blank lines and schemes whose NAV is `N.A.` on a given day, and a parser that
 * treated any of those as an error would report a broken feed every single day.
 * What is *not* skipped is a row that looks like data and is not usable — a
 * negative NAV, or one with more precision than `UnitPrice` holds — because that
 * is a provider defect and must surface rather than vanish.
 */
export function parseNavAll(text: string): Result<readonly AmfiRow[], ProviderFailure> {
  const rows: AmfiRow[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    const parts = line.split(';');
    if (parts.length < 6) continue; // heading, AMC name, or the column header

    const [schemeCode, isinPayout, isinReinvest, schemeName, navText, dateText] = parts as [
      string, string, string, string, string, string,
    ];

    if (!/^\d+$/.test(schemeCode.trim())) continue; // the header row, and any stray text

    const navRaw = navText.trim();
    if (navRaw === '' || navRaw.toUpperCase() === 'N.A.' || navRaw === '-') continue;

    const navDate = parseAmfiDate(dateText);
    if (navDate === null) {
      return err(failure.malformed(`unparseable NAV date ${JSON.stringify(dateText)} for scheme ${schemeCode}`));
    }

    // Parsed as a string — never through `Number` — so a NAV of 349.51360000
    // keeps every digit `UnitPrice` can hold, and anything beyond scale 8 is
    // rejected rather than silently truncated (MARKET-DATA-DESIGN.md §9).
    const nav = UnitPrice.parseUserInput(navRaw);
    if (!nav.ok) {
      return err(failure.malformed(`unparseable NAV ${JSON.stringify(navRaw)} for scheme ${schemeCode}: ${nav.error.message}`));
    }
    if (nav.value.units < 0n) {
      return err(failure.malformed(`negative NAV ${navRaw} for scheme ${schemeCode}`));
    }

    rows.push({
      schemeCode: schemeCode.trim(),
      isinPayout: normaliseIsin(isinPayout),
      isinReinvest: normaliseIsin(isinReinvest),
      schemeName: schemeName.trim(),
      nav: nav.value,
      navDate,
    });
  }

  return ok(rows);
}

function normaliseIsin(raw: string): string | null {
  const value = raw.trim().toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(value) ? value : null;
}

/**
 * The instant a NAV dated `d` was true.
 *
 * A fixed publication instant rather than the fetch time, because a NAV fetched
 * on Monday for Friday is Friday's price and must age from Friday (SCHEMA.md §5).
 */
export function navObservedAt(navDate: IsoDate): Date {
  const [year, month, day] = navDate.split('-').map(Number) as [number, number, number];
  return new Date(
    Date.UTC(year, month - 1, day, NAV_PUBLICATION_UTC_HOUR, NAV_PUBLICATION_UTC_MINUTE, 0, 0),
  );
}

/**
 * Match a stored instrument to a row.
 *
 * **ISIN first** (finding M13): it is stable across scheme renames and is the
 * correct cross-provider bridge, and AMFI publishes it. `provider_symbol` holding
 * the AMFI scheme code is the fallback, which is what a user who typed a code
 * gets. Matching on scheme *name* is deliberately not attempted — two schemes
 * differ by one word ("Growth" vs "Growth - Direct") often enough that a
 * name match would confidently price the wrong fund.
 */
export function buildIndex(rows: readonly AmfiRow[]): {
  byIsin: Map<string, AmfiRow>;
  bySchemeCode: Map<string, AmfiRow>;
} {
  const byIsin = new Map<string, AmfiRow>();
  const bySchemeCode = new Map<string, AmfiRow>();
  for (const row of rows) {
    if (row.isinPayout) byIsin.set(row.isinPayout, row);
    if (row.isinReinvest) byIsin.set(row.isinReinvest, row);
    bySchemeCode.set(row.schemeCode, row);
  }
  return { byIsin, bySchemeCode };
}

export interface AmfiOptions {
  readonly fetch: FetchLike;
  readonly navAllUrl?: string;
  readonly timeoutMs?: number;
}

export function createAmfiProvider(options: AmfiOptions): MarketDataProvider {
  const navAllUrl = options.navAllUrl ?? AMFI_NAV_ALL_URL;

  return {
    key: 'amfi',
    capabilities: CAPABILITIES,

    supports(ref: ProviderRef): boolean {
      if (ref.assetClass !== 'mutual_fund') return false;
      // Priced in rupees; a foreign-domiciled fund is not in this file.
      if (ref.currency !== INR) return false;
      return ref.isin !== null || ref.providerSymbol.trim() !== '';
    },

    async getLatestPrices(
      refs: readonly ProviderRef[],
    ): Promise<Map<ProviderRefKey, Result<PriceObservation, ProviderFailure>>> {
      const out = new Map<ProviderRefKey, Result<PriceObservation, ProviderFailure>>();
      if (refs.length === 0) return out;

      // One request for the entire Indian mutual-fund universe. Thirty funds and
      // three thousand cost the same: one file.
      const body = await getText(navAllUrl, {
        fetch: options.fetch,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      });
      if (!body.ok) {
        for (const ref of refs) out.set(refKey(ref), err(body.error));
        return out;
      }

      const parsed = parseNavAll(body.value);
      if (!parsed.ok) {
        for (const ref of refs) out.set(refKey(ref), err(parsed.error));
        return out;
      }

      const index = buildIndex(parsed.value);

      for (const ref of refs) {
        const row =
          (ref.isin !== null ? index.byIsin.get(ref.isin.toUpperCase()) : undefined) ??
          index.bySchemeCode.get(ref.providerSymbol.trim());

        if (row === undefined) {
          out.set(refKey(ref), err(failure.notFound()));
          continue;
        }

        // The instrument's own currency is the one that matters; a mismatch is a
        // provider error the registry surfaces, never a conversion (I-33).
        if (ref.currency !== INR) {
          out.set(refKey(ref), err(failure.malformed(`AMFI publishes INR NAV; instrument is ${ref.currency}`)));
          continue;
        }

        out.set(
          refKey(ref),
          ok({
            instrumentId: ref.instrumentId,
            close: row.nav,
            currency: INR,
            tradingDate: row.navDate,
            observedAt: navObservedAt(row.navDate),
            kind: 'nav',
            source: AMFI_SOURCE,
            providerRef: row.schemeCode,
          }),
        );
      }

      return out;
    },
  };
}
