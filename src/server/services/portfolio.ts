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

import { compareDates, isoDate, type IsoDate } from '../../lib/date';
import { Money, currency, mulRate, sum, type CurrencyCode } from '../../lib/decimal/money';
import { valueOf } from '../../lib/decimal/price';
import { Quantity, qAbs, qAdd, qScale } from '../../lib/decimal/quantity';
import { kindRank } from '../domain/lots/order';
import { Rate } from '../../lib/decimal/rate';
import { metric, unavailable, type Metric } from '../../lib/metric';
import { ok, type DomainError, type Result } from '../../lib/result';
import {
  portfolioSummary as buildSummary,
  type PortfolioSummary,
} from '../domain/calc/portfolio';
import { twr, type ExternalFlow, type TwrResult, type Valuation } from '../domain/calc/twr';
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
import { loadMarketSources, priceAt } from './_networth-market';
import { netWorthSeries } from './networth';
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

/** A time-weighted return, with how much of it rests on prices that were stale when used. */
export interface PortfolioTwrResult extends TwrResult {
  /** Boundary valuations the return was chained across. */
  readonly valuations: number;
  /**
   * How many of those included at least one holding at a **stale** price —
   * stale as of that boundary's own date. A stale price is used, never
   * withheld (ADR-28), so the figure stands; this is what lets a reader see it
   * is partly a last-known valuation rather than a current one.
   */
  readonly staleValuations: number;
  /** Whether the valuation dated today is one of them. */
  readonly staleToday: boolean;
}

export interface PortfolioResult {
  readonly summary: PortfolioSummary;
  readonly holdings: readonly HoldingView[];
  readonly valuation: PortfolioValuation;
  /** The detail behind `summary.twr`. Unavailable, with the reason, for a scoped call. */
  readonly twr: Metric<PortfolioTwrResult>;
}

export async function portfolio(
  ctx: ReadCtx,
  scope: PortfolioScope = {},
): Promise<Result<PortfolioResult, DomainError>> {
  const valuation = await holdings(ctx, scope);
  const totals = await aggregates(ctx, scope);
  const ledger = await ledgerCashFlows(ctx, scope);
  const flows = withTerminal(ctx, ledger.flows, valuation.pricedValue);

  // Whole-portfolio only. A scoped TWR needs a scoped valuation series, which
  // the net-worth composition does not offer; it stays the documented reason
  // rather than a figure for a different scope (INVESTMENT-DOMAIN.md §8).
  const twrDetail: Metric<PortfolioTwrResult> =
    scope.accountId === undefined && scope.instrumentId === undefined
      ? await twrFromFlows(ctx, ledger)
      : unavailable('insufficient_price_history');

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
    twr: twrDetail.value === null ? unavailable(twrDetail.reason) : metric(twrDetail.value.twr),
  });

  return ok({ summary, holdings: valuation.holdings, valuation, twr: twrDetail });
}

/**
 * Time-weighted return of the whole portfolio, from its first transaction to
 * today ([INVESTMENT-DOMAIN.md §8.2](../../../docs/INVESTMENT-DOMAIN.md#82-the-inputs-the-service-supplies)).
 *
 * The engine needs two things and this function only assembles them:
 *
 * - **External flows** — the XIRR series with the sign turned round and the
 *   terminal value dropped, **plus every in-kind transfer leg**. XIRR drops
 *   those at portfolio scope; TWR cannot, because the valuation rises and falls
 *   with each leg. Each leg is valued at **that day's market value** of its
 *   units, not at its recorded amount, which is the carried cost basis. A
 *   matched pair cancels on its own, and an unmatched leg is capital arriving or
 *   leaving, not performance. Money the investor paid in is a contribution to the
 *   holdings; proceeds, dividends and interest leave them, because brokerage
 *   cash is outside the portfolio. Standalone fees and taxes count as
 *   contributions that bought nothing, so the figure is net of them, exactly as
 *   XIRR is.
 * - **A valuation at every flow date** — the `investments` group of market-basis
 *   net worth on that date, which is the one historical valuation path the
 *   application has (units from the ledger, ratio-aware; the bounded carry-back;
 *   the same suppression and FX rules). That figure is the **close**, which
 *   already contains the day's trades, while the engine wants the value a flow
 *   arrives into. So the day's net flow is taken back out:
 *   `valuation(D) = close(D) − flow(D)`. The period ending at `D` then closes
 *   before the flow and the one starting at `D` opens at `close(D)`. The first
 *   boundary is the exception: nothing was held before it, so it is zero.
 *
 * **A gap is not a smaller sample.** If any holding cannot be valued on any
 * boundary, the result is `insufficient_price_history` — never a return chained
 * across the dates that happened to have prices.
 */
export async function portfolioTwr(ctx: ReadCtx): Promise<Metric<PortfolioTwrResult>> {
  return twrFromFlows(ctx, await ledgerCashFlows(ctx, {}));
}

