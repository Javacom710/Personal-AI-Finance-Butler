import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { Money, currency, sum, toDbString, type Money as MoneyValue } from '@/lib/decimal/money';
import { foldToRoots, rollup, type CategoryNode } from '@/server/domain/calc/categories';

/**
 * Invariant **I-54** — *a category row set partitions its total*
 * ([ADR-37](../../docs/DECISIONS.md#adr-37--a-breakdown-declares-whether-its-rows-partition-its-total)).
 *
 * The pure half of finding **F-3**. `breakdown()` needs a database, so its
 * end-to-end behaviour is asserted in `tests/integration/golden-g1.test.ts`;
 * what is asserted *here* is the arithmetic that makes the guarantee hold —
 * because "the rows sum to the total" is a property of a fold, not of a query,
 * and a property test over generated trees covers shapes no fixture contains.
 *
 * The defect being guarded: `rollup()` returns a figure for **every** node, and
 * a parent's figure already contains its children's. It is the right answer to
 * "what does Food come to?" and the wrong row set for "where did my money go?",
 * because summing it double-counts every parent/child pair. The project's own
 * golden test worked around this by filtering on the `›` in a label — a string
 * test standing in for a structural guarantee, which is how the defect stayed
 * invisible.
 */

const INR = currency('INR');
const money = (s: string): MoneyValue => Money.of(s, INR);
const total = (amounts: readonly MoneyValue[]): string => toDbString(sum(amounts, INR));

const node = (id: string, parentId: string | null = null): CategoryNode => ({
  id,
  parentId,
  name: id,
  kind: 'expense',
  isArchived: false,
  sortOrder: 0,
});

/** `Food → {Groceries, Dining}`, plus a childless `Housing`. */
const TREE: CategoryNode[] = [
  node('Food'),
  node('Groceries', 'Food'),
  node('Dining', 'Food'),
  node('Housing'),
];

describe('I-54 — foldToRoots partitions the input', () => {
  it('folds children onto their parent', () => {
    const folded = foldToRoots(
      TREE,
      new Map([
        ['Groceries', money('144000')],
        ['Dining', money('54000')],
        ['Housing', money('420000')],
      ]),
      INR,
    );

    const byRoot = new Map(folded.map((f) => [f.rootId, toDbString(f.total)]));
    expect(byRoot.get('Food')).toBe('198000.0000');
    expect(byRoot.get('Housing')).toBe('420000.0000');
    // `Food` is not itself a key in the input, and is still a row — that is the
    // point of a rollup. `Groceries` and `Dining` are not rows of their own.
    expect(byRoot.has('Groceries')).toBe(false);
    expect(byRoot.has('Dining')).toBe(false);
  });

  it('adds a parent’s own spending to its children’s, once', () => {
    const folded = foldToRoots(
      TREE,
      new Map([
        ['Food', money('1000')],
        ['Groceries', money('2000')],
        ['Dining', money('3000')],
      ]),
      INR,
    );

    expect(folded).toHaveLength(1);
    expect(toDbString(folded[0]!.total)).toBe('6000.0000');
    // The root comes first, so a caller can report "Food (+ 2 subcategories)".
    expect(folded[0]!.foldedIds[0]).toBe('Food');
    expect(folded[0]!.foldedIds).toHaveLength(3);
  });

  it('never double-counts, where rollup deliberately does', () => {
    const direct = new Map([
      ['Groceries', money('144000')],
      ['Dining', money('54000')],
    ]);

    // The contrast that is the whole finding. Both are correct functions; only
    // one of them produces a row set.
    const rolled = rollup(TREE, direct, INR);
    const everyNode = sum([...rolled.values()], INR);
    expect(toDbString(everyNode)).toBe('396000.0000'); // 198,000 counted twice

    const folded = foldToRoots(TREE, direct, INR);
    expect(total(folded.map((f) => f.total))).toBe('198000.0000');
  });

  it('keeps an orphan rather than dropping its amount', () => {
    // A child whose parent is absent from the node set — filtered out by kind,
    // or archived. It becomes its own root; the alternative is an amount that
    // silently vanishes between the tree and the total.
    const orphan = [node('Dining', 'Food')];
    const folded = foldToRoots(orphan, new Map([['Dining', money('54000')]]), INR);
    expect(folded).toHaveLength(1);
    expect(folded[0]!.rootId).toBe('Dining');
    expect(toDbString(folded[0]!.total)).toBe('54000.0000');
  });

  it('terminates on a cycle instead of hanging', () => {
    // `check_category_shape()` makes this impossible in the database. A loop
    // that would spin forever if that ever changed is not how one finds out.
    const cyclic = [node('A', 'B'), node('B', 'A')];
    const folded = foldToRoots(cyclic, new Map([['A', money('10')]]), INR);
    expect(total(folded.map((f) => f.total))).toBe('10.0000');
  });

  it('returns nothing for no input, rather than a zero row', () => {
    expect(foldToRoots(TREE, new Map(), INR)).toEqual([]);
  });

  it('lists the root in foldedIds only when the root itself was spent on', () => {
    // The distinction a breakdown row's `childCount` is derived from, and the
    // reason it cannot be `foldedIds.length - 1`: a parent whose children were
    // the only things spent on does not appear in its own fold. That is the
    // commonest shape in the seed category tree — `Food` has no direct entries.
    const childrenOnly = foldToRoots(
      TREE,
      new Map([
        ['Groceries', money('100')],
        ['Dining', money('200')],
      ]),
      INR,
    );
    expect(childrenOnly[0]!.foldedIds).toEqual(['Groceries', 'Dining']);
    expect(childrenOnly[0]!.foldedIds).not.toContain('Food');

    const withOwn = foldToRoots(
      TREE,
      new Map([
        ['Food', money('50')],
        ['Groceries', money('100')],
      ]),
      INR,
    );
    expect(withOwn[0]!.foldedIds[0]).toBe('Food');
    expect(withOwn[0]!.foldedIds).toHaveLength(2);
  });

  it('counts a single child as a rollup', () => {
    // The case a `length > 1` test for `isRollup` gets wrong: one child, no
    // direct spending on the parent, so `foldedIds` has exactly one entry and
    // the row is still a rollup of something other than itself.
    const oneChild = foldToRoots(TREE, new Map([['Dining', money('300')]]), INR);
    expect(oneChild).toHaveLength(1);
    expect(oneChild[0]!.rootId).toBe('Food');
    expect(oneChild[0]!.foldedIds).toEqual(['Dining']);
    expect(oneChild[0]!.foldedIds.filter((id) => id !== oneChild[0]!.rootId)).toHaveLength(1);
  });
});

