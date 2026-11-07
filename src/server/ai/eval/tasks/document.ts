import 'server-only';

/**
 * The `document` golden suite (AI-SYSTEM.md §10, §14): synthetic receipt and
 * bank-statement images to proposed transactions. The image bytes are checked
 * into `document-fixtures.json`; no OCR service, database, upload or model runs
 * while constructing the suite. `scripts/generate-ai-eval-document-fixtures.mjs`
 * regenerates the fixtures with ImageMagick.
 *
 * Scoring is exact and deterministic: strict proposal schema, exact transaction
 * count/order/kind/date/currency/description, and amount equality at the stored
 * decimal scale. Missing dates and amounts must remain null, with an explicit
 * ambiguity that sends the proposal to review. Totals, subtotals and tax labels
 * are never treated as extra transactions.
 */

import { isoDate } from '@/lib/date';
import fixtures from './document-fixtures.json';
import { analyzeDocumentMessages, type DocumentContext } from '../../prompts/analyze-document';
import { DocumentExtractionProposal } from '../../proposals/schemas';
import type { ChatImage } from '../../provider/types';
import { toJsonSchema, validateAgainst } from '../../structured/validate';
import type { EvalCase } from '../harness';
import { sameDecimal } from '../score';

export const DOCUMENT_SUITE_VERSION = 2;
export const DOCUMENT_TODAY = isoDate('2026-10-15');
export const DOCUMENT_BASE_CURRENCY = 'INR';

export interface DocumentExpectedTransaction {
  readonly kind: 'expense' | 'income' | 'transfer';
  readonly bookedOn: string | null;
  readonly description: string;
  readonly amount: string | null;
  readonly currency: string;
  readonly accountHint?: string | null;
  readonly toAccountHint?: string | null;
  readonly categoryHint?: null;
}

export interface DocumentGoldenCase {
  readonly id: string;
  readonly question: string;
  readonly expected: readonly DocumentExpectedTransaction[];
  readonly mimeType: 'image/png';
  readonly imageBase64: string;
  readonly attack?: string | null;
}

export const DOCUMENT_CASES = fixtures as readonly DocumentGoldenCase[];

export function scoreDocumentOutput(output: string | null, golden: DocumentGoldenCase): boolean {
  if (output === null) return false;
  const validation = validateAgainst(DocumentExtractionProposal, output);
  if (validation.status !== 'valid') return false;
  const actual = validation.value.transactions;
  if (actual.length !== golden.expected.length) return false;

  return actual.every((transaction, index) => {
    const expected = golden.expected[index];
    if (!expected) return false;
    if (transaction.kind !== expected.kind || transaction.bookedOn !== expected.bookedOn) return false;
    if (transaction.currency !== expected.currency || transaction.description.trim() !== expected.description) return false;
    if (expected.amount === null ? transaction.amount !== null : transaction.amount === null || !sameDecimal(transaction.amount, expected.amount)) return false;
    if (transaction.accountHint !== (expected.accountHint ?? null)) return false;
    if (transaction.toAccountHint !== (expected.toAccountHint ?? null)) return false;
    if (transaction.categoryHint !== (expected.categoryHint ?? null)) return false;
    if (transaction.tags.length !== 0 || transaction.notes !== null) return false;
    if (expected.bookedOn === null || expected.amount === null) return transaction.confidence !== 'high' && transaction.ambiguities.length > 0;
    if (transaction.ambiguities.length !== 0) return false;
    return true;
  });
}

function imageFor(golden: DocumentGoldenCase): ChatImage {
  return { mimeType: golden.mimeType, data: golden.imageBase64 };
}

function documentContext(): DocumentContext {
  return { today: DOCUMENT_TODAY, baseCurrency: DOCUMENT_BASE_CURRENCY };
}

export function documentSuite(): readonly EvalCase[] {
  const context = documentContext();
  const schema = toJsonSchema(DocumentExtractionProposal, 'document_extraction');
  return DOCUMENT_CASES.map((golden) => ({
    id: golden.id,
    suite: 'document' as const,
    messages: analyzeDocumentMessages(context, golden.question, [imageFor(golden)]),
    schema: { name: 'document_extraction', schema },
    score: (output) => scoreDocumentOutput(output, golden),
    checkSchema: (output) => output !== null && validateAgainst(DocumentExtractionProposal, output).status === 'valid',
  }));
}

export { DocumentExtractionProposal };
