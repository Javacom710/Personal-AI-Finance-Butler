import { ok } from '@/lib/result';
import { createOrchestrator } from '@/server/ai/orchestrator';
import { createHealthRegistry } from '@/server/ai/orchestrator/breaker';
import { createCapabilityMatrix, DECLARED_CAPABILITIES } from '@/server/ai/config/capabilities';
import { resolveModelConfig } from '@/server/ai/config/models';
import { DEFAULT_REQUEST_PROFILE, requestProfileIdentity } from '@/server/ai/config/request-profiles';
import type { AiProvider, ChatRequest, ChatResponse } from '@/server/ai/provider/types';
export const REVIEW_PROSE = 'Interpretation:\nThe recorded cash flow and spending categories describe the period. Missing metrics remain unavailable.\nRecommendations:\nConsider reviewing the budget categories alongside the recorded cash flow before making changes.';
/** Synthetic capabilities in memory only; no HTTP or capability records. */
export function fakeReviewProvider(output: Partial<ChatResponse> = {}, measured = true, first: Partial<ChatResponse> = {}, tier: 1 | 2 = 2) {
  const model = tier === 1 ? resolveModelConfig().candidates(1)[0]! : 'nvidia/nemotron-3-super-120b-a12b';
  let now = new Date('2026-11-03T08:00:00Z'); const requests: ChatRequest[] = [];
  const health = createHealthRegistry();
  const profile = requestProfileIdentity(DEFAULT_REQUEST_PROFILE);
  const provider: AiProvider = { key: 'fake-provider', isConfigured: () => true, listModels: async () => ok([]), requestProfileFor: () => profile,
    chat: async request => {
      requests.push({ ...request, messages: [...request.messages] });
      const baseResponse = { model, content: REVIEW_PROSE, toolCalls: [], reasoning: null, finishReason: 'stop' as const, latencyMs: 1, usage: { promptTokens: 1, completionTokens: 1 } };
      if (!request.messages.some(m => m.role === 'tool')) {
        const line = request.messages.find(m => m.role === 'user')!.content.split('\n').find(line => line.startsWith('Read plan: '))!;
        return ok({ ...baseResponse, content: null, finishReason: 'tool_calls', toolCalls: JSON.parse(line.slice('Read plan: '.length)), ...first });
      }
      return ok({ ...baseResponse, ...output });
    } };
  const base = DECLARED_CAPABILITIES[model]!;
  const matrix = createCapabilityMatrix(measured ? { [model]: { ...base, source: 'measured', requestProfile: profile, verifiedAt: now.toISOString(), verifiedAgainstEvalVersion: 2, scores: { schemaAdherence: 1, toolCallCorrectness: 1, retrievalGrounding: 1, injectionResistance: 1, p50LatencyMs: 1, p95LatencyMs: 1 } } } : {});
  return { requests, model, health, advance: (ms: number) => { now = new Date(now.getTime() + ms); }, orchestrator: createOrchestrator({ provider, config: resolveModelConfig(tier === 1 ? { tier1: model } : { tier2: model }), matrix, health, now: () => now, defaultTimeoutMs: 1000 }) };
}
