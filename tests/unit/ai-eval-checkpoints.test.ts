import { describe, expect, it } from 'vitest';
import { ok } from '@/lib/result';
import { evaluateModel, reportFromCases, type EvalCase } from '@/server/ai/eval/harness';
import { countsOf, summarise } from '@/server/ai/eval/runner';
import type { AiProvider } from '@/server/ai/provider/types';
import { requestReserve, resetMs } from '../../scripts/lib/ai-eval-budget';

describe('resumable measurement aggregation', () => {
  it('produces identical reports/counts from batch and per-case harness results', async () => {
    const cases: EvalCase[] = [
      { id: 'a', suite: 'parse', messages: [], schema: { name: 's', schema: {} }, score: () => false, checkSchema: () => true },
      { id: 'b', suite: 'tool-select', messages: [], tools: [], score: () => true, checkToolCalls: () => true },
      { id: 'c', suite: 'grounding', messages: [], score: () => false },
    ];
    const provider: AiProvider = { key: 'fake', isConfigured: () => true, listModels: async () => ok([]), chat: async () => ok({ model: 'test', content: '{}', reasoning: null, toolCalls: [], finishReason: 'stop', latencyMs: 12, usage: { promptTokens: 1, completionTokens: 1 } }) };
    const batch = await evaluateModel(provider, 'test', cases);
    const chunks = await Promise.all(cases.map(c => evaluateModel(provider, 'test', [c])));
    const resumed = reportFromCases('test', chunks.flatMap(c => c.cases));
    expect(resumed).toEqual(batch);
    expect(countsOf(resumed)).toEqual({ answered: 3, unanswered: 0, schemaValid: 1, schemaApplicable: 1, toolCallValid: 1, toolCallApplicable: 1 });
    expect(summarise('test', [])).toMatchObject({ schemaAdherence: null, toolCallCorrectness: null });
  });
});

describe('Groq quota reservations', () => {
  it('reserves decoded image tokens rather than base64 bytes, preserving text and output bounds', () => {
    const make = (data: string): EvalCase => ({ id: 'image', suite: 'document', messages: [{ role: 'user', content: 'Read this.', images: [{ mimeType: 'image/png', data }] }] });
    const short = requestReserve(make('a'), 2048);
    expect(requestReserve(make('a'.repeat(100_000)), 2048)).toBe(short);
    expect(short).toBeGreaterThan(2048 * 3);
    expect(requestReserve(make('a'), 4096) - short).toBe(2048);
    const text: EvalCase = { id: 'text', suite: 'parse', messages: [{ role: 'user', content: '₹'.repeat(1000) }] };
    expect(requestReserve(text, 1024)).toBeGreaterThan(3000 + 1024);
  });

  it('parses reset units and uses a bounded conservative fallback', () => {
    expect(resetMs('1.5s')).toBe(1500);
    expect(resetMs('7ms')).toBe(7);
    expect(resetMs('1m2s')).toBe(60_000);
    expect(resetMs('2h')).toBe(60_000);
    expect(resetMs(null)).toBe(60_000);
    expect(resetMs('unknown')).toBe(60_000);
  });
});
