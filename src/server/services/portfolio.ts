import 'server-only';

/**
 * The portfolio read path (ARCHITECTURE.md §5).
 *
 * ```
 * Server Component
 *   → portfolioSummary(ctx)
 *       → authorize            ownership, through the same guards the UI uses
 *       → repository           positions cache, read AS-IS — never rebuilt on a read
 *       → prices               PriceResult per instrument, from the cache
 *       → DOMAIN (pure)        valuation, allocation, metrics
 *   → typed result incl. coverage + staleness
 * ```
 *
 * **The read path never rebuilds.** Rebuilds happen inside the write
 * transaction that caused them (ARCHITECTURE.md §6); a read that rebuilt would
 * either need a write handle it does not have, or would silently diverge under
 * concurrency.
 *
 * This service holds no arithmetic. Every figure it returns comes from
 * `src/server/domain/`, which is the same code the AI tools will call in Phase 7
 * — that is what makes an AI answer unable to disagree with the screen.
 */

import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';

import { isoDate, type IsoDate } from '../../lib/date';
import { Money, currency, sum, type CurrencyCode } from '../../lib/decimal/money';
import { Quantity } from '../../lib/decimal/quantity';
import { Rate } from '../../lib/decimal/rate';
import { unavailable, type Metric } from '../../lib/metric';
import { ok, type DomainError, type Result } from '../../lib/result';
import {
  portfolioSummary as buildSummary,
  type PortfolioSummary,
} from '../domain/calc/portfolio';
import { xirr, type CashFlow } from '../domain/calc/xirr';
import {
  allocation as buildAllocation,
  concentration as buildConcentration,
  type Allocation,
  type AllocationDimension,
  type Concentration,
} from '../domain/pricing/allocation';
import {
  valuePortfolio,
  type AssetClass,
  type HoldingInput,
  type HoldingView,
  type PortfolioValuation,
} from '../domain/pricing/valuation';
import { accounts, instruments, investmentTransactions, lotDisposals, positions, taxLots } from '../db/schema';
import type { ReadCtx } from './_ctx';
import { quotesFor } from './prices';

export interface PortfolioScope {
  readonly accountId?: string;
  readonly instrumentId?: string;
  /** Retain positions at zero quantity, which are excluded by default. */
  readonly includeClosed?: boolean;
}

// --------------------------------------------------------------------- holdings

interface PositionRow {
  accountId: string;
  accountName: string;
  instrumentId: string;
  symbol: string;
  name: string;
  exchange: string | null;
  assetClass: AssetClass;
  instrumentCurrency: string;
  country: string | null;
  quantity: string;
  costBasis: string;
  baseCostBasis: string;
  realizedPnl: string;
  incomeTotal: string;
  feesTotal: string;
  taxesTotal: string;
}

/**
 * Today's instrument → base rate, or `null` when none exists.
 *
 * Dated **today**, because market value is today's figure. Cost basis is not
 * revalued: `base_cost_basis` was summed per lot at each lot's own acquisition
 * rate, and revaluing it would make last year's cost move every morning (§6.4).
 */
function rateToBase(ctx: ReadCtx, from: CurrencyCode): Rate | null {
  if (from === ctx.base) return Rate.one();
  const selection = ctx.fx.rate(from, ctx.base, ctx.today);
  return selection.ok ? selection.value.rate : null;
}

async function positionRows(ctx: ReadCtx, scope: PortfolioScope): Promise<PositionRow[]> {
  const conditions: SQL[] = [eq(positions.userId, ctx.userId)];
  if (scope.accountId) conditions.push(eq(positions.accountId, scope.accountId));
  if (scope.instrumentId) conditions.push(eq(positions.instrumentId, scope.instrumentId));

  return ctx.db
    .select({
      accountId: positions.accountId,
      accountName: accounts.name,
      instrumentId: positions.instrumentId,
      symbol: instruments.symbol,
      name: instruments.name,
      exchange: instruments.exchange,
      assetClass: instruments.assetClass,
      instrumentCurrency: instruments.currencyCode,
      country: instruments.country,
      quantity: positions.quantity,
      costBasis: positions.costBasis,
      baseCostBasis: positions.baseCostBasis,
      realizedPnl: positions.realizedPnl,
      incomeTotal: positions.incomeTotal,
      feesTotal: positions.feesTotal,
      taxesTotal: positions.taxesTotal,
    })
    .from(positions)
    .innerJoin(accounts, eq(accounts.id, positions.accountId))
    .innerJoin(instruments, eq(instruments.id, positions.instrumentId))
    .where(and(...conditions))
    .orderBy(asc(instruments.symbol), asc(accounts.name)) as Promise<PositionRow[]>;
}

