import { describe, expect, it } from 'vitest';

import { ok } from '@/lib/result';
import { evaluateModel } from '@/server/ai/eval/harness';
import { canonicalDecimal, canonicalHint } from '@/server/ai/eval/score';
import {
  PARSE_CASES,
  PARSE_SUITE_VERSION,
  parseSuite,
  scoreParseOutput,
  type ParseExpectation,
} from '@/server/ai/eval/tasks/parse';
import { parseTransactionSystemPrompt } from '@/server/ai/prompts/parse-transaction';
import type { TransactionProposal } from '@/server/ai/proposals/schemas';
import type { AiProvider, ChatRequest } from '@/server/ai/provider/types';

/**
 * The `parse` golden corpus (AI-SYSTEM.md §14). These tests run no model: they
 * prove the corpus is internally coherent — every expectation is satisfiable,
 * every scored field is actually checked, and the harness reports schema
 * adherence separately from field accuracy. A corpus whose expectations no
 * answer could meet, or whose scorer passed anything, would measure nothing.
 */

const first = <T>(value: T | readonly T[]): T => (Array.isArray(value) ? (value as readonly T[])[0]! : (value as T));

const hint = (expected: ParseExpectation['account']): string | null =>
  expected === null ? null : expected === 'unscored' ? 'whatever the model chose' : expected[0]!;

/** The answer a perfect model would give for this expectation. */
function idealProposal(expected: ParseExpectation): TransactionProposal {
  const amount = expected.amount === null ? null : first(expected.amount);
  return {
    kind: first(expected.kind),
    bookedOn: expected.bookedOn,
    description: 'as stated',
    amount,
    currency: first(expected.currency),
    accountHint: hint(expected.account),
    toAccountHint: hint(expected.toAccount),
    categoryHint: hint(expected.category),
    tags: [],
    notes: null,
    confidence: expected.flagged ? 'low' : 'high',
    ambiguities: expected.flagged ? ['the input is ambiguous'] : [],
  };
}

const json = (value: unknown): string => JSON.stringify(value);

