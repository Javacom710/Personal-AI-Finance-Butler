import 'server-only';

/**
 * The `analysis` golden suite — 15 portfolio, financial-health, period and
 * cross-domain reviews over the frozen production-handler results used by the
 * `grounding` suite. No database or model is needed to construct it.
 *
 * Scoring is deterministic and deliberately narrow: every stated figure must
 * trace to a supplied result, required figures and case-specific findings must
 * be present, and known unsupported claims must be absent. General prose
 * quality is not scored, and no LLM-as-judge is used.
 */

import type { EvalCase } from '../harness';
import { toolDefinitions } from '../../tools/registry';
import {
  amountFor,
  CURRENT_PRICE,
  groundingMessages,
  money,
  rate,
  replayCase,
  scoreGroundingAnswer,
  type Figure,
  type GroundingGoldenCase,
} from './grounding';

export const ANALYSIS_SUITE_VERSION = 1;

export type AnalysisDomain = 'portfolio' | 'health' | 'period' | 'cross-domain';

export interface AnalysisGoldenCase extends GroundingGoldenCase {
  readonly domain: AnalysisDomain;
}

const makeCase = replayCase('analysis');

/*
 * Metrics the frozen results cannot supply. An answer may say they are
 * unavailable; a figure given to one is fabricated, whatever disclaimer sits
 * beside it, and the figure may well trace to another result (XIRR's -21.06%
 * given as the TWR), so traceability alone does not catch it.
 */
/** Time-weighted return: the portfolio result has insufficient price history for it. */
const TWR_FIGURE = amountFor(String.raw`time[- ]weighted (?:rate of )?return|TWR`);
/** Dining is over budget (remaining -₹650): saying it is under, or that nothing is over, reverses the finding. */
const DINING_REVERSED = [
  /\bdining\b(?:(?!\bover\b)[^;!?]){0,80}\b(?:under|within|below|inside)\s+(?:its\s+|the\s+)?budget/i,
  /\b(?:nothing|no (?:category|budget))\b[^;!?.]{0,30}\bover(?: budget| its budget|spent)?\b/i,
  /\ball\b[^;!?.]{0,30}\b(?:within|under)\s+(?:their\s+)?budgets?\b/i,
];

/** HDFC Bank has no price, so it has no market value. */
const HDFC_VALUE = amountFor(String.raw`(?:HDFC ?BANK).{0,35}(?:worth|market value|current value)`);

const COUNT = String.raw`(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen|twenty|twenty-four|thirty-six)`;
const SPAN = String.raw`(?:days?|weeks?|months?|mos?|years?|yrs?)`;

/**
 * Gives a duration to a subject the results cannot supply: "your runway is 12
 * months", "about six months of runway". {@link amountFor} reads only money and
 * percentages, and the figure parser ignores small bare numbers, so a duration
 * needs its own check.
 */
export function durationFor(subject: string): RegExp {
  const gap = String.raw`(?:(?!\d)[^;!?]){0,40}`;
  return new RegExp(
    String.raw`\b(?:${subject})\b${gap}\b${COUNT}\s?${SPAN}\b|\b${COUNT}\s?${SPAN}\b(?:(?!\d)[^;!?]){0,20}\b(?:${subject})\b`,
    'i',
  );
}

function analysisCase(
  n: number,
  domain: AnalysisDomain,
  question: string,
  spec: {
    readonly calls: GroundingGoldenCase['calls'];
    readonly required?: readonly (readonly Figure[])[];
    readonly forbidden?: readonly Figure[];
    readonly mentions?: readonly RegExp[];
    readonly contradictions?: readonly RegExp[];
  },
): AnalysisGoldenCase {
  return { ...makeCase(n, question, spec), domain };
}

