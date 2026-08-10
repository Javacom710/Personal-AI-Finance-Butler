import 'server-only';

/**
 * The application-service surface.
 *
 * `app/**` imports from here and nowhere deeper: the lint boundary forbids it
 * reaching `src/server/db/**` or `src/server/domain/**` (ARCHITECTURE.md §2).
 * The engine types a page needs — `BudgetStatus`, `CashflowSummary` — are
 * re-exported as types so a page can render them without importing the engine.
 */

export type { ReadCtx, WriteCtx } from './_ctx';
export { createReadCtx, withWriteCtx } from './_ctx';

export type { BudgetStatus } from '../domain/calc/budget';
export type { CashflowSummary, CashflowComparison, PeriodDelta } from '../domain/calc/cashflow';
export type { CategoryNode, CategoryTreeNode } from '../domain/calc/categories';
export type { AccountKind, AccountRole } from '../domain/ledger/balance';
export type { CategoryKind, TransactionKind } from '../domain/ledger/entries';
export type { DateRange, PeriodKind } from '../../lib/date/periods';

export * from './accounts';
export * from './budgets';
export * from './cashflow';
export * from './categories';
export * from './recurring';
export * from './reference';
export * from './tags';
export * from './transactions';
export * from './transfers';
