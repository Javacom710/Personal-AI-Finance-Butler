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
import { normalizeNumericPresentation } from '../score';
import {
  amountFor,
  CURRENT_PRICE,
  groundingMessages,
  money,
  rate,
  replayCase,
  scoreGroundingAnswer,
  statedFigures,
  statesFigure,
  type Figure,
  type GroundingGoldenCase,
} from './grounding';

export const ANALYSIS_SUITE_VERSION = 4;

export type AnalysisDomain = 'portfolio' | 'health' | 'period' | 'cross-domain';

export interface AnalysisGoldenCase extends GroundingGoldenCase {
  readonly domain: AnalysisDomain;
  /** Figures that must be stated as the metric they belong to, not merely somewhere. */
  readonly bound: readonly Binding[];
}

/** A required figure tied to its metric: "income ₹1,20,812.37", not income given the expenses figure. */
export interface Binding {
  readonly subject: RegExp;
  /** Any one of these, as in `required`. */
  readonly figures: readonly Figure[];
}

/** What may sit between a figure and the metric it is written onto. */
const ATTACHED = /^\s*(?:(?:in|of|on|for|as)\s+)?(?:total\s+|net\s+)?$/i;

const bind = (subject: RegExp, figure: Figure | readonly Figure[]): Binding => ({
  subject,
  figures: Array.isArray(figure) ? figure : [figure as Figure],
});

/**
 * The figure an answer gives a metric at one mention: a figure written onto it
 * ("a ₹24,500 EMI", "₹1,20,812.37 in income", "a 62.49% savings rate"), else
 * the first figure of the expected kind after it in its sentence ("income was
 * ₹1,20,812.37"). Requiring each binding at some mention
 * catches swapped figures ("income ₹45,319.50, expenses ₹1,20,812.37"), which
 * pass when figures and words are checked apart.
 */
export function bindingHolds(text: string, binding: Binding): boolean {
  text = normalizeNumericPresentation(text);
  const kind = binding.figures.some((f) => 'rate' in f) ? 'percent' : 'money';
  const subject = new RegExp(binding.subject.source, binding.subject.flags.replace('g', '') + 'g');
  for (const match of text.matchAll(subject)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const sentenceEnd = text.slice(end).search(/;|\n|(?<!\brs)\.(?!\d)/i);
    const after = text.slice(end, sentenceEnd === -1 ? undefined : end + sentenceEnd);
    const following = statedFigures(after).find((f) => f.kind === kind);
    const before = text.slice(Math.max(0, start - 30), start);
    const last = statedFigures(before).filter((f) => f.kind === kind).at(-1);
    const gap = last ? before.slice(before.lastIndexOf(last.text.replace(/^-/, '')) + last.text.replace(/^-/, '').length) : '';
    const attached = last !== undefined && ATTACHED.test(gap) ? last : undefined;
    const given = attached ?? following;
    if (given && binding.figures.some((f) => statesFigure(given, f))) return true;
  }
  return false;
}

const makeCase = replayCase('analysis');

/*
 * Metrics the frozen results cannot supply. An answer may say they are
 * unavailable; a figure given to one is fabricated, whatever disclaimer sits
 * beside it, and the figure may well trace to another result (XIRR's -21.06%
 * given as the TWR), so traceability alone does not catch it.
 */
/**
 * The words between a subject and a figure that end the figure's claim to it:
 * a bracket ("TWR is unavailable (XIRR is -21.06%)" gives the figure to XIRR)
 * or a denial ("market value is unavailable; ₹40,000 is cost").
 */
const NOT_ASSIGNED = String.raw`[()\[\]]|\b(?:unavailable|not|no|none|missing|insufficient|cannot|unknown|without|n['’]t)\b`;

/**
 * A figure assigned to a subject the results cannot supply: {@link amountFor},
 * but the figure must follow the subject with nothing between them that hands
 * it elsewhere or denies it ({@link NOT_ASSIGNED}).
 */