describe('I-54 — the partition holds for any tree and any amounts', () => {
  /** Two-level trees, matching the depth limit the database enforces. */
  const treeAndTotals = fc
    .array(fc.integer({ min: 0, max: 3 }), { minLength: 1, maxLength: 6 })
    .chain((childCounts) => {
      const nodes: CategoryNode[] = [];
      childCounts.forEach((count, r) => {
        nodes.push(node(`r${r}`));
        for (let c = 0; c < count; c += 1) nodes.push(node(`r${r}c${c}`, `r${r}`));
      });
      return fc.record({
        nodes: fc.constant(nodes),
        amounts: fc.array(fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }), {
          minLength: nodes.length,
          maxLength: nodes.length,
        }),
      });
    });

  it('Σ folded === Σ direct, exactly, with no tolerance', () => {
    fc.assert(
      fc.property(treeAndTotals, ({ nodes, amounts }) => {
        const direct = new Map(nodes.map((n, i) => [n.id, Money.fromMinor(amounts[i]!, INR)]));

        const folded = foldToRoots(nodes, direct, INR);
        const partitioned = sum(
          folded.map((f) => f.total),
          INR,
        );
        const input = sum([...direct.values()], INR);

        expect(partitioned.minor).toBe(input.minor);
      }),
      { numRuns: 300 },
    );
  });

  it('assigns every input id to exactly one row', () => {
    fc.assert(
      fc.property(treeAndTotals, ({ nodes, amounts }) => {
        const direct = new Map(nodes.map((n, i) => [n.id, Money.fromMinor(amounts[i]!, INR)]));
        const folded = foldToRoots(nodes, direct, INR);

        const assigned = folded.flatMap((f) => f.foldedIds);
        expect(new Set(assigned).size).toBe(assigned.length);
        expect(new Set(assigned)).toEqual(new Set(direct.keys()));
      }),
      { numRuns: 300 },
    );
  });

  it('emits only roots, so no row is a descendant of another', () => {
    fc.assert(
      fc.property(treeAndTotals, ({ nodes, amounts }) => {
        const byId = new Map(nodes.map((n) => [n.id, n]));
        const direct = new Map(nodes.map((n, i) => [n.id, Money.fromMinor(amounts[i]!, INR)]));

        for (const fold of foldToRoots(nodes, direct, INR)) {
          const parentId = byId.get(fold.rootId)?.parentId ?? null;
          expect(parentId === null || !byId.has(parentId)).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });
});
