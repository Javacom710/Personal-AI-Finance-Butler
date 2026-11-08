import { describe, expect, it } from 'vitest';
import { ok } from '@/lib/result';
import { renderEvalReport, runEvaluation, type ModelSuite } from '@/server/ai/eval/runner';
import type { Tier } from '@/server/ai/config/models';
import type { AiProvider, ChatRequest } from '@/server/ai/provider/types';

describe('evaluation requests match production output budgets', () => {
  it.each<[Tier, ModelSuite, number]>([
    [1, 'parse', 1024], [1, 'classify', 512], [1, 'tool-select', 2048],
    [2, 'grounding', 4096], [2, 'analysis', 4096],
    [3, 'tool-select', 8192], [3, 'analysis', 8192], [4, 'document', 2048],
  ])('Tier %s %s sends and records %s output tokens', async (tier, suite, expected) => {
    const requests: ChatRequest[] = [];
    const provider: AiProvider = {
      key: 'offline-budget-test', isConfigured: () => true, listModels: async () => ok([]),
      chat: async (request) => {
        requests.push(request);
        return ok({ content: null, toolCalls: [], reasoning: null, finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0 }, model: request.model, latencyMs: 1 });
      },
    };
    const run = await runEvaluation({ provider, models: ['fake/model'], timeoutMs: 9000,
      args: { tier, suites: [suite], models: [], limit: 1, record: false },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ maxTokens: expected, timeoutMs: 9000 });
    expect(run.suiteVersions[suite]).toBe(suite === 'document' ? 2 : ['grounding', 'analysis', 'robustness'].includes(suite) ? 5 : ['parse', 'tool-select'].includes(suite) ? 3 : 2);
    expect(run.models[0]?.suites[0]?.maxTokens).toBe(expected);
    expect(run.requestTimeoutMs).toBe(9000);
    expect(renderEvalReport(run)).toContain(`Output-token budgets: ${suite}: ${expected}`);
  });
});
