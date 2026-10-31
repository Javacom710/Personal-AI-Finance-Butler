import 'server-only';

/**
 * The `grounding` golden suite — does the answer state the engine's figure, and
 * only figures a tool returned? ([AI-SYSTEM.md §14](../../../../../docs/AI-SYSTEM.md))
 *
 * Each case replays one finished tool turn: the question, the call a correct
 * model makes, and the production handler's result for it over a fixed fixture
 * database (`grounding-calls.ts`, `grounding-results.json`). The model then
 * writes the answer. The results are frozen so the suite runs without a
 * database; `tests/integration/ai-eval-grounding.test.ts` proves each frozen
 * result is exactly what the handler returns, so an expected figure is the
 * engine's figure rather than one typed by hand.
 *
 * Scoring is deterministic. An answer passes when:
 *
 * - **every figure it states is traceable** to a value in the tool results it
 *   was given, at the precision it states it. "₹8,640.50", "₹8,641" and
 *   "₹8.64 lakh" all trace to 8640.5000. A figure the model computed — a sum of
 *   rows, a difference of two levels — traces to nothing and fails, because
 *   AI-SYSTEM.md rule 7 says the model never states a figure it did not receive;
 * - **every required figure is stated**, to the rupee for money. A percentage
 *   may be rounded to any precision, but must round from the engine's rate;
 * - **no forbidden figure is stated**. These are the known wrong answers: the
 *   parent's own row reported as its rollup, overlapping tag rows added up,
 *   net-worth levels summed;
 * - **every required mention is present** — the valuation basis of a net-worth
 *   figure, the holding a market valuation excluded, the reason a metric is
 *   unavailable.
 *
 * Some cases give the model a result that cannot answer the question — a
 * `detail` breakdown for a parent's total, a `rollup` for a child's. The right
 * move is another call, and the case lists the calls that would be right.
 * Prose cannot pass such a case: the only figure that would answer it is one
 * the model would have to compute.
 *
 * Only figures are judged. A date ("30 September", "2026-09-30"), a year, and a
 * bare whole number up to 31 are not figures; anything else numeric is.
 *
 * Bump {@link GROUNDING_SUITE_VERSION} whenever a case, an expectation, the
 * fixture, the frozen results or the scoring rules change.
 */

import { answerFinanceQuestionMessages } from '../../prompts/answer-finance-question';
import type { ChatMessage, ToolCall } from '../../provider/types';
import { toolDefinitions } from '../../tools/registry';
import type { EvalCase } from '../harness';
import { GROUNDING_BASE_CURRENCY, GROUNDING_CALLS, GROUNDING_TODAY, type GroundingCallKey } from './grounding-calls';
import groundingResults from './grounding-results.json';
import { scoreToolSelectCalls, type ExpectedCall } from './tool-select';

export const GROUNDING_SUITE_VERSION = 1;

/** A figure: an exact amount, or a rate stated as a fraction (`0.62` is 62%). */
export type Figure = { readonly money: string } | { readonly rate: string };

export interface GroundingGoldenCase {
  readonly id: string;
  readonly question: string;
  /** The calls already made, in order. Their frozen results are what the model sees. */
  readonly calls: readonly GroundingCallKey[];
  /** Each entry must be stated; an entry with several figures is satisfied by any one. */
  readonly required: readonly (readonly Figure[])[];
  /** Figures that must not be stated: the known wrong answers. */
  readonly forbidden: readonly Figure[];
  /** Patterns the answer must contain. */
  readonly mentions: readonly RegExp[];
  /**
   * The further calls that would be right instead of an answer. Absent: the
   * results already answer the question, and a further call fails the case.
   */
  readonly followUp?: readonly ExpectedCall[];
}

/** The frozen tool results, by call key. */
export const GROUNDING_RESULTS = groundingResults as Readonly<Record<GroundingCallKey, unknown>>;

const SEPTEMBER = '2026-09';

