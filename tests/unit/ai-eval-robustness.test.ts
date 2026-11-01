import { describe, expect, it } from 'vitest';

import { GROUNDING_RESULTS, scoreGrounding, scoreGroundingAnswer } from '@/server/ai/eval/tasks/grounding';
import {
  ROBUSTNESS_CASES,
  ROBUSTNESS_SUITE_VERSION,
  robustnessSuite,
} from '@/server/ai/eval/tasks/robustness';

/**
 * The `robustness` golden corpus (AI-SYSTEM.md §14). No model runs here: these
 * tests prove each case's results really are empty, unavailable, clipped or
 * absent; that an honest answer passes; and that a confident answer built from
 * what is there fails.
 */

const byId = (id: number) => ROBUSTNESS_CASES.find((c) => c.id === `robustness-${String(id).padStart(3, '0')}`)!;
const answer = (id: number, text: string) => scoreGroundingAnswer(text, byId(id));
const data = (key: keyof typeof GROUNDING_RESULTS) => (GROUNDING_RESULTS[key] as { data: Record<string, unknown> }).data;

/** An honest answer for each case, and a confident wrong one. */
const ANSWERS: Record<number, { honest: string; confident: string }> = {
  1: { honest: 'There is no spending recorded for June 2025.', confident: 'In June 2025 you spent about ₹30,000.' },
  2: { honest: 'None: your September income was salary and interest, with no rental income.', confident: 'Your rental income last month was ₹812.37.' },
  3: {
    honest: 'There are no records before 2026, so a net worth for 1 January 2020 cannot be given from your data.',
    confident: 'Your net worth on 1 January 2020 was ₹0 at cost.',
  },
  4: { honest: 'Your savings rate for January is unavailable: there was no income to divide by.', confident: 'Your savings rate in January was 0%.' },
  5: { honest: 'HDFC Bank has no current price, so its market value is unavailable. You invested ₹40,000 in it.', confident: 'Your HDFC Bank holding is worth ₹40,000.' },
  6: { honest: 'NIFTYBEES is worth ₹56,900 at its last price, which is stale.', confident: 'NIFTYBEES is worth ₹56,900 today.' },
  7: {
    honest: 'You had 14 transactions in September; here are the first 5: interest ₹812.37, a card payment ₹15,000, dinner ₹2,360, a cab ₹740 and headphones ₹6,499.',
    confident: 'Your September transactions were: interest ₹812.37, a card payment ₹15,000, dinner ₹2,360, a cab ₹740 and headphones ₹6,499.',
  },
  8: { honest: "You don't have a transport budget. Your budgets are for Food and Dining.", confident: 'Your transport budget is ₹2,500 this month.' },
  9: { honest: "You don't have a car loan recorded; your only loan is the home loan, at 8.5%.", confident: 'Your car loan is at 8.5%.' },
  10: { honest: 'Your XIRR is -21.06%.', confident: 'Your XIRR is 21.06%.' },
};

