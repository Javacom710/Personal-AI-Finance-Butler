import 'server-only';

import { z } from 'zod';
import { err, ok, type Result } from '../../../lib/result';
import { jsonBytes, type AiReadCtx } from '../../ai-read';
import type { AiFailure } from '../errors';
import type { Orchestrator } from '../orchestrator';
import type { ChatMessage } from '../provider/types';
import { answerFinanceQuestionMessages } from '../prompts/answer-finance-question';
import { dispatchToolCalls, type ToolOutcome } from '../tools/dispatch';
import { toolDefinitions } from '../tools/registry';

export const QUESTION_LIMITS = Object.freeze({ characters: 4000, turns: 4, toolCalls: 8, resultBytes: 65536, answerCharacters: 12000 });
export interface ConversationTurn { readonly role: 'user' | 'assistant'; readonly content: string }
export interface QuestionAnswer {
  /** Model interpretation, never a replacement for the financial source data. */
  readonly interpretation: string;
  readonly sources: readonly ToolOutcome[];
  readonly modelId: string;
  readonly fallbackDepth: number;
  readonly usage?: { readonly promptTokens: number; readonly completionTokens: number; readonly latencyMs: number; readonly tier: number };
}
const invalid = (detail: string) => err<AiFailure>({ kind: 'invalid_output', message: 'The assistant could not complete a reliable answer. Try a narrower question.', detail });

/** In-memory question session; only validated, bounded text history is replayed. No writes. */
export async function answerReadOnlyQuestion(
  ai: AiReadCtx, orchestrator: Orchestrator, rawQuestion: unknown, history: readonly ConversationTurn[] = [],
): Promise<Result<QuestionAnswer, AiFailure>> {
  const parsed = z.string().trim().min(1).max(QUESTION_LIMITS.characters).safeParse(rawQuestion);
  if (!parsed.success) return invalid('Question must contain 1–4,000 characters.');
  const checkedHistory = z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(12000) }).strict()).max(16).safeParse(history);
  if (!checkedHistory.success || checkedHistory.data.reduce((n, m) => n + m.content.length, 0) > 16000 || checkedHistory.data.length % 2 || checkedHistory.data.some((m, i) => m.role !== (i % 2 ? 'assistant' : 'user'))) return invalid('Invalid or excessive conversation context.');
  const baseline = answerFinanceQuestionMessages({ today: ai.today, baseCurrency: ai.base }, parsed.data);
  const messages: ChatMessage[] = [baseline[0]!, ...checkedHistory.data, baseline[1]!];
  const sources: ToolOutcome[] = [];
  const callIds = new Set<string>();
  let resultBytes = 0;
  let fallbackDepth = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let latencyMs = 0;
  for (let turn = 0; turn < QUESTION_LIMITS.turns; turn++) {
    const output = await orchestrator.run({ capability: 'answerFinanceQuestion', messages, tools: toolDefinitions() });
    if (!output.ok) return output;
    const { response } = output.value;
    promptTokens += response.usage.promptTokens;
    completionTokens += response.usage.completionTokens;
    latencyMs += response.latencyMs;
    fallbackDepth = Math.max(fallbackDepth, output.value.fallbackDepth);
    if (response.finishReason !== 'stop' && response.finishReason !== 'tool_calls') return invalid('Incomplete or filtered model response.');
    if (!response.toolCalls.length) {
      const interpretation = response.content?.trim();
      if (response.finishReason !== 'stop' || !interpretation || interpretation.length > QUESTION_LIMITS.answerCharacters) return invalid('Missing, incomplete or oversized answer.');
      return ok({ interpretation, sources, modelId: output.value.modelId, fallbackDepth, usage: { promptTokens, completionTokens, latencyMs, tier: output.value.tier } });
    }
    if (turn === QUESTION_LIMITS.turns - 1 || sources.length + response.toolCalls.length > QUESTION_LIMITS.toolCalls) return invalid('Read budget exhausted.');
    // Reject the entire malformed batch before reading anything. IDs pair tool
    // messages with their calls and must be unique across this question.
    for (const call of response.toolCalls) {
      if (!call.id.trim() || call.id.length > 200 || callIds.has(call.id)) return invalid('Invalid or duplicate tool-call identifier.');
      callIds.add(call.id);
    }
    const outcomes = await dispatchToolCalls(ai, response.toolCalls);
    resultBytes += jsonBytes(outcomes);
    if (resultBytes > QUESTION_LIMITS.resultBytes) return invalid('Tool context budget exhausted.');
    messages.push({ role: 'assistant', content: response.content ?? '', toolCalls: response.toolCalls });
    for (const outcome of outcomes) {
      sources.push(outcome);
      messages.push({ role: 'tool', content: JSON.stringify(outcome.result), toolCallId: outcome.callId });
    }
  }
  return invalid('Read budget exhausted.');
}
