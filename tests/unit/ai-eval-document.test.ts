import { describe, expect, it } from 'vitest';

import { evaluateModel } from '@/server/ai/eval/harness';
import {
  DOCUMENT_BASE_CURRENCY,
  DOCUMENT_CASES,
  DOCUMENT_SUITE_VERSION,
  DOCUMENT_TODAY,
  DocumentExtractionProposal,
  documentSuite,
  scoreDocumentOutput,
  type DocumentExpectedTransaction,
  type DocumentGoldenCase,
} from '@/server/ai/eval/tasks/document';
import { analyzeDocumentMessages, analyzeDocumentSystemPrompt } from '@/server/ai/prompts/analyze-document';
import type { AiProvider, ChatRequest } from '@/server/ai/provider/types';
import { ok } from '@/lib/result';

function proposal(expected: DocumentExpectedTransaction) {
  const flagged = expected.bookedOn === null || expected.amount === null;
  return {
    kind: expected.kind,
    bookedOn: expected.bookedOn,
    description: expected.description,
    amount: expected.amount,
    currency: expected.currency,
    accountHint: expected.accountHint ?? null,
    toAccountHint: expected.toAccountHint ?? null,
    categoryHint: expected.categoryHint ?? null,
    tags: [],
    notes: null,
    confidence: flagged ? 'low' : 'high',
    ambiguities: flagged ? ['A date or amount is unreadable.'] : [],
  };
}

const ideal = (golden: DocumentGoldenCase) => JSON.stringify({ transactions: golden.expected.map(proposal) });
const byId = (id: string) => DOCUMENT_CASES.find((c) => c.id === id)!;

