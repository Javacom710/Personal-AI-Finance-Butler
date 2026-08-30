import 'server-only';

/**
 * The tool registry — the complete list of things a model may ask for
 * ([AI-SYSTEM.md §8](../../../../docs/AI-SYSTEM.md)).
 *
 * **Frozen, and closed.** A model cannot add a tool, widen one, or discover one
 * that is not here. Every entry names a deterministic capability that already
 * exists, because an AI capability is never a substitute for a missing
 * financial-engine one (**OD-18**) — so there is no `run_financial_scenario`
 * here, and no TWR tool, and their absence is the documented boundary rather
 * than an oversight.
 *
 * **No tool takes a user identifier.** Not one input schema below has a `userId`
 * field, and a test asserts that across the whole registry. Identity comes from
 * the capability the handler is invoked with, which was minted server-side from
 * an authenticated session. There is no argument with which a model could ask
 * for another user's data — which is what makes user isolation structural
 * rather than a validation rule somebody might forget on one tool.
 *
 * **All tools are read-only, and none can be otherwise.** A handler receives an
 * `AiReadCtx`, which carries no database handle and cannot be escalated to a
 * write context (ADR-33, ADR-35). "There is no write tool" is therefore a fact
 * about the type system, not a promise about this list.
 */

import { z } from 'zod';

import type { AiReadCtx } from '../../ai-read';
import * as reads from '../../ai-read';
import { toJsonSchema } from '../structured/validate';
import type { ToolDefinition } from '../provider/types';

/** An ISO date, checked rather than trusted — model output is untrusted input. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

const rowLimit = z.number().int().min(1).max(200).optional();
const groupBy = z.enum(['category', 'tag', 'account']).optional();
const depth = z.enum(['rollup', 'detail']).optional();

/**
 * One tool: what it is called, what it does, what it accepts, and the one
 * function that answers it.
 *
 * `authorization` is documentation of a fact, not a switch. Every handler runs
 * inside the caller's own capability and the services filter on its `userId`,
 * so the value is always `'session'` — the field exists so that a future entry
 * claiming anything else is visibly wrong.
 */
export interface AiTool<TInput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly input: z.ZodType<TInput>;
  readonly authorization: 'session';
  readonly handler: (ai: AiReadCtx, input: TInput) => Promise<unknown>;
}

function tool<TInput>(spec: AiTool<TInput>): AiTool<TInput> {
  return spec;
}

