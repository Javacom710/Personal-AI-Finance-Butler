/**
 * The Overview's deterministic flags.
 *
 * Pure and free of arithmetic: every line restates a field that another page
 * already renders. Nothing here is an AI judgement, and nothing here computes a
 * financial figure — amounts arrive already formatted.
 */

export interface AttentionItem {
  readonly text: string;
  readonly href: string;
  readonly tone: 'negative' | 'warning';
}

export interface AttentionInput {
  /** `null` when net worth reconciled; otherwise the formatted residual. */
  readonly reconciliationResidual: string | null;
  /** Set only when this month's savings are negative. */
  readonly overspend: { readonly expenses: string; readonly income: string } | null;
  readonly overBudget: readonly { readonly label: string; readonly actual: string; readonly budgeted: string }[];
  readonly unpriced: readonly { readonly symbol: string }[];
  readonly stale: readonly { readonly symbol: string }[];
  /** Sources left out of net worth because they could not be valued. */
  readonly excludedFromNetWorth: number;
}

/** At most three symbols, then a count, so one line never grows without bound. */
export function symbolList(refs: readonly { readonly symbol: string }[]): string {
  const shown = refs.slice(0, 3).map((r) => r.symbol);
  return refs.length > 3 ? `${shown.join(', ')} and ${refs.length - 3} more` : shown.join(', ');
}

/** Ordered most serious first: integrity, then money, then data quality. */
export function attentionItems(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (input.reconciliationResidual !== null) {
    items.push({
      text: `Net worth did not reconcile (residual ${input.reconciliationResidual}). This is a defect, not rounding.`,
      href: '/net-worth',
      tone: 'negative',
    });
  }
  if (input.overspend !== null) {
    items.push({
      text: `Spending is ${input.overspend.expenses} against ${input.overspend.income} of income this month.`,
      href: '/money',
      tone: 'warning',
    });
  }
  for (const budget of input.overBudget) {
    items.push({
      text: `Over budget: ${budget.label}, ${budget.actual} of ${budget.budgeted}.`,
      href: '/money/budgets',
      tone: 'negative',
    });
  }
  if (input.unpriced.length > 0) {
    items.push({
      text: `No market price for ${symbolList(input.unpriced)}; it is left out of portfolio value, and portfolio returns are not shown here until it is priced.`,
      href: '/investments/holdings',
      tone: 'warning',
    });
  }
  if (input.stale.length > 0) {
    items.push({
      text: `Stale price for ${symbolList(input.stale)}; the last known price is being used.`,
      href: '/investments/holdings',
      tone: 'warning',
    });
  }
  if (input.excludedFromNetWorth > 0) {
    const one = input.excludedFromNetWorth === 1;
    items.push({
      text: `${input.excludedFromNetWorth} source${one ? ' is' : 's are'} left out of net worth because ${one ? 'it' : 'they'} could not be valued.`,
      href: '/net-worth',
      tone: 'warning',
    });
  }
  return items;
}
