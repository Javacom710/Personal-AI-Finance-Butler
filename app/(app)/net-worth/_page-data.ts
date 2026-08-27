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

import {
  createFormatter,
  createReadCtx,
  type Formatter,
  type ReadCtx,
  type ValuationBasis,
} from '@/server/services';
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
 *
 * **The investment heading names the basis**, because that group is the only one
 * whose figure differs between the two and an unqualified "Investments" is
 * exactly the ambiguity ADR-23 exists to remove.
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

/** The same labels, with the investment heading named for the basis on show. */
export function groupLabels(basis: ValuationBasis): Record<string, string> {
  return basis === 'market'
    ? { ...GROUP_LABELS, investments: 'Investments (at market value)' }
    : GROUP_LABELS;
}

/** The restatement's three rows, in the order the engine returns them. */
export const RESTATEMENT_LABELS: Record<string, string> = {
  removed_unpriced: 'Holdings with no market price, set aside',
  fx_rebasis: 'Currency rebasis, acquisition rates to today',
  price_effect: 'Price movement since acquisition',
};

/** Why a component could not be valued. One sentence per cause, the same everywhere. */
export const EXCLUSION_REASONS: Record<string, string> = {
  no_fx_rate: 'no exchange rate on or before this date',
  unvalued: 'held, but not valued by this date',
  no_price_on_date: 'no price is stored for this date',
  no_provider: 'no price source — enter one by hand',
  not_found: 'not recognised by its price provider',
  provider_error: 'the price provider returned an error',
  rate_limited: 'the price provider is rate limited — the last price is being kept',
  unsupported_asset: 'this kind of asset is not priced by a market feed',
  delisted: 'no longer trading',
  unreconciled_corporate_action:
    'a corporate action is missing from your ledger — record it to resume valuation',
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
