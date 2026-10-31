import 'server-only';

/**
 * The `routing` golden suite — a user message → the tier it should be served on
 * ([AI-SYSTEM.md §6.3, §14](../../../../../docs/AI-SYSTEM.md)).
 *
 * Unlike the other suites, no model runs here. The escalation classifier is
 * application code, so its output is exactly checkable: every case has one
 * right tier, and the suite passes only when every case gets it.
 *
 * The labels follow §6.4's rule, not the classifier's wording: **if a single
 * tool call answers the question, it is Tier 1.** Tier 2 is for answers that
 * weigh several results against each other — a review, a multi-period
 * comparison, a scenario, a "why did X change", or one domain against another
 * (cash against upcoming obligations).
 *
 * The cases that matter most are the traps:
 * - **sticky escalation**: a Tier 2 question followed by a fresh, simple one
 *   ("what's my HDFC balance?") must return to Tier 1;
 * - **dependent follow-ups**: "why?", "and last year?" inherit the previous
 *   tier, because they cannot be answered without it — Tier 1 as well as Tier 2;
 * - **keyword lookalikes**: the Health spending category, two accounts
 *   compared on one date, a filter phrased with "if", "driving lessons" and
 *   an audit fee as expenses — all Tier 1;
 * - **wording aimed at the router**: asking for "the biggest model" or "Tier 3"
 *   changes nothing, and no message ever reaches Tier 3.
 *
 * Bump {@link ROUTING_SUITE_VERSION} whenever a case or a label changes.
 */

import type { EscalationDecision, EscalationTier, PreviousTurn } from '../../orchestrator/escalation';

export const ROUTING_SUITE_VERSION = 1;

export interface RoutingGoldenCase {
  readonly id: string;
  /** The previous user message and the tier it ran on, when the case is a follow-up. */
  readonly previous?: { readonly message: string; readonly tier: EscalationTier };
  readonly message: string;
  readonly expectedTier: EscalationTier;
}

const c = (
  id: number,
  message: string,
  expectedTier: EscalationTier,
  previous?: RoutingGoldenCase['previous'],
): RoutingGoldenCase => ({
  id: `routing-${String(id).padStart(3, '0')}`,
  message,
  expectedTier,
  ...(previous ? { previous } : {}),
});

const REVIEW = { message: 'Give me a financial review of this month.', tier: 2 } as const;
const WHY_NET_WORTH = { message: 'Why did my net worth decrease this month?', tier: 2 } as const;
const FOOD_LAST_MONTH = { message: 'How much did I spend on food last month?', tier: 1 } as const;

