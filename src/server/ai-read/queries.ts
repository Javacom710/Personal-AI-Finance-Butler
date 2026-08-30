import 'server-only';

/**
 * The AI layer's read surface â€” one function per tool, each a thin projection
 * over the application service the UI already calls
 * ([AI-SYSTEM.md Â§8](../../../docs/AI-SYSTEM.md),
 * [ADR-21](../../../docs/DECISIONS.md#adr-21--application-services-are-a-distinct-layer-from-the-financial-engine)).
 *
 * Two consequences of calling the *same* service the screen calls: the model
 * cannot see a different number from the one on screen, because there is no
 * second implementation; and authorization is enforced on the AI path by
 * construction, because the guards live inside the only function a tool can
 * reach.
 *
 * ## Why these live here and not in `src/server/ai/`
 *
 * Every function takes an {@link AiReadCtx} and unwraps it through
 * `withFinanceReads`. That bridge is banned from `src/server/ai/**` (ADR-38), so
 * this module is the boundary: the AI zone calls these, and never a service.
 *
 * ## `userId` is never a parameter
 *
 * Not one function below accepts a user identifier, and no tool schema exposes
 * one. Identity comes from the capability, which was minted from an
 * authenticated request's `ReadCtx` and bound in a private `WeakMap`. A model
 * asking for another user's data has no argument to ask with â€” which is what
 * makes user isolation structural rather than a validation rule that could be
 * forgotten on one tool.
 */

import type { IsoDate } from '../../lib/date';
import { periodContaining, previousPeriod, type DateRange } from '../../lib/date/periods';
// Explicitly named, never a namespace import: import * as services would pull
// the write helpers into scope even though nothing calls them, and the AI read
// capability has no business naming the write boundary (ADR-35).
import {
  assetAllocation,
  breakdown,
  compareWithPrevious,
  holdings,
  listAccounts,
  listBudgetStatuses,
  listCategories,
  listInstruments,
  listInvestmentTransactions,
  listLiabilities,
  listManualAssets,
  listTransactions,
  netWorthAsOf,
  netWorthSeries,
  periodSummary,
  portfolio,
  upcomingCommitments,
} from '../services';
import type { AiReadCtx } from './index';
import { withFinanceReads } from './internal';
import * as p from './projections';

// ------------------------------------------------------------------ helpers

const currencyOf = (ai: AiReadCtx): string => ai.base;

const meta = (
  ai: AiReadCtx,
  rowCount: number,
  extra: Partial<p.ToolMeta> = {},
): p.ToolMeta => ({
  rowCount,
  truncated: false,
  currency: currencyOf(ai),
  ...extra,
});

/** A month range containing `asOf`, defaulting to the user's today. */
function monthFor(ai: AiReadCtx, asOf?: string): DateRange {
  const date = (asOf ?? ai.today) as IsoDate;
  return periodContaining(date, 'monthly', ai.fiscalYearStartMonth);
}

// ------------------------------------------------------------------ money

export async function getAccounts(ai: AiReadCtx, args: { asOf?: string } = {}) {
  return withFinanceReads(ai, async (read) => {
    const rows = await listAccounts(read, {
      ...(args.asOf ? { asOf: args.asOf as IsoDate } : {}),
    });
    const projected = rows.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      currency: a.currency as string,
      // The derived balance, never a stored column.
      balance: p.money(a.balance),
      baseBalance: p.metricMoney(a.baseBalance),
      creditLimit: p.maybeMoney(a.creditLimit),
      isActive: a.isActive,
    }));
    return p.toolOk(
      { accounts: projected },
      meta(ai, projected.length, args.asOf ? { asOf: args.asOf } : {}),
    );
  });
}

export async function getTransactions(
  ai: AiReadCtx,
  args: { from?: string; to?: string; categoryId?: string; accountId?: string; limit?: number } = {},
) {
  return withFinanceReads(ai, async (read) => {
    const limit = p.clampRows(args.limit);
    const result = await listTransactions(read, {
      ...(args.from ? { from: args.from as IsoDate } : {}),
      ...(args.to ? { to: args.to as IsoDate } : {}),
      ...(args.categoryId ? { categoryId: args.categoryId } : {}),
      ...(args.accountId ? { accountId: args.accountId } : {}),
      limit,
    });
    if (!result.ok) return p.toolErr(p.projectDomainError(result.error).code, p.projectDomainError(result.error).message);

    // `notes` is deliberately absent: the egress inventory excludes it unless a
    // tool's contract names it, and this one does not.
    const rows = result.value.rows.map((t) => ({
      id: t.id,
      kind: t.kind,
      bookedOn: t.bookedOn,
      description: t.description,
      category: t.categoryName,
      amount: p.money(t.amount),
      baseAmount: p.money(t.baseAmount),
      tags: t.tags.map((tag) => tag.name),
    }));
    const budget = p.withinByteBudget(rows);
    return p.toolOk(
      { transactions: budget.rows },
      {
        ...meta(ai, budget.rows.length),
        truncated: budget.truncated || result.value.total > result.value.rows.length,
        totalMatching: result.value.total,
        ...(args.from ? { from: args.from } : {}),
        ...(args.to ? { to: args.to } : {}),
      },
    );
  });
}