/** Positions plus prices plus rates, valued. */
export async function holdings(
  ctx: ReadCtx,
  scope: PortfolioScope = {},
): Promise<PortfolioValuation> {
  const rows = await positionRows(ctx, scope);
  if (rows.length === 0) {
    return valuePortfolio([], { baseCurrency: ctx.base, ...(scope.includeClosed !== undefined && { includeClosed: scope.includeClosed }) });
  }

  const quotes = await quotesFor(ctx, [...new Set(rows.map((r) => r.instrumentId))]);

  const inputs: HoldingInput[] = rows.map((row) => {
    const instrumentCurrency = currency(row.instrumentCurrency.trim());
    // The rate is dated **today**, because market value is today's figure. Cost
    // basis is not revalued: `base_cost_basis` was summed per lot at each lot's
    // own acquisition rate, and revaluing it would make last year's cost move.
    const rate = rateToBase(ctx, instrumentCurrency);

    return {
      accountId: row.accountId,
      accountName: row.accountName,
      instrument: {
        id: row.instrumentId,
        symbol: row.symbol,
        name: row.name,
        exchange: row.exchange,
        assetClass: row.assetClass,
        currency: instrumentCurrency,
        country: row.country,
      },
      quantity: Quantity.fromDbString(row.quantity),
      invested: Money.fromDbString(row.costBasis, instrumentCurrency),
      baseInvested: Money.fromDbString(row.baseCostBasis, ctx.base),
      realizedPnl: Money.fromDbString(row.realizedPnl, instrumentCurrency),
      incomeTotal: Money.fromDbString(row.incomeTotal, instrumentCurrency),
      feesTotal: Money.fromDbString(row.feesTotal, instrumentCurrency),
      taxesTotal: Money.fromDbString(row.taxesTotal, instrumentCurrency),
      price: quotes.get(row.instrumentId) ?? { status: 'missing', reason: 'no_provider' },
      fxToBase: rate,
    };
  });

  return valuePortfolio(inputs, {
    baseCurrency: ctx.base,
    ...(scope.includeClosed !== undefined && { includeClosed: scope.includeClosed }),
  });
}

// ---------------------------------------------------------------- the summary

/**
 * Base-currency aggregates read straight from the ledger and the disposals.
 *
 * `costDeployed` sums `cost_total` over **every lot ever opened**, including
 * fully disposed ones — capital ever committed, which is the right denominator
 * for total return. `investedCapital` sums only what is still held.
 *
 * Account-level `fee`, `tax` and `interest` rows — those with no instrument —
 * are summed **directly from the ledger** and attributed to no holding, so they
 * reduce portfolio return without distorting any instrument's cost basis,
 * return percentage or allocation weight (§6.2).
 */
interface PortfolioAggregates {
  readonly costDeployed: Money;
  readonly realizedPnl: Money;
  readonly dividends: Money;
  readonly interest: Money;
  readonly fees: Money;
  readonly taxes: Money;
}