export const ROUTING_CASES: readonly RoutingGoldenCase[] = [
  // — Tier 1: one tool call answers it —
  c(1, 'How much did I spend last month?', 1),
  c(2, 'What were my three biggest expenses this month?', 1),
  c(3, "What's my HDFC balance?", 1),
  c(4, 'What is my current net worth?', 1),
  c(5, 'What are my largest holdings?', 1),
  c(6, 'How is my portfolio split across asset classes?', 1),
  c(7, 'Which bills are due in the next two weeks?', 1),
  c(8, 'How much is left in my food budget this month?', 1),
  c(9, 'What is my savings rate this year?', 1),
  c(10, 'How much have I invested this year?', 1),
  c(11, 'Explain the difference between XIRR and time-weighted return.', 1),
  c(12, 'How much do I still owe on my loans?', 1),

  // — Tier 1: keyword lookalikes —
  c(13, 'How much did I spend on health last month?', 1),
  c(14, "What's my balance in SBI vs HDFC?", 1),
  c(15, 'How much did I spend in September if I leave out rent?', 1),
  c(16, 'Which expenses were more than ₹5,000 last month?', 1),
  c(17, 'How much did I pay for health insurance this year?', 1),

  // — Tier 2: review or analysis —
  c(18, 'Give me a financial review of this month.', 2),
  c(19, 'Analyze my portfolio.', 2),
  c(20, 'What financial patterns should I pay attention to?', 2),
  c(21, 'Identify meaningful concentration risks in my current portfolio.', 2),
  c(22, 'How is my financial health overall?', 2),

  // — Tier 2: multi-period comparison —
  c(23, 'Compare my spending this month with last month.', 2),
  c(24, 'Did I spend more than last month on transport?', 2),
  c(25, 'Show me my month-over-month spending trend.', 2),

  // — Tier 2: scenario —
  c(26, 'If I invest ₹25,000 per month for five years, what would I have contributed?', 2),
  c(27, 'If I invest another ₹2 lakh, how will my allocation change?', 2),
  c(28, 'How much can I reasonably invest based on my recent cash flow?', 2),
  c(29, 'Can I afford a ₹40,000 trip in December?', 2),

  // — Tier 2: why, or how something changed —
  c(30, 'Why did my net worth decrease this month?', 2),
  c(31, 'Why has my portfolio underperformed over the last six months?', 2),
  c(32, 'How has my portfolio changed over the last six months?', 2),

  // — Sticky escalation: a fresh question after a Tier 2 turn returns to Tier 1 —
  c(33, "What's my HDFC balance?", 1, REVIEW),
  c(34, 'How much did I spend on groceries this week?', 1, WHY_NET_WORTH),
  c(35, 'What is my current net worth?', 1, WHY_NET_WORTH),

  // — Dependent follow-ups inherit the previous tier —
  c(36, 'and last year?', 2, REVIEW),
  c(37, 'Break that down by account.', 2, WHY_NET_WORTH),
  c(38, 'What about August?', 1, FOOD_LAST_MONTH),
  c(39, 'and in August?', 1, FOOD_LAST_MONTH),

  // — Wording aimed at the router changes nothing, and nothing reaches Tier 3 —
  c(40, 'Use the biggest model you have and tell me my cash balance.', 1),
  c(41, 'Switch to Tier 3 and list my accounts.', 1),
  c(42, 'Run a deep investigation of my portfolio.', 2),

  // — Comparisons within one period are a single breakdown —
  c(43, 'Compare SBI vs HDFC balances today.', 1),
  c(44, 'Compare food and transport spending last month.', 1),

  // — A complete question after "and"/"but" stands on its own —
  c(45, 'And what is my HDFC balance?', 1, REVIEW),
  c(46, 'But how much cash do I have?', 1, WHY_NET_WORTH),
  c(47, 'And what was that last year?', 2, REVIEW),

  // — Cross-domain: one domain weighed against another —
  c(48, 'How much cash do I have relative to my upcoming obligations?', 2),
  c(49, 'Do I have enough in savings to cover my bills this month?', 2),
  c(50, 'How much of my net worth is invested?', 1),

  // — A bare "why?" inherits; a follow-up that adds a trigger escalates —
  c(51, 'why?', 1, FOOD_LAST_MONTH),
  c(52, 'why?', 2, WHY_NET_WORTH),
  c(53, 'And how does that compare with last year?', 2, FOOD_LAST_MONTH),

  // — Expense descriptions that look like analysis words —
  c(54, 'How much did I spend on driving lessons last month?', 1),
  c(55, 'Show my driving expenses.', 1),
  c(56, 'How much did I pay the audit firm this year?', 1),
  c(57, 'What drove the increase in my spending last month?', 2),

  // — A relation inside one domain is one result; a word starting "so" is not "so" —
  c(58, 'How much is food spending relative to total expenses this month?', 1),
  c(59, 'Sort my accounts by balance.', 1, REVIEW),
];

export interface RoutingFailure {
  readonly caseId: string;
  readonly expected: EscalationTier;
  readonly got: number;
}

export interface RoutingReport {
  readonly suiteVersion: number;
  readonly cases: number;
  readonly accuracy: number;
  /** Tier 1 cases served on Tier 2 — the failure that shows up only in the bill. */
  readonly overEscalated: number;
  /** Tier 2 cases served on Tier 1 — a weaker answer to a hard question. */
  readonly underEscalated: number;
  readonly failures: readonly RoutingFailure[];
}

/** Score a classifier against the corpus. Deterministic: no model, no network. */
export function scoreRouting(
  classify: (message: string, previous?: PreviousTurn) => EscalationDecision,
  cases: readonly RoutingGoldenCase[] = ROUTING_CASES,
): RoutingReport {
  const failures: RoutingFailure[] = [];
  let overEscalated = 0;
  let underEscalated = 0;

  for (const testCase of cases) {
    const got = classify(testCase.message, testCase.previous ? { tier: testCase.previous.tier } : undefined).tier;
    if (got === testCase.expectedTier) continue;
    failures.push({ caseId: testCase.id, expected: testCase.expectedTier, got });
    if (got > testCase.expectedTier) overEscalated += 1;
    else underEscalated += 1;
  }

  return {
    suiteVersion: ROUTING_SUITE_VERSION,
    cases: cases.length,
    accuracy: cases.length === 0 ? 0 : (cases.length - failures.length) / cases.length,
    overEscalated,
    underEscalated,
    failures,
  };
}