const money = (...amounts: string[]): Figure[] => amounts.map((amount) => ({ money: amount }));
const rate = (value: string): Figure => ({ rate: value });

interface Spec {
  readonly calls: readonly GroundingCallKey[];
  readonly required?: readonly (readonly Figure[])[];
  readonly forbidden?: readonly Figure[];
  readonly mentions?: readonly RegExp[];
  readonly followUp?: readonly ExpectedCall[];
}

const g = (id: number, question: string, spec: Spec): GroundingGoldenCase => ({
  id: `grounding-${String(id).padStart(3, '0')}`,
  question,
  calls: spec.calls,
  required: spec.required ?? [],
  forbidden: spec.forbidden ?? [],
  mentions: spec.mentions ?? [],
  ...(spec.followUp ? { followUp: spec.followUp } : {}),
});

/** Says, in some words, that a value is not available. */
const UNAVAILABLE = /unavailable|not available|isn'?t available|insufficient|not enough|cannot|can'?t|unable|no (?:current |live )?price|missing|not priced|unpriced/i;

export const GROUNDING_CASES: readonly GroundingGoldenCase[] = [
  // — A parent category over a Food → {Groceries, Dining} tree, Food with spending of its own —
  g(1, 'How much did I spend on food last month?', {
    calls: ['expenseSepRollup'],
    required: [money('8640.50')],
    // Food's own row, and its children without it.
    forbidden: money('800', '7840.50'),
  }),
  // The detail rows partition the total, but no row is "food": its total is a
  // sum of three rows. The right move is the rollup.
  g(2, 'How much did I spend on food last month?', {
    calls: ['expenseSepDetail'],
    followUp: [
      {
        tool: 'get_expense_summary',
        args: { asOf: { inMonth: SEPTEMBER }, groupBy: { absentOr: 'category' }, depth: { absentOr: 'rollup' } },
      },
    ],
  }),
  g(3, 'How much did I spend on dining out last month?', {
    calls: ['expenseSepDetail'],
    required: [money('3610')],
  }),
  // The rollup folds Groceries into Food; no row answers it.
  g(4, 'How much did I spend on groceries last month?', {
    calls: ['expenseSepRollup'],
    followUp: [
      {
        tool: 'get_expense_summary',
        args: { asOf: { inMonth: SEPTEMBER }, groupBy: { absentOr: 'category' }, depth: { is: 'detail' } },
      },
    ],
  }),
  g(5, 'What was my total spending last month?', {
    calls: ['expenseSepRollup'],
    required: [money('45319.50')],
  }),
  g(6, 'Which category did I spend the most on last month, and how much was it?', {
    calls: ['expenseSepRollup'],
    required: [money('25000')],
    mentions: [/housing/i],
  }),
  // Two categories: no field holds their sum, so the answer gives both.
  g(7, 'How much did I spend on food and transport combined last month?', {
    calls: ['expenseSepRollup'],
    required: [money('8640.50'), money('3240')],
    forbidden: money('11880.50'),
  }),
  g(8, 'Which account did I spend the most from last month?', {
    calls: ['expenseSepByAccount'],
    required: [money('26940')],
    mentions: [/HDFC Savings/i],
  }),

  // — Tags overlap: one transaction carries two, so the rows never add up —
  g(9, 'How much did I spend on the Goa trip last month? I tagged it goa-trip.', {
    calls: ['expenseSepByTag'],
    required: [money('5600')],
  }),
  g(10, 'How much did my tagged spending come to last month? Give me the total and the split by tag.', {
    calls: ['expenseSepByTag'],
    required: [money('8859'), money('5600')],
    // goa-trip + reimbursable: the client dinner would be counted twice.
    forbidden: money('14459'),
  }),

  // — Cash flow —
  g(11, 'How much did I save last month?', {
    calls: ['cashflowSep'],
    required: [money('75492.87')],
  }),
  g(12, 'What was my savings rate last month?', {
    calls: ['cashflowSep'],
    required: [[rate('0.6248769890')]],
  }),
  g(13, 'How much income did I receive last month?', {
    calls: ['incomeSep'],
    required: [money('120812.37')],
  }),
  g(14, 'Compare my spending this month with last month.', {
    calls: ['compareOct'],
    required: [money('30040'), money('45319.50')],
  }),

  // — Budgets —
  g(15, 'Am I over budget on anything this month?', {
    calls: ['budgetsOct'],
    required: [money('650', '3150')],
    mentions: [/dining/i],
  }),

  // — Accounts —
  g(16, "What's my HDFC Savings balance?", {
    calls: ['accounts'],
    required: [money('412022.37')],
  }),
  g(17, 'How much do I owe on my credit card right now?', {
    calls: ['accounts'],
    required: [money('14969.50')],
  }),

  // — Net worth: the basis is part of the answer —
  g(18, 'What is my net worth?', {
    calls: ['netWorthCost'],
    required: [money('8107349.20')],
    mentions: [/\bcost\b/i],
  }),
  g(19, 'What is my net worth at current market value?', {
    calls: ['netWorthMarket'],
    required: [money('8076437.20')],
    // The market figure leaves out the unpriced HDFC Bank holding.
    mentions: [/market/i, /HDFC ?BANK/i],
  }),
  g(20, 'Show my net worth at the end of June, July, August and September.', {
    calls: ['netWorthHistory'],
    required: [money('7404700'), money('7409692'), money('7494242'), money('8017389.20')],
    // Levels, not flows.
    forbidden: money('30326023.20'),
    mentions: [/\bcost\b/i],
  }),
  g(21, 'How much is still outstanding on my home loan?', {
    calls: ['liabilities'],
    required: [money('2412345.67')],
  }),
  g(22, 'What are my gold coins worth?', {
    calls: ['assets'],
    required: [money('410000')],
  }),

  // — Investments: unpriced and unavailable are not zero —
  g(23, 'What is my portfolio worth?', {
    calls: ['portfolio'],
    required: [money('148100')],
  }),
  g(24, 'What is my time-weighted return?', {
    calls: ['portfolio'],
    forbidden: [rate('0')],
    mentions: [UNAVAILABLE],
  }),
  g(25, 'What share of my portfolio is in ETFs?', {
    calls: ['allocationByClass'],
    required: [[rate('0.3841998650')]],
  }),
];

