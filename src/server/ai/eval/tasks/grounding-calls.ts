import 'server-only';

/**
 * The tool calls the `grounding` suite replays, and the fixed date they run on
 * ([AI-SYSTEM.md §14](../../../../../docs/AI-SYSTEM.md)).
 *
 * Each key names one call. Its result is frozen in `grounding-results.json`,
 * and `tests/integration/ai-eval-grounding.test.ts` proves the frozen result is
 * what the production handler returns over the fixture database — so the figure
 * a case expects is the engine's figure, not one written by hand.
 *
 * Kept apart from the cases so the integration test can import the calls
 * without the scorer, and so a change here is visibly a change to the fixture.
 */

/** "Today" for every case: a Thursday in mid-October, as in `tool-select`. */
export const GROUNDING_TODAY = '2026-10-15';
export const GROUNDING_BASE_CURRENCY = 'INR';

export interface GroundingCall {
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
}

const SEPTEMBER = '2026-09-15';

export const GROUNDING_CALLS = {
  expenseSepRollup: { tool: 'get_expense_summary', args: { asOf: SEPTEMBER, groupBy: 'category' } },
  expenseSepDetail: { tool: 'get_expense_summary', args: { asOf: SEPTEMBER, groupBy: 'category', depth: 'detail' } },
  expenseSepByTag: { tool: 'get_expense_summary', args: { asOf: SEPTEMBER, groupBy: 'tag' } },
  expenseSepByAccount: { tool: 'get_expense_summary', args: { asOf: SEPTEMBER, groupBy: 'account' } },
  incomeSep: { tool: 'get_income_summary', args: { asOf: SEPTEMBER } },
  cashflowSep: { tool: 'get_cashflow_summary', args: { asOf: SEPTEMBER } },
  compareOct: { tool: 'compare_periods', args: {} },
  budgetsOct: { tool: 'get_budget_status', args: {} },
  accounts: { tool: 'get_accounts', args: {} },
  netWorthCost: { tool: 'get_net_worth', args: {} },
  netWorthMarket: { tool: 'get_net_worth', args: { basis: 'market' } },
  netWorthHistory: {
    tool: 'get_net_worth_history',
    args: { dates: ['2026-06-30', '2026-07-31', '2026-08-31', '2026-09-30'] },
  },
  liabilities: { tool: 'get_liabilities', args: {} },
  assets: { tool: 'get_assets', args: {} },
  portfolio: { tool: 'get_portfolio_summary', args: {} },
  holdings: { tool: 'get_holdings', args: {} },
  allocationByClass: { tool: 'get_asset_allocation', args: {} },
} as const satisfies Record<string, GroundingCall>;

export type GroundingCallKey = keyof typeof GROUNDING_CALLS;
