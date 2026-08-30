import 'server-only';

/**
 * The application-service surface.
 *
 * `app/**` imports from here and nowhere deeper: the lint boundary forbids it
 * reaching `src/server/db/**` or `src/server/domain/**` (ARCHITECTURE.md §2).
 * The engine types a page needs — `BudgetStatus`, `CashflowSummary` — are
 * re-exported as types so a page can render them without importing the engine.
 */

// `RequestCtx` is what `createReadCtx` returns and what `withWriteCtx` requires
// (ADR-33). `app/**` server actions hold one; the AI layer holds an `AiReadCtx`
// from `@/server/ai-read`, which is not a `ReadCtx` and cannot escalate.
export type { ReadCtx, RequestCtx, WriteCtx, TransactionOpener } from './_ctx';
export { createReadCtx, withWriteCtx, withWriteCtxResult } from './_ctx';

export type { BudgetStatus } from '../domain/calc/budget';
export type { CashflowSummary, CashflowComparison, PeriodDelta } from '../domain/calc/cashflow';
export type { CategoryNode, CategoryTreeNode } from '../domain/calc/categories';
export type { AccountKind, AccountRole } from '../domain/ledger/balance';
export type { CategoryKind, TransactionKind } from '../domain/ledger/entries';
export type { DateRange, PeriodKind } from '../../lib/date/periods';

// Investment engine types a page renders without importing the engine itself.
export type { InvestmentKind } from '../domain/lots/order';
export type { CostBasisMethod } from '../domain/lots/fifo';
export type { PriceResult, MissingPriceReason } from '../domain/pricing/price-result';
export { describeMissing } from '../domain/pricing/price-result';
export type { AssetClass, HoldingView, PortfolioValuation } from '../domain/pricing/valuation';
export type {
  Allocation,
  AllocationDimension,
  AllocationSlice,
  Concentration,
} from '../domain/pricing/allocation';
export type { PortfolioSummary, GrowthPoint, GrowthSeries } from '../domain/calc/portfolio';

// Net worth types a page renders without importing the engine itself.
export type {
  Contribution,
  ExcludedComponent,
  ExclusionReason,
  NetWorthGroup,
  PriceProvenance,
  SourceKey,
} from '../domain/networth/keys';
export type { GroupSubtotal, ValuationBasis } from '../domain/networth/compose';
export type { MarketValuation, ValuationStatus } from '../domain/networth/market';
export type { Restatement, RestatementLine } from '../domain/networth/restate';
export type { ReconciliationLine } from '../domain/networth/reconcile';
export type { BridgeLine, BridgeLineKey } from '../domain/networth/bridge';

export * from './accounts';
export * from './assets';
export * from './liabilities';
export * from './networth';
export * from './budgets';
export * from './cashflow';
export * from './categories';
export * from './instruments';
export * from './investments';
export * from './portfolio';
export * from './positions';
export * from './prices';
export * from './recurring';
export * from './reference';
export * from './tags';
export * from './transactions';
export * from './transfers';
