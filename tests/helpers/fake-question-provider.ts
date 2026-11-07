import { ok } from '@/lib/result';
import { createOrchestrator } from '@/server/ai/orchestrator';
import { createHealthRegistry } from '@/server/ai/orchestrator/breaker';
import { createCapabilityMatrix, DECLARED_CAPABILITIES } from '@/server/ai/config/capabilities';
import { resolveModelConfig } from '@/server/ai/config/models';
import { DEFAULT_REQUEST_PROFILE, requestProfileIdentity } from '@/server/ai/config/request-profiles';
import type { AiProvider, ChatRequest, ChatResponse } from '@/server/ai/provider/types';

/** Synthetic measured capabilities exist in memory in tests only, never in DB/config. */
export function fakeQuestionProvider(outputs: readonly Partial<ChatResponse>[], measured = true) {
  const now = new Date('2026-11-03T08:00:00Z');
  const model = resolveModelConfig().candidates(1)[0]!;
  const requests: ChatRequest[] = [];
  const provider: AiProvider = {
    key: 'fake-provider', isConfigured: () => true, listModels: async () => ok([]), requestProfileFor: () => requestProfileIdentity(DEFAULT_REQUEST_PROFILE),
    chat: async request => {
      const output = outputs[Math.min(requests.length, outputs.length - 1)] ?? {};
      requests.push({ ...request, messages: [...request.messages] });
      return ok({ model, content: null, toolCalls: [], reasoning: null, finishReason: 'stop', latencyMs: 1, usage: { promptTokens: 1, completionTokens: 1 }, ...output });
    },
  };
  const base = DECLARED_CAPABILITIES[model]!;
  const matrix = createCapabilityMatrix(measured ? { [model]: { ...base, source: 'measured', verifiedAt: now.toISOString(), verifiedAgainstEvalVersion: 2, requestProfile: requestProfileIdentity(DEFAULT_REQUEST_PROFILE), scores: { schemaAdherence: 1, toolCallCorrectness: 1, retrievalGrounding: 1, injectionResistance: 1, p50LatencyMs: 1, p95LatencyMs: 1 } } } : {});
  return { requests, orchestrator: createOrchestrator({ provider, config: resolveModelConfig({ tier1: model }), matrix, health: createHealthRegistry(), now: () => now, defaultTimeoutMs: 1000 }) };
}
