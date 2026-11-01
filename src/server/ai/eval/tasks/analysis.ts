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
    contradictions: [CURRENT_PRICE],
  }),
  analysisCase(2, 'portfolio', 'Explain the portfolio return using the reported realised and unrealised results.', {
    calls: ['portfolio'],
    required: [money('4992'), money('-30912'), money('-24220')],
    mentions: [/(?:unrealised|unrealized) loss/i, /realised|realized gain/i],
  }),
  analysisCase(3, 'portfolio', 'Review my allocation by asset class and say what it leaves out.', {
    calls: ['allocationByClass', 'holdings'],
    required: [money('91200'), money('56900'), [rate('0.6158001350')], [rate('0.3841998650')]],
    mentions: [/equit(?:y|ies)/i, /ETF/i, /HDFC ?BANK.{0,60}(?:no price|unpriced|missing price)/i],
  }),
  analysisCase(4, 'portfolio', 'What can you conclude about my HDFC Bank and NIFTYBEES positions?', {
    calls: ['holdings'],
    required: [money('40000'), money('56900')],
    mentions: [/HDFC ?BANK.{0,70}(?:invested|cost).{0,30}(?:no price|unpriced|missing price)|HDFC ?BANK.{0,70}(?:no price|unpriced|missing price)/i, /NIFTYBEES.{0,50}stale/i],
    contradictions: [amountFor(String.raw`(?:HDFC ?BANK).{0,35}(?:worth|market value|current value)`)],
  }),
  analysisCase(5, 'portfolio', 'Summarise my investment returns and explain whether time-weighted return is available.', {
    calls: ['portfolio'],
    required: [money('-24220'), [rate('-0.2105550000')]],
    forbidden: [rate('0')],
    mentions: [/time[- ]weighted return/i, /unavailable|not available|insufficient price history/i],
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
    contradictions: [amountFor('runway')],
  }),

  // Period analysis
  analysisCase(10, 'period', 'Compare October with September and highlight the direction of change.', {
    calls: ['compareOct'],
    required: [money('30040'), money('45319.50'), money('89960'), money('75492.87'), money('-15279.50'), money('14467.13')],
    mentions: [/(?:expenses?|spending).{0,40}(?:fell|decreased|lower|down)/i, /savings.{0,40}(?:rose|increased|higher|up)/i],
  }),
  analysisCase(11, 'period', 'Which spending category was largest last month, and how did this month compare?', {
    calls: ['expenseSepRollup', 'compareOct'],
    required: [money('25000'), money('45319.50'), money('30040')],
    mentions: [/housing/i, /(?:October|this month).{0,50}(?:lower|less|decreased|down)/i],
  }),
  analysisCase(12, 'period', 'Summarise my recorded net-worth trend from June through September.', {
    calls: ['netWorthHistory'],
    required: [money('7404700'), money('7409692'), money('7494242'), money('8017389.20')],
    forbidden: money('30326023.20'),
    mentions: [/cost/i, /(?:rose|increased|grew|higher|upward)/i],
  }),

  // Cross-domain analysis
  analysisCase(13, 'cross-domain', 'Give a snapshot that connects my net worth and portfolio, including valuation limits.', {
    calls: ['netWorthCost', 'portfolio', 'holdings'],
    required: [money('8107349.20'), money('148100'), money('-24220')],
    mentions: [/cost/i, /partial|incomplete|coverage/i, /HDFC ?BANK/i, /stale/i],
    contradictions: [CURRENT_PRICE],
  }),
  analysisCase(14, 'cross-domain', 'Connect my savings, current budget pressure and debt obligations.', {
    calls: ['cashflowSep', 'budgetsOct', 'liabilities'],
    required: [money('75492.87'), [{ money: '-650', eitherSign: true }], money('2412345.67'), money('24500')],
    mentions: [/savings/i, /dining/i, /home loan/i],
  }),
  analysisCase(15, 'cross-domain', 'Before I consider adding an investment, analyse my cash, obligations, savings and existing portfolio.', {
    calls: ['accounts', 'liabilities', 'cashflowSep', 'portfolio', 'holdings'],
    required: [money('412022.37'), money('24500'), money('75492.87'), money('148100')],
    mentions: [/HDFC ?BANK.{0,60}(?:no price|unpriced|missing price)/i, /NIFTYBEES.{0,60}(?:stale|old price|out of date)/i, /(?:risk tolerance|time horizon|goals|emergency fund)/i],
    contradictions: [CURRENT_PRICE, /\b(?:you should|I recommend|I would recommend)\s+(?:to\s+)?(?:invest|buy)\b/i],
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