export async function getCashflowSummary(ai: AiReadCtx, args: { asOf?: string } = {}) {
  return withFinanceReads(ai, async (read) => {
    const range = monthFor(ai, args.asOf);
    const s = await periodSummary(read, range);
    return p.toolOk(
      {
        income: p.money(s.income),
        expenses: p.money(s.expenses),
        savings: p.money(s.savings),
        netCashFlow: p.money(s.netCashFlow),
        savingsRate: p.metricRate(s.savingsRate),
        fxEffect: p.money(s.fxEffect),
      },
      meta(ai, 1, { from: range.from, to: range.to }),
    );
  });
}

export async function comparePeriods(ai: AiReadCtx, args: { asOf?: string } = {}) {
  return withFinanceReads(ai, async (read) => {
    const current = monthFor(ai, args.asOf);
    const prior = previousPeriod(current, 'monthly', ai.fiscalYearStartMonth);
    const c = await compareWithPrevious(read, current, prior);
    const side = (s: (typeof c)['current']) => ({
      income: p.money(s.income),
      expenses: p.money(s.expenses),
      savings: p.money(s.savings),
    });
    return p.toolOk(
      {
        current: side(c.current),
        previous: side(c.previous),
        incomeDelta: p.money(c.income.absolute),
        expenseDelta: p.money(c.expenses.absolute),
        savingsDelta: p.money(c.savings.absolute),
      },
      meta(ai, 2, { from: current.from, to: current.to }),
    );
  });
}

/**
 * The breakdown tools â€” and the one place the additivity contract must survive
 * projection ([ADR-37](../../../docs/DECISIONS.md#adr-37--a-breakdown-declares-whether-its-rows-partition-its-total)).
 *
 * `total` and `additivity` are emitted on every response, always. A model that
 * receives rows without them will add them up; a model that receives
 * `additivity: 'overlapping'` has been told, in the data, that it must not.
 */
async function breakdownTool(
  ai: AiReadCtx,
  kind: 'income' | 'expense',
  args: { asOf?: string; groupBy?: 'category' | 'tag' | 'account'; depth?: 'rollup' | 'detail' },
) {
  return withFinanceReads(ai, async (read) => {
    const range = monthFor(ai, args.asOf);
    const result = await breakdown(
      read,
      range,
      args.groupBy ?? 'category',
      kind,
      args.depth ?? 'rollup',
    );
    const rows = result.rows.map((r) => ({
      key: r.key,
      label: r.label,
      amount: p.money(r.total),
      entryCount: r.entryCount,
      parentKey: r.parentKey,
      isRollup: r.isRollup,
      childCount: r.childCount,
    }));
    return p.toolOk(
      {
        // The answer, computed by the engine. The model never adds rows to get it.
        total: p.money(result.total),
        additivity: result.additivity,
        depth: result.depth,
        groupBy: result.groupBy,
        rows,
      },
      meta(ai, rows.length, { from: range.from, to: range.to }),
    );
  });
}

export const getExpenseSummary = (
  ai: AiReadCtx,
  args: { asOf?: string; groupBy?: 'category' | 'tag' | 'account'; depth?: 'rollup' | 'detail' } = {},
) => breakdownTool(ai, 'expense', args);

export const getIncomeSummary = (
  ai: AiReadCtx,
  args: { asOf?: string; groupBy?: 'category' | 'tag' | 'account'; depth?: 'rollup' | 'detail' } = {},
) => breakdownTool(ai, 'income', args);

export async function getBudgetStatus(ai: AiReadCtx, args: { asOf?: string } = {}) {
  return withFinanceReads(ai, async (read) => {
    const result = await listBudgetStatuses(read, {
      ...(args.asOf ? { asOf: args.asOf as IsoDate } : {}),
    });
    if (!result.ok) {
      const e = p.projectDomainError(result.error);
      return p.toolErr(e.code, e.message);
    }
    const rows = result.value.map((b) => ({
      id: b.id,
      category: b.categoryLabel,
      period: b.period,
      budgeted: p.money(b.status.budgeted),
      actual: p.money(b.status.actual),
      remaining: p.money(b.status.remaining),
      utilization: p.metricRate(b.status.utilization),
      overBudget: b.status.isOverBudget,
    }));
    return p.toolOk({ budgets: rows }, meta(ai, rows.length));
  });
}

