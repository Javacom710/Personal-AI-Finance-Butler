import 'server-only';
import { err, ok, type Result } from '../../../lib/result';
import { jsonBytes, type AiReadCtx } from '../../ai-read';
import { invalidOutput, type AiFailure } from '../errors';
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
const readArguments = (raw: string) => JSON.stringify(JSON.parse(raw), (_key, value: unknown) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);

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

/** One gated tool turn and interpretation, no writes, dynamic reads or retry. */
export async function runFinancialReview(ai: AiReadCtx, orchestrator: Orchestrator, plan: ReviewPlan): Promise<Result<FinancialReview, AiFailure>> {
  if (!plan.calls.length || plan.calls.length > REVIEW_LIMITS.calls || new Set(plan.calls.map(c => c.id)).size !== plan.calls.length) return err(invalidOutput('Invalid review read plan.'));
  const names = new Set(plan.calls.map(c => c.name));
  const tools = toolDefinitions().filter(t => names.has(t.name));
  const messages: ChatMessage[] = [...answerFinanceQuestionMessages({ today: ai.today, baseCurrency: ai.base }, [
    plan.title, JSON.stringify(plan.scope),
    'Request exactly the following reads, with these names and arguments. Do not add, omit or duplicate a read.',
    `Read plan: ${JSON.stringify(plan.calls)}`,
    'After receiving the results, return exactly two sections, headed Interpretation: and Recommendations: on their own lines.',
    'Write qualitative English only: no digits, amounts, percentages, numerical words, arithmetic or forecasts.',
    'The application displays all figures separately from the tool results. Do not repeat them in prose.',
    'Separate your interpretation from optional recommendations; say when no recommendation is supported.',
    'Respect unavailable metrics, incomplete coverage, stale prices, currency, period and additivity metadata.',
    'Recommendations are optional considerations, never instructions to trade, guarantees or scenarios.',
  ].join('\n'))];
  // Use the actual orchestrator, not explain(): diagnostic selection can consume
  // a half-open breaker probe. Every turn retains the existing capability gate.
  const requested = await orchestrator.run({ capability: plan.capability, messages, tools });
  if (!requested.ok) return requested;
  const calls = requested.value.response.toolCalls;
  if (requested.value.response.finishReason !== 'tool_calls' || calls.length !== plan.calls.length || new Set(calls.map(c => c.id)).size !== calls.length || calls.some(c => !c.id.trim() || c.id.length > 200)) return err(invalidOutput('The review did not request its exact bounded read plan.'));
  let matching: number[];
  try {
    matching = plan.calls.map(expected => calls.findIndex(actual => actual.name === expected.name && readArguments(actual.argumentsJson) === readArguments(expected.argumentsJson)));
  } catch { return err(invalidOutput('The review requested malformed read arguments.')); }
  if (matching.some(i => i < 0) || new Set(matching).size !== plan.calls.length) return err(invalidOutput('The review requested different or duplicate reads.'));
  // Execute application-owned arguments only, after checking the whole batch.
  const sources = await dispatchToolCalls(ai, plan.calls);
  if (sources.every(reviewSourceUnavailable)) return err(invalidOutput('The financial sources are unavailable. No interpretation was generated.'));
  if (jsonBytes(sources) > REVIEW_LIMITS.bytes) return err(invalidOutput('Review sources exceed the context budget.'));
  messages.push({ role: 'assistant', content: '', toolCalls: calls }, ...sources.map((s, i) => ({ role: 'tool' as const, content: JSON.stringify(s.result), toolCallId: calls[matching[i]!]!.id })));
  const result = await orchestrator.run({ capability: plan.capability, messages, tools });
  if (!result.ok) return result;
  const response = result.value.response;
  if (response.finishReason !== 'stop' || response.toolCalls.length) return err(invalidOutput('Incomplete review or unexpected tool request.'));
  const narrative = reviewNarrative(response.content);
  if (!narrative) return err(invalidOutput('The review needs separate, qualitative interpretation and recommendation sections.'));
  return ok({ title: plan.title, scope: plan.scope, sources, ...narrative, modelId: result.value.modelId });
}
