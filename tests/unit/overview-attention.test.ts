import { describe, expect, it } from 'vitest';

import { attentionItems, isOverviewEmpty, symbolList, type AttentionInput } from '@app/(app)/_overview';

const clean: AttentionInput = {
  reconciliationResidual: null,
  overspend: null,
  budgetsUnavailable: null,
  overBudget: [],
  unpriced: [],
  stale: [],
  excludedFromNetWorth: 0,
};

describe('Overview — needs attention', () => {
  it('reports nothing when every check is clean', () => {
    expect(attentionItems(clean)).toEqual([]);
  });

  it('puts a reconciliation failure first and marks it negative', () => {
    const items = attentionItems({
      ...clean,
      reconciliationResidual: '₹1.00',
      overBudget: [{ label: 'Food › Dining', actual: '₹9,500.00', budgeted: '₹6,000.00' }],
    });
    expect(items[0]).toMatchObject({ href: '/net-worth', tone: 'negative' });
    expect(items[0]!.text).toContain('₹1.00');
    expect(items).toHaveLength(2);
  });

  it('restates an over-budget category with the amounts it was given', () => {
    const [item] = attentionItems({
      ...clean,
      overBudget: [{ label: 'Food › Dining', actual: '₹9,500.00', budgeted: '₹6,000.00' }],
    });
    expect(item).toEqual({
      text: 'Over budget: Food › Dining, ₹9,500.00 of ₹6,000.00.',
      href: '/money/budgets',
      tone: 'negative',
    });
  });

  it('reports a failed budget check instead of giving an all-clear', () => {
    const items = attentionItems({ ...clean, budgetsUnavailable: 'No exchange rate for USD.' });
    expect(items).toEqual([
      { text: 'Budgets could not be checked: No exchange rate for USD.', href: '/money/budgets', tone: 'warning' },
    ]);
  });

  it('flags overspending only when it is passed in', () => {
    const [item] = attentionItems({ ...clean, overspend: { expenses: '₹80,000.00', income: '₹50,000.00' } });
    expect(item!.text).toBe('Spending is ₹80,000.00 against ₹50,000.00 of income this month.');
    expect(item!.tone).toBe('warning');
  });

  it('names unpriced and stale holdings separately', () => {
    const items = attentionItems({ ...clean, unpriced: [{ symbol: 'HDFCBANK' }], stale: [{ symbol: 'NIFTYBEES' }] });
    expect(items.map((i) => i.text)).toEqual([
      'No market price for HDFCBANK; it is left out of portfolio value, and portfolio returns are not shown here until it is priced.',
      'Stale price for NIFTYBEES; the last known price is being used.',
    ]);
  });

  it('agrees in number for sources left out of net worth', () => {
    expect(attentionItems({ ...clean, excludedFromNetWorth: 1 })[0]!.text).toBe(
      '1 source is left out of net worth because it could not be valued.',
    );
    expect(attentionItems({ ...clean, excludedFromNetWorth: 3 })[0]!.text).toBe(
      '3 sources are left out of net worth because they could not be valued.',
    );
  });

  it('caps a symbol list at three and counts the rest', () => {
    expect(symbolList([{ symbol: 'A' }, { symbol: 'B' }])).toBe('A, B');
    expect(symbolList(['A', 'B', 'C', 'D', 'E'].map((symbol) => ({ symbol })))).toBe('A, B, C and 2 more');
  });
});

describe('Overview — empty state', () => {
  it('is empty only when net worth has no counted and no excluded source', () => {
    expect(isOverviewEmpty(0, 0)).toBe(true);
    // A manual asset or a liability alone is a contribution.
    expect(isOverviewEmpty(1, 0)).toBe(false);
    // A source that could not be valued is still a record.
    expect(isOverviewEmpty(0, 1)).toBe(false);
  });
});