// ------------------------------------------------------------------ figures

/** Exact decimals as a scaled integer. Only what the suite needs: no exponent, no locale. */
const SCALE = 12;

function toScaled(value: string): bigint | null {
  const match = /^-?(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return null;
  const whole = match[1] ?? '0';
  const fraction = (match[2] ?? '').slice(0, SCALE).padEnd(SCALE, '0');
  return BigInt(whole) * 10n ** BigInt(SCALE) + BigInt(fraction);
}

/** `|value| / 10^shift`, rounded half-up to `places`, as a scaled integer at `places`. */
function roundTo(scaled: bigint, shift: number, places: number): bigint {
  const magnitude = scaled < 0n ? -scaled : scaled;
  const drop = SCALE + shift - places;
  if (drop <= 0) return magnitude * 10n ** BigInt(-drop);
  const divisor = 10n ** BigInt(drop);
  return (magnitude + divisor / 2n) / divisor;
}

/** A number as the answer states it. */
interface StatedFigure {
  readonly text: string;
  readonly kind: 'money' | 'percent';
  /** The stated digits at their stated precision, as an integer: "8,640.50" → 864050. */
  readonly digits: bigint;
  readonly places: number;
  /** Powers of ten the unit word multiplies by: lakh 5, crore 7, k 3. */
  readonly shift: number;
}

const UNIT_SHIFT: Readonly<Record<string, number>> = {
  k: 3,
  thousand: 3,
  lakh: 5,
  lakhs: 5,
  lac: 5,
  lacs: 5,
  crore: 7,
  crores: 7,
  cr: 7,
};

const FIGURE =
  /(?:(₹|rs\.?|inr|\$)\s?)?(\d{1,3}(?:,\d{2,3})+|\d+)(\.\d+)?(?:\s?(%|per ?cent\b|percent\b|k\b|thousand\b|lakhs?\b|lacs?\b|crores?\b|cr\b))?/gi;

/** The figures an answer states. Dates, years and small whole numbers are not figures. */
export function statedFigures(answer: string): readonly StatedFigure[] {
  const text = answer
    .replace(/\d{4}-\d{2}-\d{2}/g, ' ')
    // A figure written with a minus sign is still the same magnitude.
    .replace(/[−–]/g, '-');
  const figures: StatedFigure[] = [];
  for (const match of text.matchAll(FIGURE)) {
    const [whole, currency, integer, fraction, unitRaw] = match;
    if (!integer) continue;
    // Part of a word or identifier, such as "Nifty50" or "F1".
    const before = text[(match.index ?? 0) - 1];
    if (before !== undefined && /[A-Za-z_]/.test(before) && !currency) continue;

    const unit = unitRaw?.toLowerCase().replace(/\s/g, '');
    const plain = integer.replace(/,/g, '');
    const places = fraction ? fraction.length - 1 : 0;
    const isPercent = unit !== undefined && (unit === '%' || unit.startsWith('per'));
    const shift = unit !== undefined && !isPercent ? (UNIT_SHIFT[unit] ?? 0) : 0;

    if (!currency && !unit && !fraction && !integer.includes(',')) {
      const n = Number(plain);
      if (n <= 31) continue;
      if (plain.length === 4 && n >= 1900 && n <= 2100) continue;
    }
    figures.push({
      text: whole.trim(),
      kind: isPercent ? 'percent' : 'money',
      digits: BigInt(`${plain}${fraction ? fraction.slice(1) : ''}`),
      places,
      shift,
    });
  }
  return figures;
}

/** Does a stated figure round from this exact value, at the precision it is stated? */
function statesValue(figure: StatedFigure, value: string, asPercent: boolean): boolean {
  const scaled = toScaled(value);
  if (scaled === null) return false;
  const shift = figure.shift - (asPercent ? 2 : 0);
  return roundTo(scaled, shift, figure.places) === figure.digits;
}

function statesFigure(stated: StatedFigure, expected: Figure): boolean {
  if ('rate' in expected) return stated.kind === 'percent' && statesValue(stated, expected.rate, true);
  return stated.kind === 'money' && statesValue(stated, expected.money, false);
}

/** Stated to the rupee: neither "₹8.6k" nor "₹86 lakh" states an exact amount. */
const toTheUnit = (stated: StatedFigure): boolean => stated.kind !== 'money' || stated.shift === 0;

// ------------------------------------------------------------- traceability

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Every value a tool result carries: the numbers, and the rates as fractions. */
export function traceableValues(results: readonly unknown[]): { readonly numbers: readonly string[]; readonly rates: readonly string[] } {
  const numbers: string[] = [];
  const rates: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'number') numbers.push(String(node));
    else if (typeof node === 'string') {
      const cleaned = node.replace(UUID, ' ').replace(/\d{4}-\d{2}-\d{2}/g, ' ');
      for (const token of cleaned.match(/-?\d+(?:\.\d+)?/g) ?? []) numbers.push(token);
    } else if (Array.isArray(node)) node.forEach(walk);
    else if (node !== null && typeof node === 'object') {
      const record = node as Record<string, unknown>;
      if (record['kind'] === 'rate' && typeof record['value'] === 'string') rates.push(record['value']);
      Object.values(record).forEach(walk);
    }
  };
  results.forEach(walk);
  return { numbers, rates };
}