const TOOLS: readonly AiTool<never>[] = [
  tool({
    name: 'get_accounts',
    description:
      'List the user\'s accounts with their current balances. Balances are derived from the ledger, never stored.',
    input: z.object({ asOf: isoDate.optional() }).strict(),
    authorization: 'session',
    handler: (ai, input) => reads.getAccounts(ai, input),
  }),
  tool({
    name: 'get_transactions',
    description:
      'List individual transactions in a date range. Prefer get_expense_summary or get_income_summary when the question is about totals.',
    input: z
      .object({
        from: isoDate.optional(),
        to: isoDate.optional(),
        categoryId: z.string().uuid().optional(),
        accountId: z.string().uuid().optional(),
        limit: rowLimit,
      })
      .strict(),
    authorization: 'session',
    handler: (ai, input) => reads.getTransactions(ai, input),
  }),
  tool({
    name: 'get_cashflow_summary',
    description:
      'Income, expenses, savings and savings rate for the month containing a date. Use this for "how much did I save".',
    input: z.object({ asOf: isoDate.optional() }).strict(),
    authorization: 'session',
    handler: (ai, input) => reads.getCashflowSummary(ai, input),
  }),
  tool({
    name: 'get_expense_summary',
    description:
      'Spending for a month, grouped. Returns the authoritative total plus rows. Read the additivity field: when it is "overlapping" the rows do NOT sum to the total and must not be added.',
    input: z.object({ asOf: isoDate.optional(), groupBy, depth }).strict(),
    authorization: 'session',
    handler: (ai, input) => reads.getExpenseSummary(ai, input),
  }),
  tool({
    name: 'get_income_summary',
    description:
      'Income for a month, grouped. Returns the authoritative total plus rows. Read the additivity field before adding anything.',
    input: z.object({ asOf: isoDate.optional(), groupBy, depth }).strict(),
    authorization: 'session',
    handler: (ai, input) => reads.getIncomeSummary(ai, input),
  }),
  tool({
    name: 'compare_periods',
    description: 'Compare the month containing a date against the month before it.',
    input: z.object({ asOf: isoDate.optional() }).strict(),
    authorization: 'session',
    handler: (ai, input) => reads.comparePeriods(ai, input),
  }),
  tool({
    name: 'get_budget_status',
    description: 'Budgets with budgeted, actual, remaining and utilisation for the current period.',
    input: z.object({ asOf: isoDate.optional() }).strict(),
    authorization: 'session',
    handler: (ai, input) => reads.getBudgetStatus(ai, input),
  }),
  tool({
    name: 'get_recurring_transactions',
    description: 'Upcoming recurring commitments within a horizon in days.',
    input: z.object({ horizonDays: z.number().int().min(1).max(365).optional() }).strict(),
    authorization: 'session',
    handler: (ai, input) => reads.getRecurringTransactions(ai, input),
  }),
  tool({
    name: 'get_categories',
    description: 'The user\'s category list, with full paths such as "Food › Dining".',
    input: z.object({}).strict(),
    authorization: 'session',
    handler: (ai) => reads.getCategories(ai),
  }),
  tool({
    name: 'get_assets',
    description: 'Manually tracked assets — property, vehicles, gold — with their current valuations.',
    input: z.object({}).strict(),
    authorization: 'session',
    handler: (ai) => reads.getAssets(ai),
  }),
  tool({
    name: 'get_liabilities',
    description:
      'Liabilities with outstanding balances. A transacted liability reports null: its figure lives on the linked account and adding both would double-count.',
    input: z.object({}).strict(),
    authorization: 'session',
    handler: (ai) => reads.getLiabilities(ai),
  }),
  tool({
    name: 'get_net_worth',
    description:
      'Net worth on a date. Always state the basis: "cost" is acquisition cost, "market" is current valuation. They are different figures and must never be described interchangeably.',
    input: z.object({ asOf: isoDate.optional(), basis: z.enum(['cost', 'market']).optional() }).strict(),
    authorization: 'session',
    handler: (ai, input) => reads.getNetWorth(ai, input),
  }),
  tool({
    name: 'get_net_worth_history',
    description:
      'Net worth at each of the supplied dates. These are levels, not flows — they must never be summed.',
    input: z.object({ dates: z.array(isoDate).min(1).max(24) }).strict(),
    authorization: 'session',
    handler: (ai, input) => reads.getNetWorthHistory(ai, input),
  }),
  tool({
    name: 'get_investment_assets',
    description: 'The instruments the user holds or has held — what is owned, independent of quantity.',
    input: z.object({}).strict(),
    authorization: 'session',
    handler: (ai) => reads.getInvestmentAssets(ai),
  }),
  tool({
    name: 'get_holdings',
    description:
      'Current positions with quantity, cost and market value. priceStatus says whether each price is live, cached, stale or missing; an unpriced holding is excluded from value, never valued at cost.',
    input: z.object({}).strict(),
    authorization: 'session',
    handler: (ai) => reads.getHoldings(ai),
  }),
  tool({
    name: 'get_portfolio_summary',
    description:
      'Portfolio totals: invested capital, market value, realised and unrealised P&L, XIRR. A metric with a null value carries an unavailableReason — report the reason, never zero.',
    input: z.object({}).strict(),
    authorization: 'session',
    handler: (ai) => reads.getPortfolioSummary(ai),
  }),
  tool({
    name: 'get_asset_allocation',
    description: 'Portfolio allocation by asset class, instrument, account, currency or country.',
    input: z
      .object({
        dimension: z.enum(['asset_class', 'instrument', 'account', 'currency', 'country']).optional(),
      })
      .strict(),
    authorization: 'session',
    handler: (ai, input) => reads.getAssetAllocation(ai, input),
  }),
  tool({
    name: 'get_investment_transactions',
    description: 'The investment ledger — buys, sells, dividends, fees — in a date range.',
    input: z
      .object({
        from: isoDate.optional(),
        to: isoDate.optional(),
        instrumentId: z.string().uuid().optional(),
        limit: rowLimit,
      })
      .strict(),
    authorization: 'session',
    handler: (ai, input) => reads.getInvestmentTransactions(ai, input),
  }),
] as unknown as readonly AiTool<never>[];

const BY_NAME: ReadonlyMap<string, AiTool<never>> = new Map(TOOLS.map((t) => [t.name, t]));

export function allTools(): readonly AiTool<never>[] {
  return TOOLS;
}

export function findTool(name: string): AiTool<never> | undefined {
  return BY_NAME.get(name);
}

/**
 * The registry as the provider sees it.
 *
 * `.strict()` on every input schema becomes `additionalProperties: false`, so a
 * model inventing an argument is rejected rather than having it silently
 * dropped — an invented argument is evidence the model misunderstood the task,
 * and discarding the evidence loses the signal.
 */
export function toolDefinitions(): readonly ToolDefinition[] {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: toJsonSchema(t.input as z.ZodType, t.name),
  }));
}
