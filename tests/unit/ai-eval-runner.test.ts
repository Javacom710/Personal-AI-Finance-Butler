import { describe, expect, it } from 'vitest';

import { ok, err } from '@/lib/result';
import { resolveModelConfig } from '@/server/ai/config/models';
import { transport } from '@/server/ai/errors';
import {
  MODEL_SUITES,
  TIER_SUITES,
  disqualification,
  modelsFor,
  parseEvalArgs,
  proposeOrder,
  renderEvalReport,
  runEvaluation,
  type EvalArgs,
  type ModelResult,
} from '@/server/ai/eval/runner';
import type { AiProvider, ChatRequest } from '@/server/ai/provider/types';

/**
 * The `ai:eval` runner. No network: a fake provider stands in, so these tests
 * prove what the runner measures, what it proposes, and what it refuses to
 * propose — not how any real model performs.
 */

const result = (over: Partial<ModelResult> & { modelId: string }): ModelResult => ({
  suites: [],
  schemaAdherence: 1,
  toolCallCorrectness: 1,
  retrievalGrounding: 1,
  injectionResistance: 1,
  p50LatencyMs: 100,
  p95LatencyMs: 200,
  unreachable: false,
  unanswered: 0,
  ...over,
});

function provider(reply: (request: ChatRequest) => ReturnType<AiProvider['chat']>): AiProvider {
  return { key: 'fake', isConfigured: () => true, listModels: async () => ok([]), chat: reply } as AiProvider;
}

const answer = (content: string | null) =>
  Promise.resolve(
    ok({
      content,
      toolCalls: [],
      reasoning: null,
      finishReason: 'stop' as const,
      usage: { promptTokens: 0, completionTokens: 0 },
      model: 'fake',
      latencyMs: 7,
    }),
  );

describe('ai:eval arguments', () => {
  it('defaults the suites to the tier, and rejects what it cannot measure', () => {
    expect(parseEvalArgs(['--tier', '1'])).toEqual({
      ok: true,
      value: { tier: 1, suites: TIER_SUITES[1], models: [], limit: null, record: true },
    });
    expect(parseEvalArgs(['--tier', '2', '--suite', 'grounding,injection', '--model', 'a/b, c/d', '--limit', '3'])).toEqual({
      ok: true,
      value: { tier: 2, suites: ['grounding', 'injection'], models: ['a/b', 'c/d'], limit: 3, record: false },
    });
    expect(parseEvalArgs(['--tier', '1', '--no-record'])).toMatchObject({ ok: true, value: { record: false } });
    expect(parseEvalArgs([]).ok).toBe(false);
    expect(parseEvalArgs(['--tier', '5']).ok).toBe(false);
    expect(parseEvalArgs(['--tier', '1', '--suite', 'routing']).ok).toBe(false);
    expect(parseEvalArgs(['--tier', '1', '--limit', '0']).ok).toBe(false);
    expect(parseEvalArgs(['--tier', '4'])).toMatchObject({ ok: true, value: { suites: ['document'] } });
    expect(TIER_SUITES[2]).toContain('analysis');
    expect(TIER_SUITES[3]).toContain('analysis');
  });

  it('every model suite builds its cases, and the routing suite is not among them', () => {
    for (const [name, suite] of Object.entries(MODEL_SUITES)) {
      expect(suite.build().length, name).toBeGreaterThan(0);
      expect(suite.version, name).toBeGreaterThanOrEqual(1);
    }
    expect(Object.keys(MODEL_SUITES)).not.toContain('routing');
  });

  it('measures the configured order and the tier\'s evaluation candidates, or exactly the models named', () => {
    const config = resolveModelConfig({ tier2: 'x/one,x/two' });
    const models = modelsFor(2, config);
    expect(models.slice(0, 2)).toEqual(['x/one', 'x/two']);
    expect(models).toContain('deepseek-ai/deepseek-v4.1-flash');
    expect(new Set(models).size).toBe(models.length);
    expect(modelsFor(2, config, ['only/this'])).toEqual(['only/this']);
  });
});