async function aggregates(ctx: ReadCtx, scope: PortfolioScope): Promise<PortfolioAggregates> {
  const accountFilter = scope.accountId ?? null;
  const instrumentFilter = scope.instrumentId ?? null;

  const { rows: deployed } = await ctx.db.execute<{ total: string }>(sql`
    select coalesce(sum(round(l.cost_total * l.fx_rate_to_base, 4)), 0)::text as total
      from ${taxLots} l
     where l.user_id = ${ctx.userId}
       ${accountFilter === null ? sql`` : sql`and l.account_id = ${accountFilter}`}
       ${instrumentFilter === null ? sql`` : sql`and l.instrument_id = ${instrumentFilter}`}
  `);

  const { rows: realized } = await ctx.db.execute<{ total: string }>(sql`
    select coalesce(sum(d.base_realized_pnl), 0)::text as total
      from ${lotDisposals} d
      join ${taxLots} l on l.id = d.lot_id
     where d.user_id = ${ctx.userId}
       ${accountFilter === null ? sql`` : sql`and l.account_id = ${accountFilter}`}
       ${instrumentFilter === null ? sql`` : sql`and l.instrument_id = ${instrumentFilter}`}
  `);

  // Income and charges in BASE currency, from the ledger's own base column.
  // `positions.income_total` is instrument currency and cannot be summed across
  // a multi-currency portfolio; `base_net_amount` can.
  const { rows: flows } = await ctx.db.execute<{
    dividends: string;
    interest: string;
    fees: string;
    taxes: string;
    trade_fees: string;
    trade_taxes: string;
  }>(sql`
    select
      coalesce(sum(round(i.gross_amount * i.fx_rate_instrument_to_account * i.fx_rate_to_base, 4))
               filter (where i.kind = 'dividend'), 0)::text as dividends,
      coalesce(sum(round(i.gross_amount * i.fx_rate_instrument_to_account * i.fx_rate_to_base, 4))
               filter (where i.kind = 'interest'), 0)::text as interest,
      coalesce(sum(round(abs(i.base_net_amount), 4))
               filter (where i.kind = 'fee'), 0)::text      as fees,
      coalesce(sum(round(abs(i.base_net_amount), 4))
               filter (where i.kind = 'tax'), 0)::text      as taxes,
      coalesce(sum(round(i.fees * i.fx_rate_instrument_to_account * i.fx_rate_to_base, 4))
               filter (where i.kind in ('dividend','interest')), 0)::text as trade_fees,
      coalesce(sum(round(i.taxes * i.fx_rate_instrument_to_account * i.fx_rate_to_base, 4))
               filter (where i.kind in ('dividend','interest')), 0)::text as trade_taxes
      from ${investmentTransactions} i
     where i.user_id = ${ctx.userId}
       ${accountFilter === null ? sql`` : sql`and i.account_id = ${accountFilter}`}
       ${instrumentFilter === null ? sql`` : sql`and i.instrument_id = ${instrumentFilter}`}
  `);

  const flow = flows[0] ?? {
    dividends: '0',
    interest: '0',
    fees: '0',
    taxes: '0',
    trade_fees: '0',
    trade_taxes: '0',
  };

  const base = ctx.base;
  return {
    costDeployed: Money.fromDbString(deployed[0]?.total ?? '0', base),
    realizedPnl: Money.fromDbString(realized[0]?.total ?? '0', base),
    dividends: Money.fromDbString(flow.dividends, base),
    interest: Money.fromDbString(flow.interest, base),
    // Standalone `fee` rows plus the collection charges withheld from income.
    // Trade fees appear in NEITHER — a purchase fee is inside the cost basis and
    // a sale fee has already reduced realised P&L (§6.3).
    fees: sum(
      [Money.fromDbString(flow.fees, base), Money.fromDbString(flow.trade_fees, base)],
      base,
    ),
    taxes: sum(
      [Money.fromDbString(flow.taxes, base), Money.fromDbString(flow.trade_taxes, base)],
      base,
    ),
  };
}

export interface PortfolioResult {
  readonly summary: PortfolioSummary;
  readonly holdings: readonly HoldingView[];
  readonly valuation: PortfolioValuation;
}

export async function portfolio(
  ctx: ReadCtx,
  scope: PortfolioScope = {},
): Promise<Result<PortfolioResult, DomainError>> {
  const valuation = await holdings(ctx, scope);
  const totals = await aggregates(ctx, scope);
  const flows = await portfolioCashFlows(ctx, scope, valuation.pricedValue);

  const summary = buildSummary({
    baseCurrency: ctx.base,
    asOf: ctx.today,
    investedCapital: sum(
      valuation.holdings.map((h) => h.baseInvested),
      ctx.base,
    ),
    costDeployed: totals.costDeployed,
    marketValue: valuation.pricedValue,
    realizedPnl: totals.realizedPnl,
    dividends: totals.dividends,
    interest: totals.interest,
    fees: totals.fees,
    taxes: totals.taxes,
    coverage: valuation.coverage,
    staleInstruments: valuation.stale,
    unpricedInstruments: valuation.unpriced,
    xirr: xirr(flows),
    // TWR needs a valuation at every sub-period boundary, which needs
    // `instrument_prices` history — populated in Phase 6 once OD-3 is decided.
    // Reported as the documented reason rather than as a figure from partial
    // data (INVESTMENT-DOMAIN.md §8).
    twr: unavailable('insufficient_price_history'),
  });

  return ok({ summary, holdings: valuation.holdings, valuation });
}

