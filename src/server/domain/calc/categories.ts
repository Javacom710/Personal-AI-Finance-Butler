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

/** `Food › Dining`, for a transaction row that shows one label. */
export function categoryPath(nodes: readonly CategoryNode[], id: string): string {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const node = byId.get(id);
  if (!node) return '';
  if (node.parentId === null) return node.name;
  const parent = byId.get(node.parentId);
  return parent ? `${parent.name} › ${node.name}` : node.name;
}