async function twrFromFlows(ctx: ReadCtx, ledger: LedgerFlows): Promise<Metric<PortfolioTwrResult>> {
  // Net contribution per date: the investor's flow with the sign turned round.
  const netByDate = new Map<IsoDate, bigint>();
  for (const flow of ledger.flows) {
    netByDate.set(flow.on, (netByDate.get(flow.on) ?? 0n) - flow.amount.minor);
  }

  // A transfer leg is worth what its units were worth that day — the same
  // price and rate the boundary valuation uses, so the two cannot disagree. Its
  // recorded amount is the carried cost basis, and using that would book the
  // shares' appreciation before they arrived as this portfolio's return.
  if (ledger.portfolioTransfers.length > 0) {
    const dates = ledger.portfolioTransfers.map((leg) => leg.on);
    const market = await loadMarketSources(ctx, {
      from: dates.reduce((a, b) => (compareDates(a, b) <= 0 ? a : b)),
      to: dates.reduce((a, b) => (compareDates(a, b) >= 0 ? a : b)),
    });
    for (const leg of ledger.portfolioTransfers) {
      const instrument = market.instruments.get(leg.instrumentId);
      const price = instrument === undefined ? null : priceAt(market, instrument, leg.on, ctx.today);
      if (instrument === undefined || price === null || !price.ok) {
        return unavailable('insufficient_price_history');
      }
      const rate = ctx.fx.rate(instrument.currency, ctx.base, leg.on);
      if (!rate.ok) return unavailable('no_fx_rate');
      const value = mulRate(
        valueOf(closingBasisUnits(leg, ledger.corporateActions), price.price, instrument.currency, 'half_up'),
        rate.value.rate,
        'half_up',
      ).minor;
      netByDate.set(leg.on, (netByDate.get(leg.on) ?? 0n) + (leg.direction === 'in' ? value : -value));
    }
  }
  if (netByDate.size === 0) return unavailable('no_data');

  const flowDates = [...netByDate.keys()].sort(compareDates);
  const from = flowDates[0]!;
  const to = ctx.today;
  if (compareDates(from, to) >= 0) return unavailable('no_data');

  const boundaries = [...new Set([...flowDates.filter((d) => compareDates(d, to) <= 0), to])];
  const points = await netWorthSeries(ctx, boundaries, { basis: 'market' });

  const valuations: Valuation[] = [];
  let staleValuations = 0;
  let staleToday = false;
  for (const point of points) {
    if ((point.result.market?.staleness.count ?? 0) > 0) {
      staleValuations += 1;
      if (point.asOf === to) staleToday = true;
    }
    // One unvalued holding on one boundary breaks the chain.
    if (point.result.excluded.some((e) => e.group === 'investments')) {
      return unavailable('insufficient_price_history');
    }
    const close = point.result.groups.find((g) => g.group === 'investments')?.total.minor ?? 0n;
    valuations.push({
      on: point.asOf,
      // Before its first transaction the portfolio held nothing, so the first
      // boundary opens at zero — not at `close − flow`. There is no earlier
      // period to carry that difference, and using it would cancel the first
      // day's result: a purchase fee, or a fill away from the close.
      value:
        point.asOf === from
          ? Money.zero(ctx.base)
          : Money.fromMinor(close - (netByDate.get(point.asOf) ?? 0n), ctx.base),
    });
  }

  const flows: ExternalFlow[] = [...netByDate].map(([on, minor]) => ({
    on,
    amount: Money.fromMinor(minor, ctx.base),
  }));

  const result = twr({ from, to, valuations, flows });
  if (result.value === null) return unavailable(result.reason);
  return metric({ ...result.value, valuations: valuations.length, staleValuations, staleToday });
}

/**
 * A transfer leg's units on the basis the day's closing price is quoted in.
 *
 * `replay()` applies a split or bonus **after** the same day's trades, so shares
 * transferred on an ex-date are recorded pre-action while that day's close is
 * post-action. Pricing the recorded units at that close would value 100 shares
 * arriving on a 2:1 split date at half what they were worth.
 *
 * The same two operations `replay()` applies to a lot, in the same order and
 * rounding — a split scales, a bonus adds the scaled amount. The action is read
 * from the leg's own account; a leg that empties its account may have no action
 * recorded there, so another account's record of the same instrument and date
 * is used instead — one account's, never several, or the ratio would compound.
 */
function closingBasisUnits(leg: TransferLeg, actions: readonly CorporateAction[]): Quantity {
  const sameDay = actions.filter((a) => a.on === leg.on && a.instrumentId === leg.instrumentId);
  if (sameDay.length === 0) return leg.quantity;

  const own = sameDay.filter((a) => a.accountId === leg.accountId);
  const source = own.length > 0 ? own : sameDay.filter((a) => a.accountId === sameDay[0]!.accountId);

  let units = leg.quantity;
  for (const action of source) {
    units =
      action.kind === 'split'
        ? qScale(units, action.num, action.den, 'half_up')
        : qAdd(units, qScale(units, action.num, action.den, 'half_up'));
  }
  return units;
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
  return withTerminal(ctx, (await ledgerCashFlows(ctx, scope)).flows, terminalValue);
}