export function assignedTo(subject: string): RegExp {
  const nonZero = String.raw`(?!0(?:\.0+)?(?![\d.,]))`;
  const gap = String.raw`(?:(?!₹|\brs\b|\binr\b|\$|\d|${NOT_ASSIGNED})[^;!?]){0,40}`;
  return new RegExp(
    String.raw`\b(?:${subject})\b${gap}(?:(?:₹|\brs\.?|\binr\b|\$)\s?-?${nonZero}\d|${nonZero}-?\d[\d,.]*\s?%)`,
    'i',
  );
}

/** Time-weighted return: the portfolio result has insufficient price history for it. */
const TWR_FIGURE = assignedTo(String.raw`time[- ]weighted (?:rate of )?return|TWR`);
/** Dining is over budget (remaining -₹650): saying it is under, or that nothing is over, reverses the finding. */
const DINING_REVERSED = [
  /\bdining\b(?:(?!\bover\b)[^;!?]){0,80}\b(?:under|within|below|inside)\s+(?:its\s+|the\s+)?budget/i,
  /\b(?:nothing|no (?:category|budget))\b[^;!?.]{0,30}\bover(?: budget| its budget|spent)?\b/i,
  /\ball\b[^;!?.]{0,30}\b(?:within|under)\s+(?:their\s+)?budgets?\b/i,
];

/** HDFC Bank has no price, so it has no market value. */
const HDFC_VALUE = assignedTo(String.raw`(?:HDFC ?BANK)[^()\[\]]{0,35}(?:worth|market value|current value)`);

const COUNT = String.raw`(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen|twenty|twenty-four|thirty-six)`;
const SPAN = String.raw`(?:days?|weeks?|months?|mos?|years?|yrs?)`;

/**
 * Gives a duration to a subject the results cannot supply: "your runway is 12
 * months", "about six months of runway". {@link amountFor} reads only money and
 * percentages, and the figure parser ignores small bare numbers, so a duration
 * needs its own check.
 */
export function durationFor(subject: string): RegExp {
  const gap = String.raw`(?:(?!\d|${NOT_ASSIGNED})[^;!?]){0,40}`;
  return new RegExp(
    String.raw`\b(?:${subject})\b${gap}\b${COUNT}\s?${SPAN}\b|\b${COUNT}\s?${SPAN}\b(?:(?!\d|${NOT_ASSIGNED})[^;!?]){0,20}\b(?:${subject})\b`,
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
    readonly bound?: readonly Binding[];
  },
): AnalysisGoldenCase {
  return { ...makeCase(n, question, spec), domain, bound: spec.bound ?? [] };
}

