/**
 * Postgres ENUM types (SCHEMA.md, Conventions): "a bad value cannot be
 * inserted from any client" — including from psql, a restore, or a future
 * script that bypasses the application.
 *
 * Phase 2 defined identity and operational enums; Phase 3 adds the money ones.
 * Investment and AI enums arrive with the tables that use them.
 */

import { pgEnum } from 'drizzle-orm/pg-core';

/** SCHEMA.md §1 */
export const authEventKind = pgEnum('auth_event_kind', [
  'login_success',
  'login_failure',
  'totp_failure',
  'logout',
  'password_change',
  'lockout',
  'session_revoked',
]);

/** SCHEMA.md §11 — who caused a mutation. `ai_confirmed` is a user confirming an AI proposal. */
export const auditActor = pgEnum('audit_actor', ['user', 'system', 'ai_confirmed']);

/** SCHEMA.md §11 */
export const jobStatus = pgEnum('job_status', ['pending', 'running', 'done', 'failed']);

// ------------------------------------------------------------ money (Phase 3)

/**
 * SCHEMA.md §4. A brokerage/demat account is an `accounts` row of kind
 * `brokerage`, not a parallel account system — its cash balance and its
 * investment transactions therefore live in one place.
 */
export const accountKind = pgEnum('account_kind', [
  'bank',
  'cash',
  'credit_card',
  'wallet',
  'brokerage',
  'loan',
  'other',
]);

/** SCHEMA.md §4. Transfers carry no category, which is why there is no third member. */
export const categoryKind = pgEnum('category_kind', ['income', 'expense']);

/** SCHEMA.md §4.1 */
export const transactionKind = pgEnum('transaction_kind', ['income', 'expense', 'transfer']);

/**
 * How a record came to exist. `ai` and `import` have no producer until Phases 9
 * and beyond; the values are defined now because adding an enum member later
 * requires a migration and they are part of the reviewed schema.
 */
export const recordSource = pgEnum('record_source', ['manual', 'ai', 'recurring', 'import']);

/** SCHEMA.md §4.2 */
export const budgetPeriod = pgEnum('budget_period', ['monthly', 'quarterly', 'yearly']);

/**
 * SCHEMA.md §4.3. `investment` is defined but rejected by the Phase 3 service
 * layer: an investment template cannot be validated before the investment
 * ledger exists (Phase 4).
 */
export const recurringKind = pgEnum('recurring_kind', [
  'income',
  'expense',
  'transfer',
  'investment',
]);

/** SCHEMA.md §4.3 */
export const occurrenceStatus = pgEnum('occurrence_status', ['pending', 'posted', 'skipped']);

// ------------------------------------------------------- investments (Phase 4)

/**
 * SCHEMA.md §5. Adding a class later is a migration on this one enum plus an
 * allocation label — the lot engine is class-agnostic and does not change.
 */
export const assetClass = pgEnum('asset_class', [
  'equity',
  'mutual_fund',
  'etf',
  'bond',
  'fixed_deposit',
  'gold',
  'crypto',
  'cash_equivalent',
  'other',
]);

/**
 * SCHEMA.md §5, ADR-07. The disposal-matching strategy is the only thing that
 * varies between cost-basis methods, which is why it is one enum and one
 * `select()` implementation rather than a second engine. Only `fifo` is
 * implemented at launch; the other two are interface-only
 * ([INVESTMENT-DOMAIN.md §4](../../../../docs/INVESTMENT-DOMAIN.md#4-cost-basis-engine-default-fifo)).
 */
export const costBasisMethod = pgEnum('cost_basis_method', ['fifo', 'average', 'specific_id']);

/** SCHEMA.md §6. */
export const investmentKind = pgEnum('investment_kind', [
  'buy',
  'sell',
  'dividend',
  'interest',
  'fee',
  'tax',
  'bonus',
  'split',
  'mf_purchase',
  'mf_redemption',
  'transfer_in',
  'transfer_out',
]);