describe('ai:eval proposals', () => {
  it('gates vision proposals by schema rather than tool calling', () => {
    expect(disqualification(result({ modelId: 'vision', toolCallCorrectness: null }), 4)).toBeNull();
    expect(disqualification(result({ modelId: 'vision', schemaAdherence: 0.94, toolCallCorrectness: null }), 4)).toMatch(/schema adherence/);
    expect(disqualification(result({ modelId: 'vision', schemaAdherence: null }), 4)).toMatch(/not measured/);
  });
  it('Tier 1 needs schema adherence ≥ 0.95; every tool tier needs tool-call correctness ≥ 0.90', () => {
    expect(disqualification(result({ modelId: 'a', schemaAdherence: 0.94 }), 1)).toMatch(/schema adherence 0.94/);
    expect(disqualification(result({ modelId: 'a', schemaAdherence: 0.94 }), 2)).toBeNull();
    expect(disqualification(result({ modelId: 'a', toolCallCorrectness: 0.89 }), 2)).toMatch(/tool-call correctness/);
    expect(disqualification(result({ modelId: 'a', schemaAdherence: null }), 1)).toMatch(/not measured/);
    expect(disqualification(result({ modelId: 'a', unreachable: true }), 2)).toMatch(/unreachable/);
  });

  it('a model with unanswered cases is not proposed until re-run', () => {
    expect(disqualification(result({ modelId: 'a', unanswered: 1 }), 2)).toMatch(/unanswered/);
  });

  it('ranks qualifying models by schema, tool calls, grounding, injection, then latency', () => {
    const { order, excluded } = proposeOrder(
      [
        result({ modelId: 'slow', p50LatencyMs: 900 }),
        result({ modelId: 'fast', p50LatencyMs: 100 }),
        result({ modelId: 'ungrounded', retrievalGrounding: 0.6 }),
        result({ modelId: 'failing', toolCallCorrectness: 0.5 }),
      ],
      2,
    );
    expect(order).toEqual(['fast', 'slow', 'ungrounded']);
    expect(excluded.map((e) => e.modelId)).toEqual(['failing']);
  });
});

describe('ai:eval run', () => {
  it('passes document images and schema through the runner without tools', async () => {
    const run = await runEvaluation({
      provider: provider((request) => {
        expect(request.messages[1]?.images?.[0]?.mimeType).toBe('image/png');
        expect(request.responseFormat?.type).toBe('json_schema');
        expect(request.tools).toBeUndefined();
        return answer('{}');
      }),
      args: { tier: 4, suites: ['document'], models: [], limit: 1, record: false },
      models: ['fake/vision'],
    });
    expect(run.models[0]).toMatchObject({ schemaAdherence: 0, toolCallCorrectness: null });
    expect(run.proposedOrder).toEqual([]);
  });

  const args = (over: Partial<EvalArgs> = {}): EvalArgs => ({ tier: 2, suites: ['grounding'], models: [], limit: 2, record: false, ...over });

  it('runs each model over the first n cases of each suite and reports the pass counts', async () => {
    const run = await runEvaluation({
      provider: provider(() => answer('I could not find that.')),
      args: args(),
      models: ['m/one'],
      now: () => new Date('2026-11-01T00:00:00Z'),
    });
    expect(run.models[0]!.suites[0]).toMatchObject({ suite: 'grounding', total: 2, passed: 0 });
    expect(run.models[0]!.retrievalGrounding).toBe(0);
    expect(run.suiteVersions).toEqual({ grounding: MODEL_SUITES.grounding.version });
    const report = renderEvalReport(run);
    expect(report).toContain('Partial run: the first 2 case(s)');
    expect(report).toContain('No model qualifies');
  });

  it('a model every case of which errored is unreachable, not a model that scored zero', async () => {
    const run = await runEvaluation({
      provider: provider(() => Promise.resolve(err(transport('offline')))),
      args: args(),
      models: ['m/down'],
    });
    // Not a model that scored zero: there was nothing to score.
    expect(run.models[0]).toMatchObject({ unreachable: true, unanswered: 2, schemaAdherence: null, retrievalGrounding: null });
    expect(run.excluded[0]!.reason).toMatch(/unreachable/);
    expect(renderEvalReport(run)).toContain('m/down (unreachable)');
    expect(renderEvalReport(run)).toContain('transport ×2');
  });

  it('proposes nothing it did not measure, and prints an unmeasured score as "not measured"', async () => {
    const run = await runEvaluation({ provider: provider(() => answer('x')), args: args(), models: ['m/one'] });
    const report = renderEvalReport(run);
    expect(report).toContain('not measured');
    expect(report).toContain('this run changed no configuration');
  });
});