export const ANALYSIS_CASES: readonly AnalysisGoldenCase[] = [
  // Portfolio reviews
  analysisCase(1, 'portfolio', 'Review my portfolio position and its main data limitations.', {
    calls: ['portfolio', 'holdings'],
    required: [money('148100'), money('-24220'), [rate('-0.1169935272')]],
    mentions: [/HDFC ?BANK.{0,60}(?:no price|unpriced|missing price)/i, /NIFTYBEES.{0,60}(?:stale|old price|out of date)/i, /partial|incomplete|coverage/i],
    contradictions: [CURRENT_PRICE, HDFC_VALUE, TWR_FIGURE],
    bound: [bind(/market value/i, money('148100')), bind(/total return/i, money('-24220'))],
  }),
  analysisCase(2, 'portfolio', 'Explain the portfolio return using the reported realised and unrealised results.', {
    calls: ['portfolio'],
    required: [money('4992'), money('-30912'), money('-24220')],
    mentions: [/(?:unrealised|unrealized) loss/i, /realised|realized gain/i],
    contradictions: [TWR_FIGURE, /\bunreali[sz]ed gain/i, /(?<!un)\breali[sz]ed loss/i],
    bound: [
      bind(/(?<!un)\breali[sz]ed\b/i, money('4992')),
      bind(/\bunreali[sz]ed\b/i, money('-30912')),
      bind(/total return/i, money('-24220')),
    ],
  }),
  analysisCase(3, 'portfolio', 'Review my allocation by asset class and say what it leaves out.', {
    calls: ['allocationByClass', 'holdings'],
    required: [money('91200'), money('56900'), [rate('0.6158001350')], [rate('0.3841998650')]],
    mentions: [/equit(?:y|ies)/i, /ETF/i, /HDFC ?BANK.{0,60}(?:no price|unpriced|missing price)/i],
    contradictions: [CURRENT_PRICE, HDFC_VALUE],
    bound: [
      bind(/equit(?:y|ies)/i, money('91200')),
      bind(/equit(?:y|ies)/i, rate('0.6158001350')),
      bind(/\bETFs?\b/i, money('56900')),
      bind(/\bETFs?\b/i, rate('0.3841998650')),
    ],
  }),
  analysisCase(4, 'portfolio', 'What can you conclude about my HDFC Bank and NIFTYBEES positions?', {
    calls: ['holdings'],
    required: [money('40000'), money('56900')],
    mentions: [/HDFC ?BANK.{0,70}(?:invested|cost).{0,30}(?:no price|unpriced|missing price)|HDFC ?BANK.{0,70}(?:no price|unpriced|missing price)/i, /NIFTYBEES.{0,50}stale/i],
    contradictions: [CURRENT_PRICE, HDFC_VALUE],
    bound: [bind(/HDFC ?BANK/i, money('40000')), bind(/NIFTYBEES/i, money('56900'))],
  }),
  analysisCase(5, 'portfolio', 'Summarise my investment returns and explain whether time-weighted return is available.', {
    calls: ['portfolio'],
    required: [money('-24220'), [rate('-0.2105550000')]],
    forbidden: [rate('0')],
    mentions: [/time[- ]weighted return/i, /unavailable|not available|insufficient price history/i],
    contradictions: [TWR_FIGURE],
    bound: [bind(/total return/i, money('-24220')), bind(/\bXIRR\b/i, rate('-0.2105550000'))],
  }),

  // Financial health
  analysisCase(6, 'health', 'Give me a financial-health snapshot from last month’s cash flow.', {
    calls: ['cashflowSep'],
    required: [money('120812.37'), money('45319.50'), money('75492.87'), [rate('0.6248769890')]],
    mentions: [/income/i, /expenses?/i, /savings/i],
    forbidden: [rate('-0.6248769890')],
    bound: [
      bind(/\bincome\b/i, money('120812.37')),
      bind(/\b(?:expenses?|spending|spent)\b/i, money('45319.50')),
      bind(/\bsavings\b(?!\s+rate)/i, money('75492.87')),
      bind(/savings rate/i, rate('0.6248769890')),
    ],
  }),
  analysisCase(7, 'health', 'Review this month’s category budgets. Where am I over or under?', {
    calls: ['budgetsOct'],
    required: [money('5040'), money('3150'), [{ money: '-650', eitherSign: true }]],
    mentions: [/food/i, /dining/i, /over budget|over by|exceed/i],
    contradictions: DINING_REVERSED,
    bound: [bind(/\bfood\b/i, money('5040')), bind(/\bdining\b/i, money('3150'))],
  }),
  analysisCase(8, 'health', 'Review my recorded cash balances and loan obligations.', {
    calls: ['accounts', 'liabilities'],
    required: [money('412022.37'), [{ money: '-14969.50', eitherSign: true }], money('2412345.67'), money('24500')],
    mentions: [/HDFC Savings/i, /credit card/i, /home loan/i],
    bound: [
      bind(/HDFC Savings/i, money('412022.37')),
      bind(/credit card/i, { money: '-14969.50', eitherSign: true }),
      bind(/home loan/i, money('2412345.67')),
      bind(/\bEMI\b/i, money('24500')),
    ],
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
    bound: [
      bind(/housing/i, money('25000')),
      bind(/\b(?:October|this month)\b/i, money('30040')),
      bind(/\b(?:September|last month)\b/i, money('45319.50')),
    ],
    contradictions: [/\b(?:October|this month)\b(?:(?!\b(?:lower|less|decreased|down)\b)[^;!?]){0,50}\b(?:higher|more than|increased|rose|up from)\b/i],
  }),
  analysisCase(12, 'period', 'Summarise my recorded net-worth trend from June through September.', {
    calls: ['netWorthHistory'],
    required: [money('7404700'), money('7409692'), money('7494242'), money('8017389.20')],
    forbidden: money('30326023.20'),
    bound: [
      bind(/\bJune\b/i, money('7404700')),
      bind(/\bJuly\b/i, money('7409692')),
      bind(/\bAugust\b/i, money('7494242')),
      bind(/\bSeptember\b/i, money('8017389.20')),
    ],
    mentions: [/cost/i, /(?:rose|increased|grew|higher|upward)/i],
    contradictions: [/\bnet[- ]worth\b(?:(?!\b(?:rose|increased|grew|higher|upward)\b)[^;!?]){0,40}\b(?:fell|decreased|declined|dropped|shrank|lower|downward)\b/i],
  }),

  // Cross-domain analysis
  analysisCase(13, 'cross-domain', 'Give a snapshot that connects my net worth and portfolio, including valuation limits.', {
    calls: ['netWorthCost', 'portfolio', 'holdings'],
    required: [money('8107349.20'), money('148100'), money('-24220')],
    mentions: [/cost/i, /partial|incomplete|coverage/i, /HDFC ?BANK/i, /stale/i],
    contradictions: [CURRENT_PRICE, HDFC_VALUE, TWR_FIGURE],
    bound: [
      bind(/net[- ]worth/i, money('8107349.20')),
      bind(/market value/i, money('148100')),
      bind(/total return/i, money('-24220')),
    ],
  }),
  analysisCase(14, 'cross-domain', 'Connect my savings, current budget pressure and debt obligations.', {
    calls: ['cashflowSep', 'budgetsOct', 'liabilities'],
    required: [money('75492.87'), [{ money: '-650', eitherSign: true }], money('2412345.67'), money('24500')],
    mentions: [/savings/i, /dining/i, /over budget|over by|exceed/i, /home loan/i],
    contradictions: DINING_REVERSED,
    bound: [
      bind(/\bsavings\b/i, money('75492.87')),
      bind(/home loan/i, money('2412345.67')),
      bind(/\bEMI\b/i, money('24500')),
    ],
  }),
  analysisCase(15, 'cross-domain', 'Before I consider adding an investment, analyse my cash, obligations, savings and existing portfolio.', {
    calls: ['accounts', 'liabilities', 'cashflowSep', 'portfolio', 'holdings'],
    required: [money('412022.37'), money('24500'), money('75492.87'), money('148100')],
    mentions: [/HDFC ?BANK.{0,60}(?:no price|unpriced|missing price)/i, /NIFTYBEES.{0,60}(?:stale|old price|out of date)/i, /(?:risk tolerance|time horizon|goals|emergency fund)/i],
    contradictions: [CURRENT_PRICE, HDFC_VALUE, TWR_FIGURE, /\b(?:you should|I recommend|I would recommend)\s+(?:to\s+)?(?:invest|buy)\b/i],
    bound: [
      bind(/HDFC Savings/i, money('412022.37')),
      bind(/\bEMI\b/i, money('24500')),
      bind(/\bsavings\b/i, money('75492.87')),
      bind(/market value/i, money('148100')),
    ],
  }),
];

export function scoreAnalysisOutput(
  output: string | null,
  toolCalls: readonly { name: string; argumentsJson: string }[],
  golden: AnalysisGoldenCase,
): boolean {
  // The full set of relevant results is already in the replay. Further reads
  // are unnecessary, and no model-written figure may be computed from them.
  return (
    toolCalls.length === 0 &&
    scoreGroundingAnswer(output, golden).passed &&
    golden.bound.every((b) => bindingHolds(output ?? '', b))
  );
}

export function analysisSuite(): readonly EvalCase[] {
  const tools = toolDefinitions();
  return ANALYSIS_CASES.map((golden) => ({
    id: golden.id,
    suite: 'analysis',
    messages: groundingMessages(golden),
    tools,
    score: (output, toolCalls) => scoreAnalysisOutput(output, toolCalls, golden),
    // Not a tool-selection measurement: the calls are replayed, not chosen. An
    // unneeded call already fails the case (`score`); counting "made no call"
    // as a tool-call success would pad toolCallCorrectness — 15 free passes
    // that could lift a model over the 0.90 routing gate.
    checkToolCalls: () => null,
  }));
}