describe('parse corpus — shape', () => {
  it('has the 40 cases AI-SYSTEM.md §14 specifies, with unique sequential ids', () => {
    expect(PARSE_CASES).toHaveLength(40);
    expect(PARSE_CASES.map((c) => c.id)).toEqual(
      PARSE_CASES.map((_, i) => `parse-${String(i + 1).padStart(3, '0')}`),
    );
    expect(PARSE_SUITE_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('covers every category the suite promises', () => {
    const kinds = (k: string) => PARSE_CASES.filter((c) => first(c.expected.kind) === k && !c.expected.flagged);
    expect(kinds('expense').length).toBeGreaterThanOrEqual(10);
    expect(kinds('income').length).toBeGreaterThanOrEqual(4);
    expect(kinds('transfer').length).toBeGreaterThanOrEqual(4);
    expect(PARSE_CASES.filter((c) => c.expected.flagged).length).toBeGreaterThanOrEqual(5);
    expect(PARSE_CASES.filter((c) => c.expected.amount === null).length).toBeGreaterThanOrEqual(2);
    expect(PARSE_CASES.filter((c) => first(c.expected.currency) !== 'INR').length).toBeGreaterThanOrEqual(5);
    expect(PARSE_CASES.filter((c) => c.today !== undefined).length).toBeGreaterThanOrEqual(3);
    // Adversarial cases: instructions or JSON embedded in the sentence.
    expect(PARSE_CASES.filter((c) => /ignore|"amount"|without asking/i.test(c.input)).length).toBeGreaterThanOrEqual(3);
  });

  it('never expects a future date, and every date is a real calendar date', () => {
    for (const c of PARSE_CASES) {
      const today = c.today ?? '2026-08-09';
      const booked = new Date(`${c.expected.bookedOn}T00:00:00Z`);
      expect(booked.toISOString().slice(0, 10), c.id).toBe(c.expected.bookedOn);
      expect(c.expected.bookedOn <= today, c.id).toBe(true);
    }
  });

  it('expects every amount as an exact decimal string', () => {
    for (const c of PARSE_CASES) {
      const amounts = c.expected.amount === null ? [] : Array.isArray(c.expected.amount) ? c.expected.amount : [c.expected.amount];
      for (const a of amounts) expect(canonicalDecimal(a as string), c.id).not.toBeNull();
    }
  });
});

describe('parse corpus — the scorer', () => {
  it.each(PARSE_CASES.map((c) => [c.id, c] as const))('%s: the ideal answer passes', (_, c) => {
    expect(scoreParseOutput(json(idealProposal(c.expected)), c.expected)).toBe(true);
  });

  it.each(PARSE_CASES.map((c) => [c.id, c] as const))('%s: a wrong figure or date fails', (_, c) => {
    const ideal = idealProposal(c.expected);
    expect(scoreParseOutput(json({ ...ideal, bookedOn: '2020-01-01' }), c.expected)).toBe(false);
    expect(scoreParseOutput(json({ ...ideal, currency: 'GBP' }), c.expected)).toBe(false);
    // An invented amount where none was stated is wrong; so is any other figure.
    expect(scoreParseOutput(json({ ...ideal, amount: c.expected.amount === null ? '1000' : '987654.3' }), c.expected)).toBe(false);
    if (!Array.isArray(c.expected.kind)) {
      const other = c.expected.kind === 'expense' ? 'income' : 'expense';
      expect(scoreParseOutput(json({ ...ideal, kind: other }), c.expected)).toBe(false);
    }
  });

  it('rejects an invented account where the input names none', () => {
    const c = PARSE_CASES.find((x) => x.id === 'parse-007')!;
    expect(scoreParseOutput(json({ ...idealProposal(c.expected), accountHint: 'HDFC savings' }), c.expected)).toBe(false);
  });

  it('fails a flagged case answered with high confidence or no stated doubt', () => {
    for (const c of PARSE_CASES.filter((x) => x.expected.flagged)) {
      const ideal = idealProposal(c.expected);
      expect(scoreParseOutput(json({ ...ideal, confidence: 'high' }), c.expected), c.id).toBe(false);
      expect(scoreParseOutput(json({ ...ideal, ambiguities: [] }), c.expected), c.id).toBe(false);
    }
  });

  it('rejects a JSON-number amount, an extra key, a missing key and non-JSON — the schema is strict', () => {
    const c = PARSE_CASES[0]!;
    const ideal = idealProposal(c.expected);
    expect(scoreParseOutput(json({ ...ideal, amount: 1250 }), c.expected)).toBe(false);
    expect(scoreParseOutput(json({ ...ideal, accountId: 'acc_1' }), c.expected)).toBe(false);
    const { notes: _notes, ...missing } = ideal;
    expect(scoreParseOutput(json(missing), c.expected)).toBe(false);
    expect(scoreParseOutput('Amount: ₹1,250', c.expected)).toBe(false);
    expect(scoreParseOutput(null, c.expected)).toBe(false);
  });

  it('tolerates representation, never value: trailing zeros, case, punctuation and a code fence', () => {
    const c = PARSE_CASES[0]!;
    const ideal = idealProposal(c.expected);
    expect(scoreParseOutput(json({ ...ideal, amount: '1250.00' }), c.expected)).toBe(true);
    expect(scoreParseOutput(json({ ...ideal, accountHint: 'My HDFC Credit-Card' }), c.expected)).toBe(true);
    expect(scoreParseOutput('```json\n' + json(ideal) + '\n```', c.expected)).toBe(true);
    expect(scoreParseOutput(json({ ...ideal, amount: '1205' }), c.expected)).toBe(false);
    expect(canonicalHint('The  HDFC savings!')).toBe('hdfc savings');
  });
});

describe('parse corpus — prompt and schema', () => {
  it('gives the model the date, its weekday and the base currency, and nothing else from the ledger', () => {
    const prompt = parseTransactionSystemPrompt({ today: '2026-08-09', baseCurrency: 'INR' });
    expect(prompt).toContain('Today is 2026-08-09 (Sunday)');
    expect(prompt).toContain('The base currency is INR');
    expect(parseTransactionSystemPrompt({ today: '2028-02-29', baseCurrency: 'INR' })).toContain('(Tuesday)');
  });

  it('sends the strict production schema with every case, and no tools', () => {
    const cases = parseSuite();
    expect(cases).toHaveLength(40);
    for (const c of cases) {
      expect(c.tools).toBeUndefined();
      expect(c.messages[0]?.role).toBe('system');
      expect(c.messages[1]?.role).toBe('user');
    }
    const schema = cases[0]!.schema!.schema as { additionalProperties: unknown; required: string[] };
    expect(schema.additionalProperties).toBe(false);
    expect([...schema.required].sort()).toEqual(
      ['accountHint', 'ambiguities', 'amount', 'bookedOn', 'categoryHint', 'confidence', 'currency', 'description', 'kind', 'notes', 'tags', 'toAccountHint'],
    );
  });

  it('uses the case date when one is given', () => {
    const leap = parseSuite().find((c) => c.id === 'parse-028')!;
    expect(leap.messages[0]?.content).toContain('Today is 2028-03-01 (Wednesday)');
  });
});

describe('harness — schema adherence is measured apart from accuracy', () => {
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

  it('a well-formed answer with the wrong date counts as schema-valid but not passed', async () => {
    const c = PARSE_CASES[0]!;
    const wrongDate = json({ ...idealProposal(c.expected), bookedOn: '2026-08-07' });
    const report = await evaluateModel(fixed(wrongDate), 'fake/model', parseSuite().slice(0, 1));
    expect(report.cases[0]).toMatchObject({ passed: false, schemaValid: true, toolCallValid: null, errorClass: null });
    expect(report.schemaAdherence).toBe(1);
  });

  it('prose instead of JSON counts against schema adherence', async () => {
    const report = await evaluateModel(fixed('It was ₹1,250 for dinner.'), 'fake/model', parseSuite().slice(0, 2));
    expect(report.schemaAdherence).toBe(0);
    expect(report.cases.every((r) => r.passed === false)).toBe(true);
  });
});