function withTerminal(ctx: ReadCtx, ledger: readonly CashFlow[], terminalValue: Money): CashFlow[] {
  return terminalValue.minor === 0n ? [...ledger] : [...ledger, { on: ctx.today, amount: terminalValue }];
}

/** One in-kind transfer leg at portfolio scope, as recorded. */
interface TransferLeg {
  readonly on: IsoDate;
  readonly direction: 'in' | 'out';
  readonly accountId: string;
  readonly instrumentId: string;
  /** Units as recorded — before any corporate action dated the same day. */
  readonly quantity: Quantity;
}

/** A split or bonus, for restating a same-day transfer's units onto the closing price's basis. */
interface CorporateAction {
  readonly on: IsoDate;
  readonly accountId: string;
  readonly instrumentId: string;
  readonly kind: 'split' | 'bonus';
  readonly num: bigint;
  readonly den: bigint;
}

interface LedgerFlows {
  /** The XIRR series without its terminal value. */
  readonly flows: CashFlow[];
  /**
   * Transfer legs the XIRR series drops at portfolio scope. A matched pair
   * cancels; an unmatched leg — shares gifted in, or a holding recorded when the
   * user started — is capital arriving or leaving with no cash. TWR needs every
   * leg, because the valuation moves with each one.
   *
   * Carried as **units**, not money: a transfer's recorded amount is the carried
   * cost basis, which is what the lots need and not what the shares were worth.
   * Empty for a scoped call, where the legs are already in `flows`.
   */
  readonly portfolioTransfers: TransferLeg[];
  /** In replay order. Only collected at portfolio scope, where the transfers are. */
  readonly corporateActions: CorporateAction[];
}

/** Ledger rows only, no terminal value. */
async function ledgerCashFlows(ctx: ReadCtx, scope: PortfolioScope): Promise<LedgerFlows> {
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
    account_id: string;
    instrument_id: string;
    quantity: string | null;
    ratio_num: number | null;
    ratio_den: number | null;
    base_net_amount: string;
    base_gross: string | null;
  }>(sql`
    select kind::text            as kind,
           trade_date::text      as trade_date,
           account_id::text      as account_id,
           instrument_id::text   as instrument_id,
           quantity::text        as quantity,
           ratio_num             as ratio_num,
           ratio_den             as ratio_den,
           base_net_amount::text as base_net_amount,
           case when gross_amount is null then null
                else round(gross_amount * fx_rate_instrument_to_account * fx_rate_to_base, 4)::text
           end                   as base_gross
      from ${investmentTransactions}
     where ${and(...conditions)!}
     order by trade_date asc, created_at asc, id asc
  `);

  const flows: CashFlow[] = [];
  const portfolioTransfers: TransferLeg[] = [];
  const corporateActions: CorporateAction[] = [];

  for (const row of rows) {
    const on = isoDate(row.trade_date);

    if (row.kind === 'transfer_in' || row.kind === 'transfer_out') {
      // At portfolio scope the XIRR series drops both legs, on the footing that
      // a matched pair nets to zero; they are kept aside, as units, for TWR.
      if (!scoped) {
        if (row.quantity !== null) {
          portfolioTransfers.push({
            on,
            direction: row.kind === 'transfer_in' ? 'in' : 'out',
            accountId: row.account_id,
            instrumentId: row.instrument_id,
            // Stored signed (an out is negative); the direction is carried
            // separately, so the magnitude is what is valued.
            quantity: qAbs(Quantity.fromDbString(row.quantity)),
          });
        }
        continue;
      }
      // At account or instrument scope an unmatched leg is a real flow into or
      // out of that scope.
      if (row.base_gross === null) continue;
      const gross = Money.fromDbString(row.base_gross, ctx.base);
      // A transfer_in brings shares into the scope — money out, from the
      // scope's point of view. transfer_out is the mirror.
      flows.push({
        on,
        amount: row.kind === 'transfer_in' ? Money.fromMinor(-gross.minor, ctx.base) : gross,
      });
      continue;
    }

    // Corporate actions move no cash, so they contribute nothing — but a
    // transfer dated the same day is priced at a close that already reflects
    // them, so they are kept to restate its units.
    if (row.kind === 'split' || row.kind === 'bonus') {
      if (!scoped && row.ratio_num !== null && row.ratio_den !== null) {
        corporateActions.push({
          on,
          accountId: row.account_id,
          instrumentId: row.instrument_id,
          kind: row.kind,
          num: BigInt(row.ratio_num),
          den: BigInt(row.ratio_den),
        });
      }
      continue;
    }

    const amount = Money.fromDbString(row.base_net_amount, ctx.base);
    if (amount.minor !== 0n) flows.push({ on, amount });
  }

  // Split before bonus on a shared date, as `replay()` orders them.
  corporateActions.sort((a, b) =>
    a.on !== b.on ? (a.on < b.on ? -1 : 1) : kindRank(a.kind) - kindRank(b.kind),
  );

  return { flows, portfolioTransfers, corporateActions };
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
