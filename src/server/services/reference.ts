import 'server-only';

/**
 * Reference data and a bound formatter.
 *
 * `app/**` cannot import the database or the engine (ARCHITECTURE.md §2), so
 * the currency display scales a page needs to render a figure come from here.
 * Every money figure on screen goes through `format.money`, never through
 * template interpolation, so scale and symbol are consistent across pages
 * (ARCHITECTURE.md §8).
 */

import { asc } from 'drizzle-orm';

import type { IsoDate } from '../../lib/date';
import type { Money } from '../../lib/decimal/money';
import type { Rate } from '../../lib/decimal/rate';
import {
  formatDate,
  formatDateShort,
  formatMoney,
  formatPercent,
  formatRate,
  type CurrencyDisplay,
  type MoneyFormatOptions,
} from '../../lib/format';
import { METRIC_REASON_TEXT, type Metric } from '../../lib/metric';
import { currencies } from '../db/schema';
import type { ReadCtx } from './_ctx';

export type { CurrencyDisplay } from '../../lib/format';

export async function listCurrencies(ctx: ReadCtx): Promise<CurrencyDisplay[]> {
  const rows = await ctx.db
    .select({ code: currencies.code, minorUnits: currencies.minorUnits, symbol: currencies.symbol })
    .from(currencies)
    .orderBy(asc(currencies.code));

  return rows.map((row) => ({
    code: row.code.trim(),
    minorUnits: row.minorUnits,
    symbol: row.symbol,
  }));
}

export interface Formatter {
  money(amount: Money, options?: MoneyFormatOptions): string;
  /** A metric that is unavailable renders as `—`, never as `0` — with the reason for a title attribute. */
  metricMoney(m: Metric<Money>, options?: MoneyFormatOptions): string;
  percent(r: Rate, decimals?: number): string;
  metricPercent(m: Metric<Rate>, decimals?: number): string;
  rate(r: Rate, decimals?: number): string;
  date(d: IsoDate): string;
  dateShort(d: IsoDate): string;
  reason(m: Metric<unknown>): string | undefined;
  readonly base: string;
}

const FALLBACK: CurrencyDisplay = { code: '???', minorUnits: 2, symbol: '' };

/** The em dash used wherever a metric is unavailable. Never a zero. */
export const UNAVAILABLE = '—';

export async function createFormatter(ctx: ReadCtx): Promise<Formatter> {
  const displays = new Map((await listCurrencies(ctx)).map((c) => [c.code, c]));
  const display = (code: string): CurrencyDisplay => displays.get(code) ?? { ...FALLBACK, code };

  return {
    base: ctx.base,
    money: (amount, options) =>
      formatMoney(amount, display(amount.currency), { locale: ctx.locale, ...options }),
    metricMoney: (m, options) =>
      m.value === null
        ? UNAVAILABLE
        : formatMoney(m.value, display(m.value.currency), { locale: ctx.locale, ...options }),
    percent: (r, decimals) => formatPercent(r, decimals),
    metricPercent: (m, decimals) => (m.value === null ? UNAVAILABLE : formatPercent(m.value, decimals)),
    rate: (r, decimals) => formatRate(r, decimals),
    date: formatDate,
    dateShort: formatDateShort,
    reason: (m) => (m.reason === undefined ? undefined : METRIC_REASON_TEXT[m.reason]),
  };
}
