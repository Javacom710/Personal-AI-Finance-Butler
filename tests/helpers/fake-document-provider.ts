import { err, ok } from '@/lib/result';
import { createOrchestrator } from '@/server/ai/orchestrator';
import { createHealthRegistry } from '@/server/ai/orchestrator/breaker';
import { createCapabilityMatrix, type ModelCapabilities } from '@/server/ai/config/capabilities';
import { resolveModelConfig } from '@/server/ai/config/models';
import { DEFAULT_REQUEST_PROFILE, requestProfileIdentity } from '@/server/ai/config/request-profiles';
import type { AiProvider, ChatRequest, ChatResponse } from '@/server/ai/provider/types';
import { syntheticTransaction } from './fake-transaction-interpreter';
export const DOCUMENT_PNG = { mimeType: 'image/png' as const, data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5d6QAAAABJRU5ErkJggg==' };
export function fakeDocumentProvider(payload: unknown = { transactions: [syntheticTransaction()] }, response: Partial<ChatResponse> = {}, options: { vision?: boolean; measured?: boolean; fail?: boolean; textFallback?: boolean } = {}) {
  const model = 'fake-document-vision'; const text = 'fake-document-text'; const requests: ChatRequest[] = [];
  const profile = requestProfileIdentity(DEFAULT_REQUEST_PROFILE);
  const capabilities: ModelCapabilities = { tier: 4, vision: options.vision !== false, embedding: false, toolCalling: 'none', structuredOutput: 'json_schema', contextTokens: 131072, maxOutputTokens: 8192, streaming: false, source: options.measured === false ? 'declared' : 'measured', requestProfile: profile, scores: { schemaAdherence: 1, toolCallCorrectness: 1, retrievalGrounding: 1, injectionResistance: 1, p50LatencyMs: 1, p95LatencyMs: 1 }, verifiedAt: '2026-11-03T08:00:00Z' };
  const provider: AiProvider = { key: 'fake-provider', isConfigured: () => true, listModels: async () => ok([]), requestProfileFor: () => profile,
    chat: async request => { requests.push(request); return options.fail ? err({ kind: 'transport', status: null, message: 'Fake transport failure' }) : ok({ model: request.model, content: typeof payload === 'string' ? payload : JSON.stringify(payload), reasoning: 'Private test reasoning is never stored', toolCalls: [], finishReason: 'stop', latencyMs: 1, usage: { promptTokens: 1, completionTokens: 1 }, ...response }); } };
  return { requests, model, text, orchestrator: createOrchestrator({ provider, config: resolveModelConfig({ tier4: options.textFallback ? `${model},${text}` : model }), matrix: createCapabilityMatrix({ [model]: capabilities, [text]: { ...capabilities, vision: false } }), health: createHealthRegistry(), now: () => new Date('2026-11-03T08:00:00Z'), defaultTimeoutMs: 1000 }) };
}