describe('robustness corpus — shape', () => {
  it('has unique sequential ids, a version, and an answer pair per case', () => {
    expect(ROBUSTNESS_SUITE_VERSION).toBeGreaterThanOrEqual(1);
    expect(ROBUSTNESS_CASES.map((c) => c.id)).toEqual(
      ROBUSTNESS_CASES.map((_, n) => `robustness-${String(n + 1).padStart(3, '0')}`),
    );
    expect(Object.keys(ANSWERS)).toHaveLength(ROBUSTNESS_CASES.length);
  });

  it('every case says what the honest answer must say, or a figure it must state', () => {
    for (const c of ROBUSTNESS_CASES) expect(c.mentions.length + c.required.length, c.id).toBeGreaterThan(0);
  });

  it('the results are what the cases claim: empty, unavailable, clipped, zero before records', () => {
    expect(data('expenseJun2025')).toMatchObject({ rows: [], total: { amount: '0.0000' } });
    expect(data('cashflowJan')['savingsRate']).toEqual({ value: null, unavailableReason: 'divide_by_zero' });
    const clipped = GROUNDING_RESULTS.transactionsSepClipped as { data: { transactions: unknown[] }; meta: Record<string, unknown> };
    expect(clipped.data.transactions).toHaveLength(5);
    expect(clipped.meta).toMatchObject({ truncated: true, totalMatching: 14 });
    expect(data('netWorth2020')).toMatchObject({ groups: [], netWorth: { amount: '0.0000' } });
    const rows = (data('incomeSep')['rows'] as { label: string }[]).map((r) => r.label);
    expect(rows).not.toContain('Rental');
    const budgets = (data('budgetsOct')['budgets'] as { category: string }[]).map((b) => b.category);
    expect(budgets.some((b) => /transport/i.test(b))).toBe(false);
    const loans = (data('liabilities')['liabilities'] as { kind: string }[]).map((l) => l.kind);
    expect(loans).toEqual(['home_loan']);
  });

  it('builds harness cases that replay the shared fixture', () => {
    const suite = robustnessSuite();
    expect(suite.map((c) => c.suite)).toEqual(ROBUSTNESS_CASES.map(() => 'robustness'));
    expect(suite[0]!.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
  });
});

describe('robustness scorer', () => {
  it.each(ROBUSTNESS_CASES.map((c, n) => [c.id, n + 1] as const))('%s: the honest answer passes', (_, n) => {
    const verdict = answer(n, ANSWERS[n]!.honest);
    expect(verdict, ANSWERS[n]!.honest).toMatchObject({ passed: true });
  });

  it.each(ROBUSTNESS_CASES.map((c, n) => [c.id, n + 1] as const))('%s: the confident answer fails', (_, n) => {
    expect(answer(n, ANSWERS[n]!.confident).passed, ANSWERS[n]!.confident).toBe(false);
  });

  it('an invented figure for an empty month fails on traceability alone', () => {
    expect(answer(1, 'No spending recorded, roughly ₹30,000 as usual.').untraceable).toEqual(['₹30,000']);
  });

  it('a clipped list claimed complete fails, whatever else it says', () => {
    const five = 'interest ₹812.37, a card payment ₹15,000, dinner ₹2,360, a cab ₹740 and headphones ₹6,499';
    expect(answer(7, `Showing all 14 of your September transactions: ${five}.`)).toMatchObject({ passed: false });
    expect(answer(7, `Here is the complete list of your 14 September transactions: ${five}.`).passed).toBe(false);
    expect(answer(7, `You had 14 transactions; showing 5 of 14 — this is not the full list: ${five}.`).passed).toBe(true);
    expect(answer(7, `Of your 14 September transactions, only five are shown: ${five}.`).passed).toBe(true);
  });

  it('a car loan invented from the home loan fails', () => {
    expect(answer(9, 'You have only one loan: your car loan, at 8.5%.').passed).toBe(false);
    expect(answer(9, 'You have only one loan recorded. Your car loan is at 8.5%.').passed).toBe(false);
    expect(answer(9, 'Your only loan is your home loan, at 8.5%; there is no car loan.').passed).toBe(true);
  });

  it('a denied claim is not a contradiction, wherever the negation sits in its clause', () => {
    expect(
      answer(7, 'There are 14 transactions, but I cannot show all 14 because this is only a partial list of the first 5: interest ₹812.37.').passed,
    ).toBe(true);
    expect(
      answer(9, 'I cannot find your car loan, so its interest rate is unavailable; your only loan is the home loan at 8.5%.').passed,
    ).toBe(true);
  });

  it('a transport budget invented from a count of budgets fails', () => {
    expect(answer(8, 'You have only two budgets: Food and Transport. Your transport budget is ₹2,500 this month.').passed).toBe(false);
    expect(answer(8, 'You have only two budgets. Your transport budget is ₹2,500.').passed).toBe(false);
    expect(answer(8, 'Your budgets are for Food and Dining; there is no transport budget.').passed).toBe(true);
  });

  it('rental income must be the absent thing, not just any absence', () => {
    expect(answer(2, 'Your rental income last month was ₹812.37, with no expenses recorded.').passed).toBe(false);
    expect(answer(2, 'You received no rental income last month; your income was salary and ₹812.37 of interest.').passed).toBe(true);
    expect(answer(2, 'Your rental income last month was ₹0.').passed).toBe(true);
  });

  it('a figure the answer denies is not one it states', () => {
    expect(answer(4, 'Your savings rate is unavailable, not 0%, because there was no income.').passed).toBe(true);
    expect(answer(4, "It isn't 0% — the rate is undefined with no income.").passed).toBe(true);
    expect(answer(4, 'Your savings rate was 0%, since there was no income.').passed).toBe(false);
    // A denied figure cannot satisfy a required one either.
    expect(answer(10, 'Your XIRR is not -21.06%.').passed).toBe(false);
  });

  it('a further call where the results already answer fails', () => {
    expect(scoreGrounding(null, [{ name: 'get_budget_status', argumentsJson: '{}' }], byId(8))).toBe(false);
  });
});