export const ANALYSIS_CASES: readonly AnalysisGoldenCase[] = [
  // Portfolio reviews
  analysisCase(1, 'portfolio', 'Review my portfolio position and its main data limitations.', {
    calls: ['portfolio', 'holdings'],
    required: [money('148100'), money('-24220'), [rate('-0.1169935272')]],
    mentions: [/HDFC ?BANK.{0,60}(?:no price|unpriced|missing price)/i, /NIFTYBEES.{0,60}(?:stale|old price|out of date)/i, /partial|incomplete|coverage/i],
    contradictions: [CURRENT_PRICE, HDFC_VALUE, TWR_FIGURE],
  }),
  analysisCase(2, 'portfolio', 'Explain the portfolio return using the reported realised and unrealised results.', {
    calls: ['portfolio'],
    required: [money('4992'), money('-30912'), money('-24220')],
    mentions: [/(?:unrealised|unrealized) loss/i, /realised|realized gain/i],
    contradictions: [TWR_FIGURE, /\bunreali[sz]ed gain/i, /(?<!un)\breali[sz]ed loss/i],
  }),
  analysisCase(3, 'portfolio', 'Review my allocation by asset class and say what it leaves out.', {
    calls: ['allocationByClass', 'holdings'],
    required: [money('91200'), money('56900'), [rate('0.6158001350')], [rate('0.3841998650')]],
    mentions: [/equit(?:y|ies)/i, /ETF/i, /HDFC ?BANK.{0,60}(?:no price|unpriced|missing price)/i],
    contradictions: [CURRENT_PRICE, HDFC_VALUE],
  }),
  analysisCase(4, 'portfolio', 'What can you conclude about my HDFC Bank and NIFTYBEES positions?', {
    calls: ['holdings'],
    required: [money('40000'), money('56900')],
    mentions: [/HDFC ?BANK.{0,70}(?:invested|cost).{0,30}(?:no price|unpriced|missing price)|HDFC ?BANK.{0,70}(?:no price|unpriced|missing price)/i, /NIFTYBEES.{0,50}stale/i],
    contradictions: [CURRENT_PRICE, HDFC_VALUE],
  }),
  analysisCase(5, 'portfolio', 'Summarise my investment returns and explain whether time-weighted return is available.', {
    calls: ['portfolio'],
    required: [money('-24220'), [rate('-0.2105550000')]],
    forbidden: [rate('0')],
    mentions: [/time[- ]weighted return/i, /unavailable|not available|insufficient price history/i],
    contradictions: [TWR_FIGURE],
  }),

  // Financial health
  analysisCase(6, 'health', 'Give me a financial-health snapshot from last month’s cash flow.', {
    calls: ['cashflowSep'],
    required: [money('120812.37'), money('45319.50'), money('75492.87'), [rate('0.6248769890')]],
    mentions: [/income/i, /expenses?/i, /savings/i],
    forbidden: [rate('-0.6248769890')],
  }),
  analysisCase(7, 'health', 'Review this month’s category budgets. Where am I over or under?', {
    calls: ['budgetsOct'],
    required: [money('5040'), money('3150'), [{ money: '-650', eitherSign: true }]],
    mentions: [/food/i, /dining/i, /over budget|over by|exceed/i],
    contradictions: DINING_REVERSED,
  }),
  analysisCase(8, 'health', 'Review my recorded cash balances and loan obligations.', {
    calls: ['accounts', 'liabilities'],
    required: [money('412022.37'), [{ money: '-14969.50', eitherSign: true }], money('2412345.67'), money('24500')],
    mentions: [/HDFC Savings/i, /credit card/i, /home loan/i],
  }),
  analysisCase(9, 'health', 'How many months of financial runway do I have?', {
    calls: ['cashflowJan', 'accounts', 'liabilities'],
    required: [money('412022.37')],
    mentions: [/runway.{0,50}(?:not available|not provided|cannot be (?:calculated|determined)|cannot tell|not enough|requires|needs)/i],
    contradictions: [amountFor('runway'), durationFor('runway')],
  }),

  // Period analysis
  analysisCase(10, 'period', 'Compare October with September and highlight the direction of change.', {
    calls: ['compareOct'],
    required: [money('30040'), money('45319.50'), money('89960'), money('75492.87'), money('-15279.50'), money('14467.13')],
    mentions: [/(?:expenses?|spending).{0,40}(?:fell|decreased|lower|down)/i, /savings.{0,40}(?:rose|increased|higher|up)/i],
    contradictions: [
      /\b(?:expenses?|spending)\b(?:(?!\b(?:fell|decreased|lower|down)\b)[^;!?]){0,30}\b(?:rose|increased|grew|went up|higher)\b/i,
      /\bsavings\b(?:(?!\b(?:rose|increased|higher|up)\b)[^;!?]){0,30}\b(?:fell|decreased|declined|dropped|went down|lower)\b/i,
    ],
  }),
  analysisCase(11, 'period', 'Which spending category was largest last month, and how did this month compare?', {
    calls: ['expenseSepRollup', 'compareOct'],
    required: [money('25000'), money('45319.50'), money('30040')],
    mentions: [/housing/i, /(?:October|this month).{0,50}(?:lower|less|decreased|down)/i],
    contradictions: [/\b(?:October|this month)\b(?:(?!\b(?:lower|less|decreased|down)\b)[^;!?]){0,50}\b(?:higher|more than|increased|rose|up from)\b/i],
  }),
  analysisCase(12, 'period', 'Summarise my recorded net-worth trend from June through September.', {
    calls: ['netWorthHistory'],
    required: [money('7404700'), money('7409692'), money('7494242'), money('8017389.20')],
    forbidden: money('30326023.20'),
    mentions: [/cost/i, /(?:rose|increased|grew|higher|upward)/i],
    contradictions: [/\bnet[- ]worth\b(?:(?!\b(?:rose|increased|grew|higher|upward)\b)[^;!?]){0,40}\b(?:fell|decreased|declined|dropped|shrank|lower|downward)\b/i],
  }),

  // Cross-domain analysis
  analysisCase(13, 'cross-domain', 'Give a snapshot that connects my net worth and portfolio, including valuation limits.', {
    calls: ['netWorthCost', 'portfolio', 'holdings'],
    required: [money('8107349.20'), money('148100'), money('-24220')],
    mentions: [/cost/i, /partial|incomplete|coverage/i, /HDFC ?BANK/i, /stale/i],
    contradictions: [CURRENT_PRICE, HDFC_VALUE, TWR_FIGURE],
  }),
  analysisCase(14, 'cross-domain', 'Connect my savings, current budget pressure and debt obligations.', {
    calls: ['cashflowSep', 'budgetsOct', 'liabilities'],
    required: [money('75492.87'), [{ money: '-650', eitherSign: true }], money('2412345.67'), money('24500')],
    mentions: [/savings/i, /dining/i, /over budget|over by|exceed/i, /home loan/i],
    contradictions: DINING_REVERSED,
  }),
  analysisCase(15, 'cross-domain', 'Before I consider adding an investment, analyse my cash, obligations, savings and existing portfolio.', {
    calls: ['accounts', 'liabilities', 'cashflowSep', 'portfolio', 'holdings'],
    required: [money('412022.37'), money('24500'), money('75492.87'), money('148100')],
    mentions: [/HDFC ?BANK.{0,60}(?:no price|unpriced|missing price)/i, /NIFTYBEES.{0,60}(?:stale|old price|out of date)/i, /(?:risk tolerance|time horizon|goals|emergency fund)/i],
    contradictions: [CURRENT_PRICE, HDFC_VALUE, TWR_FIGURE, /\b(?:you should|I recommend|I would recommend)\s+(?:to\s+)?(?:invest|buy)\b/i],
  }),
];

export function scoreAnalysisOutput(
  output: string | null,
  toolCalls: readonly { name: string; argumentsJson: string }[],
  golden: AnalysisGoldenCase,
): boolean {
  // The full set of relevant results is already in the replay. Further reads
  // are unnecessary, and no model-written figure may be computed from them.
  return toolCalls.length === 0 && scoreGroundingAnswer(output, golden).passed;
}

export function analysisSuite(): readonly EvalCase[] {
  const tools = toolDefinitions();
  return ANALYSIS_CASES.map((golden) => ({
    id: golden.id,
    suite: 'analysis',
    messages: groundingMessages(golden),
    tools,
    score: (output, toolCalls) => scoreAnalysisOutput(output, toolCalls, golden),
    checkToolCalls: (toolCalls) => toolCalls.length === 0,
  }));
}
