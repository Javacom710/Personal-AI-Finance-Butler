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
  10: { honest: 'Your dining budget has -₹650 left.', confident: 'Your dining budget has ₹650 left.' },
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
    expect(answer(10, 'Your dining budget is not -₹650.').passed).toBe(false);
  });

  it('a negation after the claim denies it too', () => {
    expect(answer(9, 'Your car loan is not recorded. Your only loan is the home loan at 8.5%.').passed).toBe(true);
    expect(answer(8, "Your transport budget isn't set. Your budgets are for Food and Dining.").passed).toBe(true);
    // Affirmed in its own clause, still a contradiction.
    expect(answer(9, 'Your car loan is at 8.5%. It is not the only loan you could take.').passed).toBe(false);
  });

  it('a negation denies only its own claim, not one joined to it', () => {
    expect(answer(2, 'No rental income is recorded but your rent was ₹812.37.').passed).toBe(false);
    expect(answer(9, "There's no car loan and your car loan is at 8.5%.").passed).toBe(false);
  });

  it('"all 14" as the denominator of a subset is not a completeness claim', () => {
    const five = 'interest ₹812.37, a card payment ₹15,000, dinner ₹2,360, a cab ₹740 and headphones ₹6,499';
    expect(answer(7, `There are 14 September transactions. I can show only 5 of all 14 transactions: ${five}.`).passed).toBe(true);
    expect(answer(7, `Here are all 14 of your September transactions: ${five}.`).passed).toBe(false);
  });

  it('a label and its value are one claim', () => {
    expect(answer(2, 'No rental income is recorded. Rental income: ₹812.37.').passed).toBe(false);
  });

  it('a current price named as missing is not a claim to have one', () => {
    expect(answer(6, 'NIFTYBEES is worth ₹56,900 at its stale last price. A current price is needed to confirm its value today.').passed).toBe(true);
    expect(answer(6, 'NIFTYBEES is worth ₹56,900, valued at the current market price. The price is stale.').passed).toBe(false);
    expect(answer(6, 'NIFTYBEES is worth ₹56,900. Its price is current, though older data called it stale.').passed).toBe(false);
  });

  it('an amount given to an absent thing fails, in any notation or format', () => {
    for (const amount of ['₹812.37', 'INR 812.37', 'Rs. 812.37', 'Rs 812.37']) {
      expect(answer(2, `No rental income is recorded. Rental income: ${amount}.`).passed, amount).toBe(false);
    }
    expect(answer(8, 'Your budgets are for Food and Dining. Transport budget: ₹2,500.').passed).toBe(false);
    expect(answer(9, 'Your only loan is the home loan. Car loan: 8.5%.').passed).toBe(false);
    // A zero is not an amount given.
    expect(answer(2, 'You received no rental income. Rental income: ₹0.').passed).toBe(true);
  });

  it('an amount belongs to the subject nearest before it', () => {
    expect(answer(2, 'Your rental income was ₹0 versus salary of ₹1,20,000.').passed).toBe(true);
  });

  it('an unpriced holding valued at its cost fails; its cost reported as cost passes', () => {
    expect(answer(5, 'Your HDFC Bank holding is worth ₹40,000 today. Its current price is unavailable.').passed).toBe(false);
    expect(answer(5, 'Its market value is ₹40,000, though the price is missing.').passed).toBe(false);
    expect(answer(5, 'HDFC Bank has no current price, so its value is unavailable. You invested ₹40,000 in it.').passed).toBe(true);
  });

  it("another holding's value is not the unpriced holding's", () => {
    expect(
      answer(5, 'HDFC Bank has no current price. Its acquisition value was ₹40,000. NIFTYBEES has a stale market value of ₹56,900.').passed,
    ).toBe(true);
  });

  it('an absence predicate denies the claim', () => {
    expect(answer(9, 'Your car loan is absent. Your only loan is the home loan at 8.5%.').passed).toBe(true);
    expect(answer(8, 'Your transport budget is missing. Your budgets are for Food and Dining.').passed).toBe(true);
    expect(answer(9, 'Your car loan is at 8.5%.').passed).toBe(false);
  });

  it('a negation inside the claim denies it', () => {
    expect(answer(2, 'No rental income is recorded. Your rental income is not ₹812.37.').passed).toBe(true);
    expect(answer(2, 'No rental income is recorded. Your rental income is ₹812.37.').passed).toBe(false);
  });

  it('a negation elsewhere in the clause does not deny the claim', () => {
    expect(answer(6, 'NIFTYBEES is worth ₹56,900 at a current price with no stale data.').passed).toBe(false);
  });

  it('a line is a claim of its own', () => {
    expect(answer(2, 'No rental income recorded\nRental income: ₹812.37').passed).toBe(false);
    expect(answer(2, '- No rental income recorded\n- Rental income: ₹812.37').passed).toBe(false);
  });

  it('an acquisition value is not a market value', () => {
    expect(answer(5, 'HDFC Bank has no current price. Its acquisition value was ₹40,000.').passed).toBe(true);
    expect(answer(5, 'HDFC Bank has no current price. Its value is ₹40,000.').passed).toBe(false);
  });

  it('a decimal point or a thousands comma does not split a claim', () => {
    expect(answer(8, 'There is no transport budget, transport budget ₹2,500.').passed).toBe(false);
  });

  it('a word ending in -nt is not a negation', () => {
    expect(answer(2, 'No rental income is recorded. Your rent was ₹812.37.').passed).toBe(false);
    expect(answer(2, 'No rental income is recorded. Your rental income was ₹812.37.').passed).toBe(false);
  });

  it('a stale price presented as current fails, even beside the word "stale"', () => {
    expect(answer(6, 'NIFTYBEES is worth ₹56,900 today at a current price, not a stale price.').passed).toBe(false);
    expect(answer(6, 'NIFTYBEES is worth ₹56,900 at its last price, which is stale and not current.').passed).toBe(true);
  });

  it('a further call where the results already answer fails', () => {
    expect(scoreGrounding(null, [{ name: 'get_budget_status', argumentsJson: '{}' }], byId(8))).toBe(false);
  });
});
