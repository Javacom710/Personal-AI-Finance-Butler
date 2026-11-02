import { ok } from '@/lib/result';
import { createOrchestrator } from '@/server/ai/orchestrator';
import { createHealthRegistry } from '@/server/ai/orchestrator/breaker';
import { createCapabilityMatrix, DECLARED_CAPABILITIES } from '@/server/ai/config/capabilities';
import { resolveModelConfig } from '@/server/ai/config/models';
import { DEFAULT_REQUEST_PROFILE, requestProfileIdentity } from '@/server/ai/config/request-profiles';
import type { AiProvider, ChatRequest, ToolCall } from '@/server/ai/provider/types';

/** Synthetic measured capabilities exist in memory in tests only, never in DB/config. */
export function fakeTransactionInterpreter(outputs: readonly string[], now = new Date('2026-08-10T12:00:00Z'), measured = true, toolCalls: readonly ToolCall[] = []) {
  const model = resolveModelConfig().candidates(1)[0]!;
  const requests: ChatRequest[] = [];
  const provider: AiProvider = {
    key: 'fake-provider', isConfigured: () => true, listModels: async () => ok([]), requestProfileFor: () => requestProfileIdentity(DEFAULT_REQUEST_PROFILE),
    chat: async request => {
      requests.push(request);
      return ok({ model, content: outputs[Math.min(requests.length - 1, outputs.length - 1)] ?? '', toolCalls, reasoning: null, finishReason: 'stop', latencyMs: 1, usage: { promptTokens: 1, completionTokens: 1 } });
    },
  };
  const base = DECLARED_CAPABILITIES[model]!;
  const matrix = createCapabilityMatrix(measured ? { [model]: { ...base, source: 'measured', verifiedAt: now.toISOString(), verifiedAgainstEvalVersion: 2, requestProfile: requestProfileIdentity(DEFAULT_REQUEST_PROFILE), scores: { schemaAdherence: 1, toolCallCorrectness: 1, retrievalGrounding: 1, injectionResistance: 1, p50LatencyMs: 1, p95LatencyMs: 1 } } } : {});
  return { requests, orchestrator: createOrchestrator({ provider, config: resolveModelConfig({ tier1: model }), matrix, health: createHealthRegistry(), now: () => now, defaultTimeoutMs: 1000 }) };
}
export const syntheticTransaction = (over: Record<string, unknown> = {}) => ({
  kind: 'expense', bookedOn: '2026-08-10', description: 'Dinner', amount: '1250.50', currency: 'INR', accountHint: 'Bank', toAccountHint: null, categoryHint: 'Dining', tags: [], notes: null, confidence: 'high', ambiguities: [], ...over,
});
