import 'server-only';
import { err, ok, type Result } from '../../../lib/result';
import { jsonBytes, type AiReadCtx } from '../../ai-read';
import { invalidOutput, noCapableModel, type AiFailure } from '../errors';
import type { Orchestrator } from '../orchestrator';
import type { AiCapability } from '../orchestrator/requirements';
import { answerFinanceQuestionMessages } from '../prompts/answer-finance-question';
import type { ChatMessage, ToolCall } from '../provider/types';
import { dispatchToolCalls, type ToolOutcome } from '../tools/dispatch';
import { toolDefinitions } from '../tools/registry';

export interface ReviewPlan {
  readonly title: string;
  readonly scope: Readonly<Record<string, string>>;
  readonly capability: Extract<AiCapability, 'analyzeFinancialPeriod' | 'analyzePortfolio' | 'analyzeFinancialHealth' | 'summarizeFinancialData'>;
  /** Application-owned, validated calls; never supplied by a model or browser. */
  readonly calls: readonly ToolCall[];
}
export interface FinancialReview {
  readonly title: string;
  readonly scope: Readonly<Record<string, string>>;
  readonly sources: readonly ToolOutcome[];
  readonly interpretation: string;
  readonly recommendation: string;
  readonly modelId: string;
}
export const REVIEW_LIMITS = Object.freeze({ calls: 8, bytes: 65536, narrativeCharacters: 8000 });
export const reviewSourceUnavailable = (source: ToolOutcome) => source.failed || (source.result !== null && typeof source.result === 'object' && 'ok' in source.result && source.result.ok === false);

/** New review prose is deliberately qualitative; figures are rendered only from tool data. */
export function reviewNarrative(content: string | null) {
  if (!content || content.length > REVIEW_LIMITS.narrativeCharacters) return undefined;
  const match = /^Interpretation:\s*\n([\s\S]+?)\nRecommendations:\s*\n([\s\S]+)$/.exec(content.trim());
  if (!match) return undefined;
  const interpretation = match[1]!.trim(); const recommendation = match[2]!.trim();
  // English-only qualitative prose. This validates format/obvious numerical
  // claims, not semantic truth; approved-model grounding is still a release gate.
  const figures = /[\p{N}%₹$€£¥]|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|lakh|crore|million|billion|percent|percentage|half|double|triple|twice)\b/iu;
  if (!interpretation || !recommendation || figures.test(content) || /(?:Interpretation|Recommendations):/.test(interpretation + recommendation)) return undefined;
  return { interpretation, recommendation };
}

/** One bounded interpretation, no writes, dynamic reads, repair or outer retry. */
export async function runFinancialReview(ai: AiReadCtx, orchestrator: Orchestrator, plan: ReviewPlan): Promise<Result<FinancialReview, AiFailure>> {
  const explain = orchestrator.explain(plan.capability);
  if (!explain.candidates.length) return err(noCapableModel(plan.capability, 'No measured model satisfies the existing review capability.'));
  if (!plan.calls.length || plan.calls.length > REVIEW_LIMITS.calls || new Set(plan.calls.map(c => c.id)).size !== plan.calls.length) return err(invalidOutput('Invalid review read plan.'));
  const sources = await dispatchToolCalls(ai, plan.calls);
  if (sources.every(reviewSourceUnavailable)) return err(invalidOutput('The financial sources are unavailable. No interpretation was generated.'));
  if (jsonBytes(sources) > REVIEW_LIMITS.bytes) return err(invalidOutput('Review sources exceed the context budget.'));
  const question = [plan.title, JSON.stringify(plan.scope),
    'Interpret the supplied read-only tool results. Do not request another tool.',
    'Return exactly two sections, headed Interpretation: and Recommendations: on their own lines.',
    'Write qualitative English only: no digits, amounts, percentages, numerical words, arithmetic or forecasts.',
    'The application displays all figures separately from the tool results. Do not repeat them in prose.',
    'Separate your interpretation from optional recommendations; say when no recommendation is supported.',
    'Respect unavailable metrics, incomplete coverage, stale prices, currency, period and additivity metadata.',
    'Recommendations are optional considerations, never instructions to trade, guarantees or scenarios.',
  ].join('\n');
  const messages: ChatMessage[] = [...answerFinanceQuestionMessages({ today: ai.today, baseCurrency: ai.base }, question),
    { role: 'assistant', content: '', toolCalls: plan.calls },
    ...sources.map(s => ({ role: 'tool' as const, content: JSON.stringify(s.result), toolCallId: s.callId })),
  ];
  const names = new Set(plan.calls.map(c => c.name));
  const result = await orchestrator.run({ capability: plan.capability, messages, tools: toolDefinitions().filter(t => names.has(t.name)) });
  if (!result.ok) return result;
  const response = result.value.response;
  if (response.finishReason !== 'stop' || response.toolCalls.length) return err(invalidOutput('Incomplete review or unexpected tool request.'));
  const narrative = reviewNarrative(response.content);
  if (!narrative) return err(invalidOutput('The review needs separate, qualitative interpretation and recommendation sections.'));
  return ok({ title: plan.title, scope: plan.scope, sources, ...narrative, modelId: result.value.modelId });
}
