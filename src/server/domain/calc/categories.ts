/**
 * The category tree and its rollup (FINANCIAL-DOMAIN.md §5).
 *
 * Two levels, no more. A parent's total includes its children's — which is the
 * whole reason the tree exists: `CLAUDE.md`'s worked example is *"how much did I
 * spend on food in July?"*, and if `Groceries` and `Dining` were top-level
 * siblings that question would have no category to resolve to.
 *
 * Pure. The recursive walk is bounded by the depth limit, so there is no
 * cycle-detection machinery here — a cycle cannot exist: the database trigger
 * `check_category_shape()` refuses a parent that itself has one.
 */

import { sum, type CurrencyCode, type Money } from '../../../lib/decimal/money';
import type { CategoryKind } from '../ledger/entries';

export interface CategoryNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly kind: CategoryKind;
  readonly isArchived: boolean;
  readonly sortOrder: number;
}

export interface CategoryTreeNode extends CategoryNode {
  readonly children: readonly CategoryTreeNode[];
}

const byOrder = (a: CategoryNode, b: CategoryNode): number =>
  a.sortOrder === b.sortOrder ? a.name.localeCompare(b.name) : a.sortOrder - b.sortOrder;

/** Build the two-level tree. Orphans (a parent filtered out) surface at the top rather than vanishing. */
export function buildTree(nodes: readonly CategoryNode[]): CategoryTreeNode[] {
  const present = new Set(nodes.map((n) => n.id));
  const childrenOf = new Map<string, CategoryNode[]>();
  const roots: CategoryNode[] = [];

  for (const node of nodes) {
    if (node.parentId !== null && present.has(node.parentId)) {
      const siblings = childrenOf.get(node.parentId) ?? [];
      siblings.push(node);
      childrenOf.set(node.parentId, siblings);
    } else {
      roots.push(node);
    }
  }

  // Children carry an empty `children` array rather than being a different type:
  // the depth limit guarantees they have none, and one node shape means the UI
  // renders both levels with the same component.
  return roots.sort(byOrder).map((root) => ({
    ...root,
    children: (childrenOf.get(root.id) ?? [])
      .sort(byOrder)
      .map((child) => ({ ...child, children: [] as CategoryTreeNode[] })),
  }));
}

/**
 * A category and everything beneath it.
 *
 * This is the id set a category report filters on: asking for `Food` must
 * include `Groceries` and `Dining`, and asking for `Dining` must include only
 * itself.
 */
export function subtreeIds(nodes: readonly CategoryNode[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  for (const node of nodes) {
    if (node.parentId === rootId) ids.add(node.id);
  }
  return ids;
}

/**
 * Roll leaf totals up into their parents.
 *
 * The returned map holds a figure for every category in `nodes`, including ones
 * with no direct spending of their own — a parent whose children were the only
 * things spent on still has a total, and a category with nothing at all reports
 * zero rather than being absent, so a report never has to distinguish "no key"
 * from "no spending".
 */
export function rollup(
  nodes: readonly CategoryNode[],
  directTotals: ReadonlyMap<string, Money>,
  base: CurrencyCode,
): Map<string, Money> {
  const contributions = new Map<string, Money[]>();
  for (const node of nodes) contributions.set(node.id, []);

  for (const node of nodes) {
    const own = directTotals.get(node.id);
    if (own === undefined) continue;
    contributions.get(node.id)!.push(own);
    if (node.parentId !== null && contributions.has(node.parentId)) {
      contributions.get(node.parentId)!.push(own);
    }
  }

  const out = new Map<string, Money>();
  for (const [id, parts] of contributions) out.set(id, sum(parts, base));
  return out;
}

/**
 * One category's contribution to a partition of the period total.
 *
 * `foldedIds` names every category whose direct spending was added into
 * `total` — the root itself first, then its descendants. It is what lets a
 * caller say "Food (Groceries + Dining)" without re-deriving the tree, and what
 * `childCount` on a breakdown row is computed from.
 */
export interface RootFold {
  readonly rootId: string;
  readonly total: Money;
  readonly foldedIds: readonly string[];
}

/**
 * Fold each category's **direct** total onto its top-level ancestor *within the
 * given node set*.
 *
 * This is the additive half of the breakdown contract
 * ([ADR-37](../../../../docs/DECISIONS.md#adr-37--a-breakdown-declares-whether-its-rows-partition-its-total)).
 * `rollup` answers "what does Food come to?" for **one** category and is right
 * for that; it is wrong as a row set, because it returns a figure for every node
 * and a parent's figure already contains its children's. Summing that row set
 * double-counts every parent/child pair — finding **F-3**.
 *
 * Here every input amount lands in exactly one output entry, so
 * `Σ output.total === Σ direct.values()` **by construction** rather than by
 * assertion. A node whose parent is absent from `nodes` — filtered out by kind,
 * or archived away — is its own root rather than being dropped, so no amount can
 * silently disappear between the tree and the total.
 *
 * The walk is bounded by a visited set rather than by the depth limit. The
 * database trigger `check_category_shape()` makes a cycle impossible today; a
 * loop that would hang if it ever became possible is not a good way to find out.
 */
export function foldToRoots(
  nodes: readonly CategoryNode[],
  direct: ReadonlyMap<string, Money>,
  base: CurrencyCode,
): RootFold[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const rootOf = (id: string): string => {
    let current = id;
    const seen = new Set<string>([current]);
    for (;;) {
      const node = byId.get(current);
      if (!node?.parentId) return current;
      if (!byId.has(node.parentId) || seen.has(node.parentId)) return current;
      current = node.parentId;
      seen.add(current);
    }
  };

  const parts = new Map<string, Money[]>();
  const folded = new Map<string, string[]>();

  for (const [id, amount] of direct) {
    const root = rootOf(id);
    (parts.get(root) ?? parts.set(root, []).get(root)!).push(amount);
    const ids = folded.get(root) ?? folded.set(root, []).get(root)!;
    // The root first, so `foldedIds[0]` is always the row's own category.
    if (id === root) ids.unshift(id);
    else ids.push(id);
  }

  return [...parts].map(([rootId, amounts]) => ({
    rootId,
    total: sum(amounts, base),
    foldedIds: folded.get(rootId) ?? [],
  }));
}

/** `Food › Dining`, for a transaction row that shows one label. */
export function categoryPath(nodes: readonly CategoryNode[], id: string): string {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const node = byId.get(id);
  if (!node) return '';
  if (node.parentId === null) return node.name;
  const parent = byId.get(node.parentId);
  return parent ? `${parent.name} › ${node.name}` : node.name;
}