/**
 * The XIRR series, from the investor's perspective
 * ([INVESTMENT-DOMAIN.md §7](../../../docs/INVESTMENT-DOMAIN.md#7-xirr)).
 *
 * | Event | Sign |
 * |---|---|
 * | Purchase (incl. fees) | negative |
 * | Sale proceeds (net) | positive |
 * | Dividend / interest received | positive |
 * | Standalone fee / tax | negative |
 * | Market value of open positions at `asOf` | positive terminal flow |
 *
 * **Brokerage cash is outside the portfolio.** Idle cash is not part of the
 * terminal value — net worth counts it separately as an account balance, so
 * including it here would count it twice and make the return depend on how much
 * happened to be sitting uninvested.
 *
 * **Transfers are scope-dependent.** At portfolio scope a matched pair nets to
 * zero and both legs are excluded. At account or instrument scope an unmatched
 * leg is a real flow into or out of that scope, and enters at `gross_amount` —
 * treating it as zero because no cash moved would report an infinite return on
 * shares that appeared from nowhere.
 */
export async function portfolioCashFlows(
  ctx: ReadCtx,
  scope: PortfolioScope,
  terminalValue: Money,
): Promise<CashFlow[]> {
  const scoped = scope.accountId !== undefined || scope.instrumentId !== undefined;

  const conditions: SQL[] = [eq(investmentTransactions.userId, ctx.userId)];
  if (scope.accountId) conditions.push(eq(investmentTransactions.accountId, scope.accountId));
  if (scope.instrumentId) conditions.push(eq(investmentTransactions.instrumentId, scope.instrumentId));

  // `base_gross` is computed by the database along the same chain the row's own
  // `CHECK` constraints enforce — no float ever touches a monetary value.
  // No alias: `and(...conditions)` renders fully-qualified column names, which
  // a FROM alias would put out of scope.
  const { rows } = await ctx.db.execute<{
    kind: string;
    trade_date: string;
    base_net_amount: string;
    base_gross: string | null;
  }>(sql`
    select kind::text            as kind,
           trade_date::text      as trade_date,
           base_net_amount::text as base_net_amount,
           case when gross_amount is null then null
                else round(gross_amount * fx_rate_instrument_to_account * fx_rate_to_base, 4)::text
           end                   as base_gross
      from ${investmentTransactions}
     where ${and(...conditions)!}
     order by trade_date asc, created_at asc, id asc
  `);

  const flows: CashFlow[] = [];

  for (const row of rows) {
    const on = isoDate(row.trade_date);

    if (row.kind === 'transfer_in' || row.kind === 'transfer_out') {
      // At portfolio scope a matched pair nets to zero, so both legs are
      // dropped. At account or instrument scope an unmatched leg is a real flow
      // into or out of that scope.
      if (!scoped || row.base_gross === null) continue;
      const gross = Money.fromDbString(row.base_gross, ctx.base);
      // A transfer_in brings shares into the scope — money out, from the
      // scope's point of view. transfer_out is the mirror.
      flows.push({
        on,
        amount: row.kind === 'transfer_in' ? Money.fromMinor(-gross.minor, ctx.base) : gross,
      });
      continue;
    }

    // Corporate actions move no cash, so they contribute nothing.
    if (row.kind === 'split' || row.kind === 'bonus') continue;

    const amount = Money.fromDbString(row.base_net_amount, ctx.base);
    if (amount.minor !== 0n) flows.push({ on, amount });
  }

  if (terminalValue.minor !== 0n) {
    flows.push({ on: ctx.today, amount: terminalValue });
  }

  return flows;
}

// -------------------------------------------------------------- allocation

export async function assetAllocation(
  ctx: ReadCtx,
  dimension: AllocationDimension = 'asset_class',
  scope: PortfolioScope = {},
): Promise<Allocation> {
  const valuation = await holdings(ctx, scope);
  return buildAllocation(valuation.holdings, dimension, ctx.base);
}

export async function portfolioConcentration(
  ctx: ReadCtx,
  scope: PortfolioScope = {},
): Promise<Concentration> {
  const valuation = await holdings(ctx, scope);
  return buildConcentration(buildAllocation(valuation.holdings, 'instrument', ctx.base));
}

// ------------------------------------------------------------------- lots

export interface LotView {
  readonly id: string;
  readonly openedOn: IsoDate;
  readonly acquiredOn: IsoDate;
  readonly originalQuantity: Quantity;
  readonly remainingQuantity: Quantity;
  readonly costTotal: Money;
  readonly remainingCost: Money;
  readonly currency: CurrencyCode;
  readonly holdingDays: number;
}