function traceable(stated: StatedFigure, values: ReturnType<typeof traceableValues>): boolean {
  if (stated.kind === 'percent') return values.rates.some((r) => statesValue(stated, r, true));
  return values.numbers.some((n) => statesValue(stated, n, false));
}

// ------------------------------------------------------------------ scoring

export interface GroundingVerdict {
  readonly passed: boolean;
  readonly untraceable: readonly string[];
  readonly missing: readonly string[];
  readonly forbidden: readonly string[];
  readonly unmentioned: readonly string[];
}

const describe = (figure: Figure): string => ('rate' in figure ? `${figure.rate} (rate)` : figure.money);

/** Score a prose answer. A case that needs a further call cannot pass on prose. */
export function scoreGroundingAnswer(answer: string | null, golden: GroundingGoldenCase): GroundingVerdict {
  const text = answer ?? '';
  const stated = statedFigures(text);
  const values = traceableValues(golden.calls.map((key) => GROUNDING_RESULTS[key]));

  const untraceable = stated.filter((s) => !traceable(s, values)).map((s) => s.text);
  const missing = golden.required
    .filter((anyOf) => !anyOf.some((f) => stated.some((s) => toTheUnit(s) && statesFigure(s, f))))
    .map((anyOf) => anyOf.map(describe).join(' or '));
  const forbidden = golden.forbidden.filter((f) => stated.some((s) => statesFigure(s, f))).map(describe);
  const unmentioned = golden.mentions.filter((pattern) => !pattern.test(text)).map(String);

  const passed =
    golden.followUp === undefined &&
    text.trim() !== '' &&
    untraceable.length === 0 &&
    missing.length === 0 &&
    forbidden.length === 0 &&
    unmentioned.length === 0;
  return { passed, untraceable, missing, forbidden, unmentioned };
}

