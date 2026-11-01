import { describe, expect, it } from 'vitest';

import { ok, err } from '@/lib/result';
import { DECLARED_CAPABILITIES, type ModelCapabilities } from '@/server/ai/config/capabilities';
import { resolveModelConfig } from '@/server/ai/config/models';
import { transport } from '@/server/ai/errors';
import {
  MODEL_SUITES,
  TIER_SUITES,
  disqualification,
  modelsFor,
  parseEvalArgs,
  partialRunReason,
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

/** A capability entry that serves every requirement, for ranking tests over fake ids. */
const FULL: ModelCapabilities = {
  tier: 1,
  toolCalling: 'native',
  structuredOutput: 'json_schema',
  vision: true,
  embedding: false,
  contextTokens: 131_072,
  maxOutputTokens: 8_192,
  streaming: true,
  source: 'declared',
};

const result = (over: Partial<ModelResult> & { modelId: string }): ModelResult => ({
  suites: [],
  schemaAdherence: 1,
  toolCallCorrectness: 1,
  retrievalGrounding: 1,
  analysisAccuracy: 1,
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
    expect(parseEvalArgs(['--tier', '4', '--suite', 'tool-select'])).toMatchObject({ ok: false, error: expect.stringMatching(/Not a Tier 4 suite/) });
    expect(parseEvalArgs(['--tier', '2', '--suite', 'document'])).toMatchObject({ ok: false, error: expect.stringMatching(/Not a Tier 2 suite: document/) });
    // A suite from another tier cannot stand in for this tier's measurement.
    expect(parseEvalArgs(['--tier', '2', '--suite', 'parse'])).toMatchObject({ ok: false, error: expect.stringMatching(/Not a Tier 2 suite: parse/) });
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

  it('ranks qualifying models by schema, tool calls, grounding, analysis, injection, then latency', () => {
    const { order, excluded } = proposeOrder(
      [
        result({ modelId: 'slow', p50LatencyMs: 900 }),
        result({ modelId: 'fast', p50LatencyMs: 100 }),
        result({ modelId: 'ungrounded', retrievalGrounding: 0.6 }),
        result({ modelId: 'failing', toolCallCorrectness: 0.5 }),
      ],
      2,
      () => FULL,
    );
    expect(order).toEqual(['fast', 'slow', 'ungrounded']);
    expect(excluded.map((e) => e.modelId)).toEqual(['failing']);
  });

  it('a model that gets the analysis figures wrong ranks below one that gets them right, before latency', () => {
    const { order } = proposeOrder(
      [
        result({ modelId: 'fast-wrong', analysisAccuracy: 0, p50LatencyMs: 100 }),
        result({ modelId: 'slow-right', analysisAccuracy: 1, p50LatencyMs: 900 }),
        result({ modelId: 'injectable-right', analysisAccuracy: 1, injectionResistance: 0.5, p50LatencyMs: 100 }),
      ],
      2,
      () => FULL,
    );
    expect(order).toEqual(['slow-right', 'injectable-right', 'fast-wrong']);
  });

  it('never proposes a Tier 4 model whose declared output mode selection would refuse for every document capability', () => {
    // The configured Tier 4 model declares json_object; extractReceiptData and analyzeDocument need json_schema.
    const omni = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning';
    const vision = result({ modelId: omni, toolCallCorrectness: null });
    const { order, excluded } = proposeOrder([vision], 4);
    expect(order).toEqual([]);
    expect(excluded[0]!.reason).toMatch(/serve no Tier 4 capability.*extractReceiptData: structured_output_unsupported/);
    // With verified json_schema support declared, the same scores are proposed.
    const verified = { ...DECLARED_CAPABILITIES[omni]!, structuredOutput: 'json_schema' as const };
    expect(proposeOrder([vision], 4, () => verified).order).toEqual([omni]);
  });

  it('proposes a model that serves some of its tier with a caveat naming what routing refuses it', () => {
    // gpt-oss-20b declares json_object: it serves Tier 1's tool capabilities, not parse or classify.
    const { order, caveats } = proposeOrder([result({ modelId: 'openai/gpt-oss-20b' })], 1);
    expect(order).toEqual(['openai/gpt-oss-20b']);
    expect(caveats).toEqual([
      {
        modelId: 'openai/gpt-oss-20b',
        unserved: [
          { capability: 'parseTransaction', reason: 'structured_output_unsupported' },
          { capability: 'classifyTransaction', reason: 'structured_output_unsupported' },
        ],
      },
    ]);
  });

  it('never proposes a model with no declared capability entry, so a proposal cannot fail startup', () => {
    const candidate = 'nvidia/nemotron-3.5-lightning-30b-a3b'; // an EVALUATION_CANDIDATE, not declared
    const known = 'nvidia/nemotron-3-nano-30b-a3b';
    const { order, excluded } = proposeOrder([result({ modelId: candidate }), result({ modelId: known })], 1);
    expect(order).toEqual([known]);
    expect(excluded).toEqual([{ modelId: candidate, reason: expect.stringMatching(/no declared capability entry/) }]);
    // A score failure is still the reason given when there is one.
    expect(proposeOrder([result({ modelId: candidate, schemaAdherence: 0.5 })], 1).excluded[0]!.reason).toMatch(/schema adherence/);
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
    expect(report).toContain('Nothing is proposed');
  });

  it('a wire check or a subset of the tier\'s suites proposes nothing, however well models score', async () => {
    const perfect = provider(() => answer('irrelevant'));
    // Every model would qualify if proposals ran: force a perfect result through the ranking path.
    expect(partialRunReason(args({ limit: 1 }))).toMatch(/wire check/);
    expect(partialRunReason(args({ limit: null, suites: ['grounding'] }))).toMatch(/missing: tool-select, robustness, injection/);
    expect(partialRunReason(args({ limit: null, suites: TIER_SUITES[2] }))).toBeNull();
    const run = await runEvaluation({ provider: perfect, args: args({ limit: 1 }), models: ['m/one', 'm/two'] });
    expect(run.proposedOrder).toEqual([]);
    expect(run.excluded.map((e) => e.modelId)).toEqual(['m/one', 'm/two']);
    expect(renderEvalReport(run)).toContain('partial run (--limit 1)');
  });

  it('a model every case of which errored is unreachable, not a model that scored zero', async () => {
    // A full-tier run, so the proposal step runs and must exclude it for being unreachable.
    const run = await runEvaluation({
      provider: provider(() => Promise.resolve(err(transport('offline')))),
      args: args({ limit: null, suites: TIER_SUITES[2] }),
      models: ['m/down'],
    });
    // Not a model that scored zero: there was nothing to score.
    expect(run.models[0]).toMatchObject({ unreachable: true, schemaAdherence: null, retrievalGrounding: null });
    expect(run.models[0]!.unanswered).toBeGreaterThan(0);
    expect(run.excluded[0]!.reason).toMatch(/unreachable/);
    expect(renderEvalReport(run)).toContain('m/down (unreachable)');
    expect(renderEvalReport(run)).toMatch(/transport ×\d+/);
  });

  it('proposes nothing it did not measure, and prints an unmeasured score as "not measured"', async () => {
    const run = await runEvaluation({ provider: provider(() => answer('x')), args: args(), models: ['m/one'] });
    const report = renderEvalReport(run);
    expect(report).toContain('not measured');
    expect(report).toContain('this run changed no configuration');
  });
});
