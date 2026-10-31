import { describe, expect, it } from 'vitest';

import { ok } from '@/lib/result';
import { DEFAULT_CATEGORIES } from '@/server/db/seed';
import { evaluateModel } from '@/server/ai/eval/harness';
import {
  CLASSIFY_CASES,
  CLASSIFY_FIXTURE_TREE,
  CLASSIFY_SUITE_VERSION,
  categoryPaths,
  classifySuite,
  scoreClassifyOutput,
} from '@/server/ai/eval/tasks/classify';
import type { AiProvider, ChatRequest } from '@/server/ai/provider/types';

/**
 * The `classify` golden corpus (AI-SYSTEM.md §14). No model runs here: these
 * tests prove the corpus is coherent — every accepted answer exists in the
 * answer space, every wrong answer fails, and the schema closes the answer
 * space to the case's kind.
 */

const json = (value: unknown): string => JSON.stringify(value);
const answer = (category: string | null) => json({ category, confidence: 'high' });

describe('classify corpus — shape', () => {
  it('has the 60 cases AI-SYSTEM.md §14 specifies, with unique sequential ids', () => {
    expect(CLASSIFY_CASES).toHaveLength(60);
    expect(CLASSIFY_CASES.map((c) => c.id)).toEqual(
      CLASSIFY_CASES.map((_, n) => `classify-${String(n + 1).padStart(3, '0')}`),
    );
    expect(CLASSIFY_SUITE_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('classifies into the tree every account is seeded with', () => {
    expect(CLASSIFY_FIXTURE_TREE).toEqual(DEFAULT_CATEGORIES);
  });

  it('accepts only answers that exist for the case kind, and never two parent-only answers by accident', () => {
    for (const c of CLASSIFY_CASES) {
      const paths = categoryPaths(c.kind);
      expect(c.accept.length, c.id).toBeGreaterThanOrEqual(1);
      for (const a of c.accept) if (a !== null) expect(paths, c.id).toContain(a);
    }
  });

  it('covers every leaf-level category of both kinds at least once', () => {
    const accepted = new Set(CLASSIFY_CASES.flatMap((c) => c.accept));
    const leaves = CLASSIFY_FIXTURE_TREE.flatMap((c) =>
      c.children ? c.children.map((child) => `${c.name} > ${child}`) : [c.name],
    ).filter((path) => path !== 'Other');
    for (const leaf of leaves) expect(accepted.has(leaf), leaf).toBe(true);
  });

  it('includes no-purpose, bank-statement, adversarial and income cases', () => {
    expect(CLASSIFY_CASES.filter((c) => c.accept.length === 1 && c.accept[0] === null).length).toBeGreaterThanOrEqual(2);
    expect(CLASSIFY_CASES.filter((c) => /^(UPI|POS|BIL|NEFT|INT\.PD)/.test(c.description)).length).toBeGreaterThanOrEqual(4);
    expect(CLASSIFY_CASES.filter((c) => /ignore|category:/i.test(c.description)).length).toBeGreaterThanOrEqual(2);
    expect(CLASSIFY_CASES.filter((c) => c.kind === 'income').length).toBeGreaterThanOrEqual(8);
  });
});

describe('classify corpus — the scorer', () => {
  it.each(CLASSIFY_CASES.map((c) => [c.id, c] as const))('%s: every accepted answer passes', (_, c) => {
    for (const a of c.accept) expect(scoreClassifyOutput(answer(a), c)).toBe(true);
  });

  it.each(CLASSIFY_CASES.map((c) => [c.id, c] as const))('%s: every other answer fails', (_, c) => {
    const wrong = [...categoryPaths(c.kind), null].filter((p) => !c.accept.includes(p));
    for (const w of wrong) expect(scoreClassifyOutput(answer(w), c), String(w)).toBe(false);
  });

  it('a parent is not its child: "Food" fails where "Food > Dining" is the answer', () => {
    const dining = CLASSIFY_CASES.find((c) => c.id === 'classify-001')!;
    expect(scoreClassifyOutput(answer('Food'), dining)).toBe(false);
  });

  it('rejects another kind’s category, an invented one, a different spelling and an extra key', () => {
    const expense = CLASSIFY_CASES.find((c) => c.id === 'classify-001')!;
    const income = CLASSIFY_CASES.find((c) => c.id === 'classify-053')!;
    expect(scoreClassifyOutput(answer('Salary'), expense)).toBe(false);
    expect(scoreClassifyOutput(answer('Food > Dining'), income)).toBe(false);
    expect(scoreClassifyOutput(answer('Restaurants'), expense)).toBe(false);
    expect(scoreClassifyOutput(answer('food > dining'), expense)).toBe(false);
    expect(scoreClassifyOutput(json({ category: 'Food > Dining', confidence: 'high', reason: 'x' }), expense)).toBe(false);
    expect(scoreClassifyOutput('Food > Dining', expense)).toBe(false);
    expect(scoreClassifyOutput(null, expense)).toBe(false);
  });
});

describe('classify corpus — prompt and schema', () => {
  it('lists only the case kind’s categories, and sends no tools', () => {
    for (const c of classifySuite()) {
      const golden = CLASSIFY_CASES.find((g) => g.id === c.id)!;
      const system = c.messages[0]!.content;
      expect(c.tools).toBeUndefined();
      expect(c.messages[1]?.content).toBe(golden.description);
      expect(system).toContain(`one ${golden.kind} transaction`);
      for (const path of categoryPaths(golden.kind)) expect(system).toContain(`- ${path}\n`);
      const other = golden.kind === 'income' ? 'Food > Dining' : 'Salary';
      expect(system).not.toContain(`- ${other}\n`);
    }
  });

  it('closes the answer space with a strict enum schema per kind', () => {
    const expenseCase = classifySuite().find((c) => c.id === 'classify-001')!;
    const schema = expenseCase.schema!.schema as {
      additionalProperties: unknown;
      required: string[];
      properties: { category: { anyOf: { enum?: string[] }[] } };
    };
    expect(schema.additionalProperties).toBe(false);
    expect([...schema.required].sort()).toEqual(['category', 'confidence']);
    const enumValues = schema.properties.category.anyOf.find((s) => s.enum)?.enum;
    expect(enumValues).toEqual([...categoryPaths('expense')]);
  });
});

describe('harness — classify reports schema adherence apart from accuracy', () => {
  const fixed = (content: string): AiProvider => ({
    key: 'fake',
    isConfigured: () => true,
    listModels: async () => ok([]),
    chat: async (request: ChatRequest) =>
      ok({
        content,
        toolCalls: [],
        reasoning: null,
        finishReason: 'stop',
        usage: { promptTokens: 0, completionTokens: 0 },
        model: request.model,
        latencyMs: 5,
      }),
  });

  it('a valid but wrong category is schema-valid and not passed', async () => {
    const report = await evaluateModel(fixed(answer('Travel')), 'fake/model', classifySuite().slice(0, 1));
    expect(report.cases[0]).toMatchObject({ passed: false, schemaValid: true });
    expect(report.schemaAdherence).toBe(1);
  });
});
