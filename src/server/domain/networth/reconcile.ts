/**
 * Reconciliation — *"why is Net Worth at Cost ₹X?"*
 * ([FINANCIAL-DOMAIN.md §9.2](../../../../docs/FINANCIAL-DOMAIN.md#92-enforcement)).
 *
 * Two things, and the second is the point:
 *
 * 1. A **deterministic breakdown by source**, so every rupee in the headline can
 *    be traced to the account, lot, asset or liability it came from.
 * 2. An **independent recomputation** — the contributions map against the group
 *    subtotals — asserted equal **exactly**, with no tolerance (invariant I-22).
 *    A reconciliation that agreed by construction would prove nothing; these are
 *    two different traversals of the same data, so a bug in either shows up as a
 *    mismatch rather than as a plausible number.
 */

import { add, eq, Money, sub, sum, type CurrencyCode, type Money as MoneyValue } from '../../../lib/decimal/money';
import type { NetWorthResult } from './compose';
import type { Contribution, NetWorthGroup } from './keys';

export interface ReconciliationLine {
  readonly group: NetWorthGroup;
  readonly side: 'asset' | 'liability';
  readonly total: MoneyValue;
  readonly count: number;
  readonly sources: readonly {
    readonly keyId: string;
    readonly label: string;
    readonly base: MoneyValue;
    readonly native: MoneyValue;
    readonly rateAsOf: string;
    readonly sourceRef: { readonly type: string; readonly id: string };
  }[];
}

export interface Reconciliation {
  readonly asOf: string;
  readonly base: CurrencyCode;
  readonly lines: readonly ReconciliationLine[];
  readonly assets: MoneyValue;
  readonly liabilities: MoneyValue;
  readonly netWorth: MoneyValue;
  /**
   * `Σ contributions − (assets − liabilities)`. **Exactly zero**, always — it is
   * reported rather than asserted silently so `verify:integrity` and the UI can
   * both see the check was made.
   */
  readonly residual: MoneyValue;
  readonly balances: boolean;
}

export class ReconciliationFailed extends Error {
  constructor(readonly residual: MoneyValue) {
    super(
      `Net worth does not reconcile: the contributions map and the group subtotals ` +
        `differ by ${residual.minor} minor units. They are two traversals of the same ` +
        'data and must agree exactly (invariant I-22).',
    );
    this.name = 'ReconciliationFailed';
  }
}

/**
 * Rebuild the totals by a second path and compare.
 *
 * The first path is `compose()`'s per-side subtotal over the map. The second is
 * the group subtotals summed per side. They traverse the same contributions
 * differently, so an error in either surfaces here.
 */
export function reconcile(result: NetWorthResult): Reconciliation {
  const base = result.base;

  const assetsFromGroups = sum(
    result.groups.filter((g) => g.side === 'asset').map((g) => g.total),
    base,
  );
  const liabilitiesFromGroups = sum(
    result.groups.filter((g) => g.side === 'liability').map((g) => g.total),
    base,
  );

  const netFromGroups = sub(assetsFromGroups, liabilitiesFromGroups);
  const netFromMap = result.contributions.reduce(
    (acc, c) => add(acc, Money.fromMinor(c.base.minor, base)),
    Money.zero(base),
  );

  const residual = sub(netFromMap, netFromGroups);

  return {
    asOf: result.asOf,
    base,
    lines: linesOf(result),
    assets: assetsFromGroups,
    liabilities: liabilitiesFromGroups,
    netWorth: netFromGroups,
    residual,
    balances:
      residual.minor === 0n &&
      eq(assetsFromGroups, result.assets) &&
      eq(liabilitiesFromGroups, result.liabilities),
  };
}

/** `reconcile`, but a failure is an exception rather than a flag. */
export function assertReconciles(result: NetWorthResult): Reconciliation {
  const r = reconcile(result);
  if (!r.balances) throw new ReconciliationFailed(r.residual);
  return r;
}

function linesOf(result: NetWorthResult): ReconciliationLine[] {
  const byGroup = new Map<string, Contribution[]>();
  for (const c of result.contributions) {
    if (c.side === 'none') continue;
    const k = `${c.side}:${c.group}`;
    const list = byGroup.get(k);
    if (list) list.push(c);
    else byGroup.set(k, [c]);
  }

  return result.groups.map((g) => {
    const members = byGroup.get(`${g.side}:${g.group}`) ?? [];
    return {
      group: g.group,
      side: g.side,
      total: g.total,
      count: g.count,
      sources: members.map((c) => ({
        keyId: c.keyId,
        label: c.label,
        base: c.base,
        native: c.native,
        rateAsOf: c.rateAsOf,
        sourceRef: c.sourceRef,
      })),
    };
  });
}