/** The lot table on an instrument's detail page, oldest first — FIFO order. */
export async function lotsFor(
  ctx: ReadCtx,
  instrumentId: string,
  options: { readonly accountId?: string; readonly includeClosed?: boolean } = {},
): Promise<LotView[]> {
  const conditions: SQL[] = [
    eq(taxLots.userId, ctx.userId),
    eq(taxLots.instrumentId, instrumentId),
  ];
  if (options.accountId) conditions.push(eq(taxLots.accountId, options.accountId));
  if (options.includeClosed !== true) conditions.push(sql`${taxLots.remainingQuantity} > 0`);

  const rows = await ctx.db
    .select()
    .from(taxLots)
    .where(and(...conditions))
    .orderBy(asc(taxLots.openedOn), asc(taxLots.id));

  const today = ctx.today;
  return rows.map((row) => {
    const lotCurrency = currency(row.currencyCode.trim());
    return {
      id: row.id,
      openedOn: isoDate(row.openedOn),
      acquiredOn: isoDate(row.acquiredOn),
      originalQuantity: Quantity.fromDbString(row.originalQuantity),
      remainingQuantity: Quantity.fromDbString(row.remainingQuantity),
      costTotal: Money.fromDbString(row.costTotal, lotCurrency),
      remainingCost: Money.fromDbString(row.remainingCost, lotCurrency),
      currency: lotCurrency,
      holdingDays: Math.max(
        0,
        Math.floor(
          (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${row.acquiredOn}T00:00:00Z`)) / 86_400_000,
        ),
      ),
    };
  });
}

export interface RealizedDisposalView {
  readonly id: string;
  readonly closedOn: IsoDate;
  readonly instrumentSymbol: string;
  readonly quantity: Quantity;
  readonly proceeds: Money;
  readonly costConsumed: Money;
  readonly realizedPnl: Money;
  readonly baseRealizedPnl: Money;
  readonly baseFxComponent: Money;
  /** Derived as the difference, so the two always sum to the total (I-18). */
  readonly basePriceComponent: Money;
  readonly holdingDays: number;
}

/** Realised P&L history — one indexed scan on `lot_disposals_user_closed_idx`. */
export async function realizedDisposals(
  ctx: ReadCtx,
  options: { readonly from?: IsoDate; readonly to?: IsoDate; readonly limit?: number } = {},
): Promise<RealizedDisposalView[]> {
  const conditions: SQL[] = [eq(lotDisposals.userId, ctx.userId)];
  if (options.from) conditions.push(sql`${lotDisposals.closedOn} >= ${options.from}`);
  if (options.to) conditions.push(sql`${lotDisposals.closedOn} <= ${options.to}`);

  const rows = await ctx.db
    .select({
      disposal: lotDisposals,
      symbol: instruments.symbol,
      instrumentCurrency: instruments.currencyCode,
    })
    .from(lotDisposals)
    .innerJoin(taxLots, eq(taxLots.id, lotDisposals.lotId))
    .innerJoin(instruments, eq(instruments.id, taxLots.instrumentId))
    .where(and(...conditions))
    .orderBy(desc(lotDisposals.closedOn), desc(lotDisposals.id))
    .limit(Math.min(Math.max(options.limit ?? 200, 1), 1000));

  return rows.map(({ disposal, symbol, instrumentCurrency }) => {
    const instrumentCcy = currency(instrumentCurrency.trim());
    const baseRealized = Money.fromDbString(disposal.baseRealizedPnl, ctx.base);
    const baseFx = Money.fromDbString(disposal.baseFxComponent, ctx.base);
    return {
      id: disposal.id,
      closedOn: isoDate(disposal.closedOn),
      instrumentSymbol: symbol,
      quantity: Quantity.fromDbString(disposal.quantity),
      proceeds: Money.fromDbString(disposal.proceeds, instrumentCcy),
      costConsumed: Money.fromDbString(disposal.costConsumed, instrumentCcy),
      realizedPnl: Money.fromDbString(disposal.realizedPnl, instrumentCcy),
      baseRealizedPnl: baseRealized,
      baseFxComponent: baseFx,
      basePriceComponent: Money.fromMinor(baseRealized.minor - baseFx.minor, ctx.base),
      holdingDays: disposal.holdingDays,
    };
  });
}

export type { Metric };