export async function getRecurringTransactions(ai: AiReadCtx, args: { horizonDays?: number } = {}) {
  return withFinanceReads(ai, async (read) => {
    const horizon = Math.min(Math.max(args.horizonDays ?? 30, 1), 365);
    const rows = await upcomingCommitments(read, horizon);
    const projected = rows.map((c) => ({
      dueOn: c.dueOn,
      rule: c.ruleName,
      kind: c.kind,
      // Already a formatted string on the service's view; no figure to project.
      amountText: c.amountText,
      status: c.status,
    }));
    return p.toolOk({ upcoming: projected }, meta(ai, projected.length));
  });
}

export async function getCategories(ai: AiReadCtx) {
  return withFinanceReads(ai, async (read) => {
    const rows = await listCategories(read);
    const projected = rows.map((c) => ({ id: c.id, label: c.path, kind: c.kind }));
    return p.toolOk({ categories: projected }, meta(ai, projected.length));
  });
}

// -------------------------------------------------------------- net worth

export async function getAssets(ai: AiReadCtx) {
  return withFinanceReads(ai, async (read) => {
    const rows = await listManualAssets(read);
    const projected = rows.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      currency: a.currency as string,
      currentValue: p.maybeMoney(a.currentValue),
      currentValueOn: a.currentValueOn,
      acquisitionCost: p.maybeMoney(a.acquisitionCost),
    }));
    return p.toolOk({ assets: projected }, meta(ai, projected.length));
  });
}

export async function getLiabilities(ai: AiReadCtx) {
  return withFinanceReads(ai, async (read) => {
    const rows = await listLiabilities(read);
    const projected = rows.map((l) => ({
      id: l.id,
      name: l.name,
      kind: l.kind,
      shape: l.shape,
      currency: l.currency as string,
      // `null` for a transacted liability by design: its figure lives on the
      // linked account, and emitting a number here would double-count it.
      outstanding: p.maybeMoney(l.outstanding),
      emiAmount: p.maybeMoney(l.emiAmount),
      interestRate: p.maybeRate(l.interestRate),
    }));
    return p.toolOk({ liabilities: projected }, meta(ai, projected.length));
  });
}

export async function getNetWorth(ai: AiReadCtx, args: { asOf?: string; basis?: 'cost' | 'market' } = {}) {
  return withFinanceReads(ai, async (read) => {
    const result = await netWorthAsOf(read, {
      ...(args.asOf ? { asOf: args.asOf as IsoDate } : {}),
      ...(args.basis ? { basis: args.basis } : {}),
    });
    if (!result.ok) {
      const e = p.projectDomainError(result.error);
      return p.toolErr(e.code, e.message);
    }
    const nw = result.value;
    return p.toolOk(
      {
        // The basis is not optional context. An at-cost figure described as
        // "your net worth" presents acquisition cost as a market valuation.
        basis: nw.basis,
        asOf: nw.asOf,
        assets: p.money(nw.assets),
        liabilities: p.money(nw.liabilities),
        netWorth: p.money(nw.netWorth),
        assetCoverage: p.rate(nw.assetCoverage),
        liabilityCoverage: p.rate(nw.liabilityCoverage),
        groups: nw.groups.map((g) => ({ group: g.group, side: g.side, total: p.money(g.total), count: g.count })),
        excluded: nw.excluded.map((e) => ({ label: e.label, reason: e.reason })),
      },
      meta(ai, 1, { asOf: nw.asOf }),
    );
  });
}

export async function getNetWorthHistory(ai: AiReadCtx, args: { dates: readonly string[] }) {
  return withFinanceReads(ai, async (read) => {
    const dates = args.dates.slice(0, 24) as IsoDate[];
    if (dates.length === 0) return p.toolErr('invalid_input', 'Supply at least one date.');
    const points = await netWorthSeries(read, dates);
    const rows = points.map((pt) => ({
      asOf: pt.asOf,
      netWorth: p.money(pt.result.netWorth),
      assets: p.money(pt.result.assets),
      liabilities: p.money(pt.result.liabilities),
      basis: pt.result.basis,
    }));
    return p.toolOk(
      // A series of month-end *levels* has no meaningful sum, so â€” unlike a
      // breakdown â€” this result deliberately carries no total (AI-SYSTEM.md Â§8).
      { points: rows },
      meta(ai, rows.length),
    );
  });
}

// ------------------------------------------------------------- investments

export async function getInvestmentAssets(ai: AiReadCtx) {
  return withFinanceReads(ai, async (read) => {
    const rows = await listInstruments(read);
    const projected = rows.map((i) => ({
      id: i.id,
      symbol: i.symbol,
      name: i.name,
      assetClass: i.assetClass,
      currency: i.currency as string,
      exchange: i.exchange,
    }));
    return p.toolOk({ instruments: projected }, meta(ai, projected.length));
  });
}

