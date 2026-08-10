import { describe, expect, it } from 'vitest';

import { currency, Money, toDbString } from '@/lib/decimal/money';
import { buildTree, categoryPath, rollup, subtreeIds, type CategoryNode } from '@/server/domain/calc/categories';

const INR = currency('INR');
const m = (s: string) => Money.of(s, INR);

const node = (
  id: string,
  name: string,
  parentId: string | null = null,
  kind: 'income' | 'expense' = 'expense',
  sortOrder = 0,
): CategoryNode => ({ id, parentId, name, kind, isArchived: false, sortOrder });

const NODES: CategoryNode[] = [
  node('food', 'Food', null, 'expense', 1),
  node('groceries', 'Groceries', 'food', 'expense', 0),
  node('dining', 'Dining', 'food', 'expense', 1),
  node('transport', 'Transport', null, 'expense', 2),
  node('fuel', 'Fuel', 'transport', 'expense', 0),
  node('salary', 'Salary', null, 'income', 0),
];

describe('buildTree', () => {
  it('nests children under their parents in sort order', () => {
    const tree = buildTree(NODES);
    expect(tree.map((n) => n.name)).toEqual(['Salary', 'Food', 'Transport']);

    const food = tree.find((n) => n.id === 'food')!;
    expect(food.children.map((c) => c.name)).toEqual(['Groceries', 'Dining']);
  });

  it('gives every child an empty children array, so one component renders both levels', () => {
    const food = buildTree(NODES).find((n) => n.id === 'food')!;
    expect(food.children.every((c) => c.children.length === 0)).toBe(true);
  });

  it('surfaces an orphan at the top rather than dropping it', () => {
    // Filtering a parent out of the list must not make its children disappear.
    const tree = buildTree(NODES.filter((n) => n.id !== 'food'));
    expect(tree.map((n) => n.id)).toContain('groceries');
    expect(tree.map((n) => n.id)).toContain('dining');
  });

  it('handles an empty list', () => {
    expect(buildTree([])).toEqual([]);
  });
});

describe('subtreeIds', () => {
  it('includes the category and its children', () => {
    expect([...subtreeIds(NODES, 'food')].sort()).toEqual(['dining', 'food', 'groceries']);
  });

  it('is just the leaf for a child category', () => {
    expect([...subtreeIds(NODES, 'dining')]).toEqual(['dining']);
  });

  it('is just the id for a category that is not in the list', () => {
    expect([...subtreeIds(NODES, 'unknown')]).toEqual(['unknown']);
  });
});

describe('rollup', () => {
  it('adds children into their parent — the reason the tree exists', () => {
    const direct = new Map([
      ['groceries', m('8000')],
      ['dining', m('4840')],
      ['fuel', m('3000')],
    ]);

    const rolled = rollup(NODES, direct, INR);

    // "How much did I spend on food in July?" is answerable without summing rows.
    expect(toDbString(rolled.get('food')!)).toBe('12840.0000');
    expect(toDbString(rolled.get('groceries')!)).toBe('8000.0000');
    expect(toDbString(rolled.get('transport')!)).toBe('3000.0000');
  });

  it('adds a parent’s own direct spending to its children’s', () => {
    const direct = new Map([
      ['food', m('500')],
      ['dining', m('1500')],
    ]);
    expect(toDbString(rollup(NODES, direct, INR).get('food')!)).toBe('2000.0000');
  });

  it('reports zero for a category with nothing, rather than omitting the key', () => {
    const rolled = rollup(NODES, new Map(), INR);
    expect(rolled.has('salary')).toBe(true);
    expect(toDbString(rolled.get('salary')!)).toBe('0.0000');
  });

  it('ignores a total for a category outside the node list', () => {
    const rolled = rollup(NODES, new Map([['ghost', m('999')]]), INR);
    expect(rolled.has('ghost')).toBe(false);
  });
});

describe('categoryPath', () => {
  it('shows the parent for a child', () => {
    expect(categoryPath(NODES, 'dining')).toBe('Food › Dining');
  });

  it('is the name alone for a top-level category', () => {
    expect(categoryPath(NODES, 'food')).toBe('Food');
  });

  it('is empty for an unknown id', () => {
    expect(categoryPath(NODES, 'nope')).toBe('');
  });
});