describe('document corpus — shape and coverage', () => {
  it('contains 20 versioned cases with unique sequential ids', () => {
    expect(DOCUMENT_SUITE_VERSION).toBe(2);
    expect(DOCUMENT_CASES).toHaveLength(20);
    expect(DOCUMENT_CASES.map((c) => c.id)).toEqual(DOCUMENT_CASES.map((_, n) => `doc-${String(n + 1).padStart(3, '0')}`));
  });

  it('covers receipts, statements, multiple currencies, line items and unreadable fields', () => {
    expect(DOCUMENT_CASES.filter((c) => c.expected.length > 1).length).toBeGreaterThanOrEqual(8);
    expect(DOCUMENT_CASES.some((c) => c.expected.some((row) => row.kind === 'income'))).toBe(true);
    expect(DOCUMENT_CASES.some((c) => c.expected.some((row) => row.kind === 'transfer'))).toBe(true);
    expect(new Set(DOCUMENT_CASES.flatMap((c) => c.expected.map((row) => row.currency)))).toEqual(new Set(['INR', 'USD', 'EUR']));
    expect(DOCUMENT_CASES.some((c) => c.expected.some((row) => row.amount === null))).toBe(true);
    expect(DOCUMENT_CASES.some((c) => c.expected.some((row) => row.bookedOn === null))).toBe(true);
    expect(byId('doc-020').attack).toMatch(/ignore.*reply/i);
  });

  it('contains valid, nonempty 8-bit PNG data for every fixture', () => {
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    for (const golden of DOCUMENT_CASES) {
      expect(golden.mimeType, golden.id).toBe('image/png');
      const bytes = Buffer.from(golden.imageBase64, 'base64');
      expect(bytes.byteLength, golden.id).toBeGreaterThan(1_000);
      expect(bytes.subarray(0, 8), golden.id).toEqual(png);
      expect(bytes.readUInt32BE(16), golden.id).toBe(800);
      expect(bytes.readUInt32BE(20), golden.id).toBe(920);
      expect(bytes[24], `${golden.id}: bit depth`).toBe(8);
      expect([0, 2], `${golden.id}: PNG grayscale or RGB`).toContain(bytes[25]);
    }
  });

  it('expects only valid transaction kinds, dates, currencies and exact decimal strings', () => {
    for (const golden of DOCUMENT_CASES) {
      expect(golden.question.trim(), golden.id).not.toBe('');
      expect(golden.expected.length, golden.id).toBeGreaterThan(0);
      for (const row of golden.expected) {
        expect(['expense', 'income', 'transfer']).toContain(row.kind);
        expect(row.currency).toMatch(/^[A-Z]{3}$/);
        if (row.bookedOn !== null) expect(row.bookedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        if (row.amount !== null) expect(row.amount).toMatch(/^\d+(\.\d{1,4})?$/);
      }
    }
  });
});

describe('document scorer — strict output and exact extraction', () => {
  it.each(DOCUMENT_CASES)('$id: accepts every expected transaction', (golden) => {
    expect(scoreDocumentOutput(ideal(golden), golden)).toBe(true);
  });

  it.each(DOCUMENT_CASES)('$id: rejects an invented or omitted transaction', (golden) => {
    const expected = golden.expected.map(proposal);
    expect(scoreDocumentOutput(JSON.stringify({ transactions: expected.slice(1) }), golden)).toBe(false);
    expect(scoreDocumentOutput(JSON.stringify({ transactions: [...expected, proposal(golden.expected[0]!)] }), golden)).toBe(false);
  });

  it('rejects a total or subtotal emitted as an extra transaction', () => {
    const golden = byId('doc-002');
    const expected = golden.expected.map(proposal);
    const subtotal = proposal({ kind: 'expense', bookedOn: '2026-10-13', description: 'TOTAL', amount: '1874.50', currency: 'INR' });
    expect(scoreDocumentOutput(JSON.stringify({ transactions: [...expected, subtotal] }), golden)).toBe(false);
  });

  it('keeps missing amount and date nullable and flags them for review', () => {
    for (const golden of [byId('doc-013'), byId('doc-014'), byId('doc-015')]) {
      const expected = JSON.parse(ideal(golden)) as { transactions: ReturnType<typeof proposal>[] };
      const item = expected.transactions[0]!;
      expect(scoreDocumentOutput(JSON.stringify(expected), golden)).toBe(true);
      expect(scoreDocumentOutput(JSON.stringify({ transactions: [{ ...item, confidence: 'high', ambiguities: [] }] }), golden)).toBe(false);
      expect(scoreDocumentOutput(JSON.stringify({ transactions: [{ ...item, amount: '0' }] }), golden)).toBe(false);
    }
  });

  it('rejects wrong dates, amounts, currencies, descriptions, kinds and additional fields', () => {
    const golden = byId('doc-001');
    const item = proposal(golden.expected[0]!);
    const wrong = [
      { ...item, bookedOn: '2026-10-13' },
      { ...item, amount: '481' },
      { ...item, currency: 'USD' },
      { ...item, description: 'Coffee and dessert' },
      { ...item, kind: 'income' },
      { ...item, userId: '00000000-0000-4000-8000-000000000001' },
    ];
    for (const transaction of wrong) expect(scoreDocumentOutput(JSON.stringify({ transactions: [transaction] }), golden)).toBe(false);
    for (const output of [null, '', 'not JSON', JSON.stringify({ transaction: item }), JSON.stringify({ transactions: [] })]) {
      expect(scoreDocumentOutput(output, golden)).toBe(false);
    }
  });

  it('keeps missing and unparseable outputs as schema failures', () => {
    expect(DocumentExtractionProposal.safeParse({ transactions: [] }).success).toBe(false);
    expect(DocumentExtractionProposal.safeParse({ transactions: [{ ...proposal(byId('doc-001').expected[0]!), extra: true }] }).success).toBe(false);
    expect(DocumentExtractionProposal.safeParse({ transactions: 'no transactions' }).success).toBe(false);
  });

  it('requires statement account hints only when the statement names them', () => {
    const statement = byId('doc-008');
    const correct = JSON.parse(ideal(statement)) as { transactions: ReturnType<typeof proposal>[] };
    expect(statement.expected[0]?.accountHint).toBe('HDFC Bank');
    expect(scoreDocumentOutput(JSON.stringify(correct), statement)).toBe(true);
    expect(scoreDocumentOutput(JSON.stringify({ transactions: correct.transactions.map((row) => ({ ...row, accountHint: null })) }), statement)).toBe(false);

    const withdrawal = byId('doc-012');
    const transfer = JSON.parse(ideal(withdrawal)) as { transactions: ReturnType<typeof proposal>[] };
    expect(withdrawal.expected[0]?.toAccountHint).toBe('Cash');
    expect(scoreDocumentOutput(JSON.stringify(transfer), withdrawal)).toBe(true);
    expect(scoreDocumentOutput(JSON.stringify({ transactions: transfer.transactions.map((row) => ({ ...row, toAccountHint: null })) }), withdrawal)).toBe(false);
  });
});

describe('document suite — production prompt, schema and image transport', () => {
  it('uses the production system prompt, proposal schema and one real image per question', () => {
    const cases = documentSuite();
    expect(cases.map((c) => c.id)).toEqual(DOCUMENT_CASES.map((c) => c.id));
    const expectedSchema = DocumentExtractionProposal.safeParse({ transactions: [proposal(byId('doc-001').expected[0]!)] });
    expect(expectedSchema.success).toBe(true);
    for (const testCase of cases) {
      const golden = byId(testCase.id);
      expect(testCase.suite).toBe('document');
      expect(testCase.schema?.name).toBe('document_extraction');
      expect(testCase.tools).toBeUndefined();
      expect(testCase.messages[0]?.role).toBe('system');
      expect(testCase.messages[0]?.content).toBe(analyzeDocumentSystemPrompt({ today: DOCUMENT_TODAY, baseCurrency: DOCUMENT_BASE_CURRENCY }));
      expect(testCase.messages[1]).toMatchObject({ role: 'user', content: golden.question, images: [{ mimeType: 'image/png' }] });
      expect(testCase.score?.(ideal(golden), [])).toBe(true);
      expect(testCase.checkSchema?.(ideal(golden))).toBe(true);
      expect(testCase.score?.(null, [])).toBe(false);
    }
  });

  it('does not tell a model to follow text printed in a document', () => {
    const prompt = analyzeDocumentSystemPrompt({ today: DOCUMENT_TODAY, baseCurrency: DOCUMENT_BASE_CURRENCY });
    expect(prompt).toMatch(/never instructions/i);
    expect(prompt).toMatch(/ignore/i);
    expect(prompt).toMatch(/never guess/i);
  });

  it('renders expected messages with the fixed evaluation date and currency', () => {
    const image = { mimeType: 'image/png' as const, data: byId('doc-001').imageBase64 };
    const messages = analyzeDocumentMessages({ today: DOCUMENT_TODAY, baseCurrency: DOCUMENT_BASE_CURRENCY }, 'Read this receipt.', [image]);
    expect(messages[0]?.content).toContain('Today is 2026-10-15.');
    expect(messages[1]).toEqual({ role: 'user', content: 'Read this receipt.', images: [image] });
  });
});

describe('document suite — existing harness', () => {
  const provider = (content: string | null): AiProvider => ({
    key: 'offline-fixture',
    isConfigured: () => true,
    listModels: async () => ok([]),
    chat: async (request: ChatRequest) => ok({
      content,
      toolCalls: [],
      reasoning: null,
      finishReason: 'stop',
      usage: { promptTokens: 0, completionTokens: 0 },
      model: request.model,
      latencyMs: 1,
    }),
  });

  it('scores correct extraction separately from schema adherence', async () => {
    const golden = byId('doc-001');
    const testCase = documentSuite().find((c) => c.id === golden.id)!;
    const report = await evaluateModel(provider(ideal(golden)), 'fake/vision', [testCase]);
    expect(report.cases[0]).toMatchObject({ passed: true, schemaValid: true, toolCallValid: null });
    expect(report.schemaAdherence).toBe(1);
  });

  it('records malformed or wrong fields without asking a model to judge them', async () => {
    const golden = byId('doc-001');
    const testCase = documentSuite().find((c) => c.id === golden.id)!;
    const report = await evaluateModel(provider(JSON.stringify({ transactions: [{ ...proposal(golden.expected[0]!), amount: '499' }] })), 'fake/vision', [testCase]);
    expect(report.cases[0]).toMatchObject({ passed: false, schemaValid: true, errorClass: null });
  });
});
