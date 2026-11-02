import { describe, expect, it } from 'vitest';
import { err, ok } from '@/lib/result';
import { transport } from '@/server/ai/errors';
import { evaluateModel } from '@/server/ai/eval/harness';
import { renderEvalReport, runEvaluation } from '@/server/ai/eval/runner';
import { parseSuite } from '@/server/ai/eval/tasks/parse';
import type { AiProvider, FinishReason } from '@/server/ai/provider/types';

function provider(reasons: (FinishReason | null)[]): AiProvider {
  return {
    key: 'offline-diagnostics', isConfigured: () => true, listModels: async () => ok([]),
    chat: async (request) => {
      const reason = reasons.shift();
      if (reason === undefined) throw new Error('Unexpected provider call');
      if (reason === null) return err(transport('offline'));
      return ok({ content: null, toolCalls: [], reasoning: 'RAW_REASONING_NOT_FOR_REPORTS',
        finishReason: reason, usage: { promptTokens: 0, completionTokens: 0 }, model: request.model, latencyMs: 1 });
    },
  };
}

describe('evaluation completion diagnostics', () => {
  it.each<FinishReason>(['stop', 'length', 'tool_calls', 'content_filter', 'error'])('preserves the provider completion reason %s', async (reason) => {
    const report = await evaluateModel(provider([reason]), 'fake/model', parseSuite().slice(0, 1));
    expect(report.cases[0]?.finishReason).toBe(reason);
  });

  it('counts truncation independently from transport failures without persisting raw output', async () => {
    const run = await runEvaluation({ provider: provider(['length', null]), models: ['fake/model'],
      args: { tier: 1, suites: ['parse'], models: [], limit: 2, record: false },
    });
    const suite = run.models[0]!.suites[0]!;
    expect(suite.finishReasons).toEqual({ length: 1 });
    expect(suite.errors).toEqual({ transport: 1 });
    expect(suite.report.cases.map((c) => c.finishReason)).toEqual(['length', null]);
    expect(run.models[0]).toMatchObject({ schemaAdherence: 0, unanswered: 1 });
    expect(renderEvalReport(run)).toContain('parse: length ×1');
    expect(JSON.stringify(run)).not.toContain('RAW_REASONING_NOT_FOR_REPORTS');
  });
});
