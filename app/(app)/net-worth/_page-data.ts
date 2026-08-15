import 'server-only';

/**
 * Shared page loading for the Net Worth area.
 *
 * Mirrors `money/_page-data.ts`: one read context and one formatter per request,
 * built once rather than repeated with slightly different options per page.
 *
 * **No page in this area computes a financial figure.** Not a subtotal, not a
 * percentage, not a currency conversion — a page that computed its own subtotal
 * would be the second implementation
 * [FINANCIAL-DOMAIN.md §10.5](../../../docs/FINANCIAL-DOMAIN.md#105-single-implementation-per-concept)
 * exists to forbid. Everything below renders a `NetWorthResult`.
 */

import { createFormatter, createReadCtx, type Formatter, type ReadCtx } from '@/server/services';
import { requireSession } from '@/server/auth/guards';

export interface NetWorthPageContext {
  readonly ctx: ReadCtx;
  readonly format: Formatter;
}

export async function loadNetWorthContext(path: string): Promise<NetWorthPageContext> {
  const session = await requireSession(path);
  const read = await createReadCtx(session.userId);

  if (!read.ok) {
    throw new Error(
      'This account has no settings row, so no base currency is known. Re-provision it with npm run auth:create-user.',
    );
  }

  return { ctx: read.value, format: await createFormatter(read.value) };
}

/**
 * The label every net-worth group carries.
 *
 * A display concern only — the grouping itself is decided by the engine, and
 * these strings never participate in a total.
 */
export const GROUP_LABELS: Record<string, string> = {
  cash: 'Cash and bank',
  brokerage_cash: 'Brokerage cash',
  investments: 'Investments (at cost)',
  property: 'Property',
  vehicle: 'Vehicles',
  gold_physical: 'Physical gold',
  collectible: 'Collectibles',
  receivable: 'Receivables',
  other_assets: 'Other assets',
  credit_card: 'Credit cards',
  loans: 'Loans',
  overdrawn_accounts: 'Overdrawn accounts',
  other_liabilities: 'Other liabilities',
};

/** The waterfall's row labels, in the order the bridge returns them. */
export const BRIDGE_LABELS: Record<string, string> = {
  savings: 'Savings',
  investment_income: 'Investment income',
  investment_costs: 'Investment costs',
  realized_pnl: 'Realised P&L',
  unrealized_gain: 'Unrealised investment gain',
  investment_transfers: 'Investment transfers in / out',
  asset_revaluation: 'Asset revaluation',
  asset_additions: 'Assets acquired / disposed',
  liability_change: 'Liability change',
  fx_effect: 'FX effect',
};

/** Where a contribution's drill-down link points. */
export function sourceHref(ref: { type: string; id: string }): string | null {
  switch (ref.type) {
    case 'account':
      return `/money/accounts/${ref.id}`;
    case 'instrument':
      return `/investments/holdings/${ref.id}`;
    case 'manual_asset':
      return `/net-worth/assets`;
    case 'liability':
      return `/net-worth/liabilities`;
    default:
      return null;
  }
}
