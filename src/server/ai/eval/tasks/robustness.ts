import 'server-only';

/**
 * The `robustness` golden suite — when the data is empty, missing, partial or
 * absent, does the answer say so rather than invent?
 * ([AI-SYSTEM.md §14](../../../../../docs/AI-SYSTEM.md))
 *
 * It replays the same fixture as `grounding` (`grounding-calls.ts`,
 * `grounding-results.json`), so every result is the production handler's
 * output, proved by `tests/integration/ai-eval-grounding.test.ts`. It differs in
 * what it asks: a month with no records, a rate with no denominator, a list the
 * row cap clipped, a date before the user's records begin, a holding with no
 * price, and a budget, a loan or an income source the user does not have.
 *
 * The scorer is `grounding`'s, so every stated figure must still trace to a
 * result. What this suite adds is required wording: the answer must say the
 * value is unavailable, the list incomplete, the thing absent. A confident
 * answer built from what is there — "your savings rate was 0%", "your
 * September transactions were these five" — fails.
 *
 * Wording is matched by patterns that accept the usual phrasings. They decide
 * whether the answer says the thing at all, not how well; the `analysis`
 * suite's rubric is where prose quality belongs.
 *
 * Bump {@link ROBUSTNESS_SUITE_VERSION} whenever a case, an expectation or the
 * fixture's results change.
 */

import type { EvalCase } from '../harness';
import { money, rate, replayCase, replaySuite, type GroundingGoldenCase } from './grounding';

export const ROBUSTNESS_SUITE_VERSION = 1;

const r = replayCase('robustness');

/** Says a value cannot be given. */
const NO_VALUE =
  /unavailable|not available|isn'?t available|cannot|can'?t|unable|undefined|not (?:be )?(?:calculated|computed|defined|possible)|no income|n\/a/i;

/** Says nothing was recorded. */
const NOTHING_RECORDED =
  /\bno (?:spending|expenses?|transactions?|records?|data|entries|income|activity)\b|\bnothing\b|\bnone\b|didn'?t (?:spend|record|receive|get)|did not (?:spend|record|receive|get)|not (?:yet )?recorded|₹\s?0(?:\.0+)?\b|\bzero\b/i;

export const ROBUSTNESS_CASES: readonly GroundingGoldenCase[] = [
  // — Nothing recorded: zero is an answer, not a gap to fill —
  r(1, 'How much did I spend in June 2025?', {
    calls: ['expenseJun2025'],
    mentions: [NOTHING_RECORDED],
  }),
  r(2, 'How much rental income did I get last month?', {
    calls: ['incomeSep'],
    mentions: [NOTHING_RECORDED],
  }),
  // Accounts open on 2026-01-01: a ₹0 net worth in 2020 is "no records", not wealth.
  r(3, 'What was my net worth on 1 January 2020?', {
    calls: ['netWorth2020'],
    mentions: [/no (?:records?|data|accounts?|assets?|entries)|nothing (?:was )?recorded|not (?:yet )?(?:recorded|tracked)|before (?:you|your|any)|(?:records?|tracking|data) (?:start|begin)/i],
  }),

  // — Unavailable is not zero —
  r(4, 'What was my savings rate in January?', {
    calls: ['cashflowJan'],
    forbidden: [rate('0')],
    mentions: [NO_VALUE],
  }),
  r(5, 'What is my HDFC Bank holding worth today?', {
    calls: ['holdings'],
    mentions: [/no (?:current |live |market )?price|not priced|unpriced|missing|unavailable|not available|cannot|can'?t/i],
  }),
  r(6, 'What is my NIFTYBEES holding worth today?', {
    calls: ['holdings'],
    required: [money('56900')],
    mentions: [/stale|out of date|outdated|older price|not (?:a )?(?:current|live)|old price/i],
  }),

  // — A clipped list is not the whole list —
  r(7, 'What were all my transactions in September?', {
    calls: ['transactionsSepClipped'],
    // meta.totalMatching is 14; five are shown. The answer must set the five
    // apart from the fourteen, and must not present them as all of them.
    mentions: [
      /\b14\b|fourteen/i,
      /\b(?:only|first|latest|last|most recent) (?:5|five)\b|\b(?:5|five) (?:of|out of) (?:the |your |all )?(?:14|fourteen)\b|truncated|partial|not all|(?:9|nine) (?:more|others|remaining)|the (?:rest|remaining)|(?:isn'?t|not) (?:the )?(?:complete|full|whole)/i,
    ],
    contradictions: [
      /\b(?:all|every one of)(?: of)?(?: your| the)? (?:14|fourteen)\b/i,
      /\b(?:the |your |a )(?:complete|full|entire|whole) list\b/i,
    ],
  }),

  // — Absent things are absent —
  r(8, "What's my transport budget this month?", {
    calls: ['budgetsOct'],
    // An absence, or the budgets that do exist (Food and Dining). A bare count —
    // "only two budgets" — says neither.
    mentions: [/no (?:transport )?budget|(?:don'?t|do not) have (?:a|any) (?:transport )?budget|(?:haven'?t|have not) set (?:a|any|up a) (?:transport )?budget|(?:isn'?t|is no) (?:a )?(?:transport )?budget|transport (?:isn'?t|is not) budgeted|budgets? (?:are |is )?(?:only )?(?:for |on )?food and dining|only (?:have )?budgets? (?:for|on) food and dining/i],
    contradictions: [/\byour transport budget(?:,| is| of| at| has)/i],
  }),
  r(9, 'What is the interest rate on my car loan?', {
    calls: ['liabilities'],
    // Naming the loan that does exist, or saying the car loan does not. A bare
    // "only one loan" says neither, and is what a model inventing one would write.
    mentions: [/no (?:car|auto|vehicle) loan|(?:don'?t|do not) have (?:a|any) (?:car|auto|vehicle) loan|not (?:find|see) (?:a|any) (?:car|auto|vehicle) loan|(?:car|auto|vehicle) loan (?:is not|isn'?t) (?:recorded|tracked|listed)|only (?:loan|liability) (?:is|recorded is) (?:a |your |the )?home loan|only (?:a |your |the )?home loan/i],
    contradictions: [/\byour (?:car|auto|vehicle) loan(?:,| is| at| has| carries)/i],
  }),

  // — A negative figure keeps its sign —
  r(10, 'What is my XIRR?', {
    calls: ['portfolio'],
    required: [[rate('-0.2105550000')]],
  }),
];

export function robustnessSuite(): readonly EvalCase[] {
  return replaySuite('robustness', ROBUSTNESS_CASES);
}