/** Score a further call: right only where the case lists it. */
export function scoreGroundingFollowUp(
  toolCalls: readonly { name: string; argumentsJson: string }[],
  golden: GroundingGoldenCase,
): boolean {
  if (!golden.followUp || toolCalls.length === 0) return false;
  return scoreToolSelectCalls(toolCalls, { id: golden.id, question: golden.question, needs: [golden.followUp] });
}

export function scoreGrounding(
  output: string | null,
  toolCalls: readonly { name: string; argumentsJson: string }[],
  golden: GroundingGoldenCase,
): boolean {
  if (toolCalls.length > 0) return scoreGroundingFollowUp(toolCalls, golden);
  return scoreGroundingAnswer(output, golden).passed;
}

// ------------------------------------------------------------------ cases

/** The conversation up to the answer: the question, the calls, and their frozen results. */
export function groundingMessages(golden: GroundingGoldenCase): readonly ChatMessage[] {
  const context = { today: GROUNDING_TODAY, baseCurrency: GROUNDING_BASE_CURRENCY };
  const toolCalls: ToolCall[] = golden.calls.map((key, n) => ({
    id: `call_${n + 1}`,
    name: GROUNDING_CALLS[key].tool,
    argumentsJson: JSON.stringify(GROUNDING_CALLS[key].args),
  }));
  return [
    ...answerFinanceQuestionMessages(context, golden.question),
    { role: 'assistant', content: '', toolCalls },
    ...golden.calls.map((key, n) => ({
      role: 'tool' as const,
      toolCallId: `call_${n + 1}`,
      content: JSON.stringify(GROUNDING_RESULTS[key]),
    })),
  ];
}

export function groundingSuite(): readonly EvalCase[] {
  const tools = toolDefinitions();
  return GROUNDING_CASES.map((golden) => ({
    id: golden.id,
    suite: 'grounding' as const,
    messages: groundingMessages(golden),
    tools,
    score: (output, toolCalls) => scoreGrounding(output, toolCalls, golden),
    // An answer is not a tool call; only a further call is judged as one.
    checkToolCalls: (toolCalls) => (toolCalls.length === 0 ? null : scoreGroundingFollowUp(toolCalls, golden)),
  }));
}