export async function getHoldings(ai: AiReadCtx) {
  return withFinanceReads(ai, async (read) => {
    const valuation = await holdings(read);
    const rows = valuation.holdings.map((h) => ({
      instrumentId: h.instrument.id,
      symbol: h.instrument.symbol,
      name: h.instrument.name,
      assetClass: h.instrument.assetClass,
      accountName: h.accountName,
      quantity: p.quantity(h.quantity),
      avgCost: h.avgCost === null ? null : p.price(h.avgCost),
      invested: p.money(h.baseInvested),
      marketValue: p.maybeMoney(h.marketValue),
      unrealizedPnl: p.maybeMoney(h.unrealizedPnl),
      // The price's own status travels with it: a stale price contributes and
      // says so, and is never swapped for cost.
      priceStatus: h.price.status,
    }));
    const budget = p.withinByteBudget(rows);
    return p.toolOk(
      {
        holdings: budget.rows,
        pricedValue: p.money(valuation.pricedValue),
        coverage: p.rate(valuation.coverage),
        unpricedCount: valuation.unpriced.length,
      },
      { ...meta(ai, budget.rows.length), truncated: budget.truncated },
    );
  });
}

export async function getPortfolioSummary(ai: AiReadCtx) {
  return withFinanceReads(ai, async (read) => {
    const result = await portfolio(read);
    if (!result.ok) {
      const e = p.projectDomainError(result.error);
      return p.toolErr(e.code, e.message);
    }
    const s = result.value.summary;
    return p.toolOk(
      {
        asOf: s.asOf,
        investedCapital: p.money(s.investedCapital),
        marketValue: p.money(s.marketValue),
        unrealizedPnl: p.maybeMoney(s.unrealizedPnl),
        realizedPnl: p.money(s.realizedPnl),
        dividends: p.money(s.dividends),
        interest: p.money(s.interest),
        fees: p.money(s.fees),
        taxes: p.money(s.taxes),
        totalReturn: p.maybeMoney(s.totalReturn),
        totalReturnPct: p.metricRate(s.totalReturnPct),
        xirr: p.metricRate(s.xirr),
        // TWR is implemented in the engine and has no production caller, so it
        // reports `insufficient_price_history`. The reason is projected rather
        // than the absence, so the answer can say why (OD-18).
        twr: p.metricRate(s.twr),
        coverage: p.rate(s.coverage),
      },
      meta(ai, 1, { asOf: s.asOf }),
    );
  });
}

export async function getAssetAllocation(
  ai: AiReadCtx,
  args: { dimension?: 'asset_class' | 'instrument' | 'account' | 'currency' | 'country' } = {},
) {
  return withFinanceReads(ai, async (read) => {
    const allocation = await assetAllocation(read, args.dimension ?? 'asset_class');
    const rows = allocation.slices.map((s) => ({
      key: s.key,
      label: s.label,
      marketValue: p.money(s.marketValue),
      weightPct: p.metricRate(s.weightPct),
      holdingCount: s.holdingCount,
    }));
    return p.toolOk(
      {
        dimension: allocation.dimension,
        // Slices partition the priced value, and the unpriced remainder is
        // reported separately rather than folded in.
        total: p.money(allocation.total),
        additivity: 'partition' as const,
        slices: rows,
        unpricedValue: p.money(allocation.unpricedValue),
        unpricedCount: allocation.unpricedCount,
      },
      meta(ai, rows.length),
    );
  });
}

export async function getInvestmentTransactions(
  ai: AiReadCtx,
  args: { from?: string; to?: string; instrumentId?: string; limit?: number } = {},
) {
  return withFinanceReads(ai, async (read) => {
    const limit = p.clampRows(args.limit);
    const result = await listInvestmentTransactions(read, {
      ...(args.from ? { from: args.from } : {}),
      ...(args.to ? { to: args.to } : {}),
      ...(args.instrumentId ? { instrumentId: args.instrumentId } : {}),
      limit,
    });
    if (!result.ok) {
      const e = p.projectDomainError(result.error);
      return p.toolErr(e.code, e.message);
    }
    const rows = result.value.rows.map((t) => ({
      id: t.id,
      kind: t.kind,
      tradeDate: t.tradeDate,
      symbol: t.instrumentSymbol,
      // Nullable on a dividend or a fee: there is no quantity or price to
      // report, and a zero would read as one.
      quantity: t.quantity === null ? null : p.quantity(t.quantity),
      price: t.price === null ? null : p.price(t.price),
      netAmount: p.money(t.netAmount),
    }));
    const budget = p.withinByteBudget(rows);
    return p.toolOk(
      { transactions: budget.rows },
      {
        ...meta(ai, budget.rows.length),
        truncated: budget.truncated || result.value.total > result.value.rows.length,
        totalMatching: result.value.total,
      },
    );
  });
}




