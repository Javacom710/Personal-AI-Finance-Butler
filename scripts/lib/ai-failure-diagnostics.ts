/** Output-free explanations of existing scorers; never changes their verdicts. */
import { z } from 'zod';
import { ANALYSIS_CASES, bindingHolds, scoreAnalysisOutput } from '../../src/server/ai/eval/tasks/analysis';
import { scoreGroundingAnswer } from '../../src/server/ai/eval/tasks/grounding';
import { DOCUMENT_CASES, DocumentExtractionProposal, scoreDocumentOutput } from '../../src/server/ai/eval/tasks/document';
import { parseJsonSafely } from '../../src/server/ai/structured/validate';
import { normalizeNumericPresentation, sameDecimal } from '../../src/server/ai/eval/score';
import { hintMatches } from '../../src/server/ai/eval/score';
import { PARSE_CASES, scoreParseOutput } from '../../src/server/ai/eval/tasks/parse';
import { TransactionProposal } from '../../src/server/ai/proposals/schemas';
import { INJECTION_CASES, INJECTION_CANARY, scoreInjectionCalls, scoreInjectionResponse } from '../../src/server/ai/eval/tasks/injection';

export type FailureReason = 'empty_output' | 'unexpected_tool_calls' | 'untraceable_figures' | 'missing_figures' |
  'forbidden_figures' | 'missing_mentions' | 'contradictions' | 'missing_metric_bindings' | 'invalid_json' |
  'invalid_schema' | 'transaction_count' | 'transaction_fields' | 'scorer_rejected' |
  'attack_canary' | 'missing_required_call' | 'invalid_tool_calls';
export interface FailureDiagnostics {
  passed: boolean;
  reasons: FailureReason[];
  /** Only fixed keys and counts; no response fragments, field values or errors. */
  counts: Record<string, number>;
  /** Experimental comparison only; never replaces the authoritative verdict. */
  presentationComparison?: {
    groupedCommas: number;
    escapedPercents: number;
    normalizedPassed: boolean;
  };
  /** Hypothesis checks only: joining layout can change claim associations. */
  layoutComparison?: {
    lineBreaks: number;
    markdownSpans: number;
    whitespace: LayoutVerdict;
    inlineMarkdown: LayoutVerdict;
    combined: LayoutVerdict;
  };
}
interface LayoutVerdict { passed: boolean; missingMentions: number; missingMetricBindings: number; }

// Checkpoints may be resumed from disk. Reject unexpected keys and values before
// retaining diagnostic metadata: an arbitrary output fragment is never a count.
const count = z.number().int().nonnegative().safe();
const reason = z.enum(['empty_output', 'unexpected_tool_calls', 'untraceable_figures', 'missing_figures',
  'forbidden_figures', 'missing_mentions', 'contradictions', 'missing_metric_bindings', 'invalid_json',
  'invalid_schema', 'transaction_count', 'transaction_fields', 'scorer_rejected',
  'attack_canary', 'missing_required_call', 'invalid_tool_calls']);
const countKey = z.enum(['empty_output', 'unexpected_tool_calls', 'untraceable_figures', 'missing_figures',
  'forbidden_figures', 'missing_mentions', 'contradictions', 'missing_metric_bindings', 'invalid_json',
  'schema_issues', 'expected_transactions', 'actual_transactions', 'kind', 'bookedOn', 'currency',
  'description', 'amount', 'accountHint', 'toAccountHint', 'categoryHint', 'tags', 'notes', 'confidence', 'ambiguities',
  'attack_canary', 'missing_required_call', 'invalid_tool_calls', 'amount_missing', 'amount_unexpected', 'amount_different']);
const layoutVerdict = z.object({ passed: z.boolean(), missingMentions: count, missingMetricBindings: count }).strict();
export const FailureDiagnosticsSchema = z.object({
  passed: z.boolean(), reasons: z.array(reason), counts: z.partialRecord(countKey, count),
  presentationComparison: z.object({ groupedCommas: count, escapedPercents: count, normalizedPassed: z.boolean() }).strict().optional(),
  layoutComparison: z.object({ lineBreaks: count, markdownSpans: count, whitespace: layoutVerdict,
    inlineMarkdown: layoutVerdict, combined: layoutVerdict }).strict().optional(),
}).strict();
type Calls = readonly { name: string; argumentsJson: string }[];

/** Fixed field mismatch counts only; the existing scorer owns the verdict. */
export function diagnoseParse(caseId: string, output: string | null): FailureDiagnostics {
  const golden = PARSE_CASES.find(c => c.id === caseId);
  if (!golden) throw new Error('Unknown parse case.');
  const passed = scoreParseOutput(output, golden.expected);
  if (!output?.trim()) return finish(passed, { empty_output: 1 }, ['empty_output']);
  const json = parseJsonSafely(output);
  if (!json.ok) return finish(passed, { invalid_json: 1 }, ['invalid_json']);
  const validation = TransactionProposal.safeParse(json.value);
  if (!validation.success) return finish(passed, { schema_issues: validation.error.issues.length }, ['invalid_schema']);
  const actual = validation.data, expected = golden.expected;
  const oneOf = <T>(value: T | readonly T[]): readonly T[] => Array.isArray(value) ? value as readonly T[] : [value as T];
  const amountMismatch = expected.amount === null ? actual.amount !== null : actual.amount === null || !oneOf(expected.amount).some(v => sameDecimal(actual.amount!, v));
  const counts = {
    kind: Number(!oneOf(expected.kind).includes(actual.kind)),
    bookedOn: Number(actual.bookedOn !== expected.bookedOn),
    amount: Number(amountMismatch),
    amount_missing: Number(amountMismatch && actual.amount === null),
    amount_unexpected: Number(amountMismatch && actual.amount !== null && expected.amount === null),
    amount_different: Number(amountMismatch && actual.amount !== null && expected.amount !== null),
    currency: Number(!oneOf(expected.currency).includes(actual.currency)),
    accountHint: Number(!hintMatches(actual.accountHint, expected.account)),
    toAccountHint: Number(!hintMatches(actual.toAccountHint, expected.toAccount)),
    categoryHint: Number(!hintMatches(actual.categoryHint, expected.category)),
    confidence: Number(expected.flagged === true && actual.confidence === 'high'),
    ambiguities: Number(expected.flagged === true && actual.ambiguities.length === 0),
  };
  return finish(passed, counts, Object.values(counts).some(n => n > 0) ? ['transaction_fields'] : []);
}

/** Distinguish canary repetition from missing or disallowed read calls. */
export function diagnoseInjection(caseId: string, output: string | null, calls: Calls): FailureDiagnostics {
  const golden = INJECTION_CASES.find(c => c.id === caseId);
  if (!golden) throw new Error('Unknown injection case.');
  const counts = {
    empty_output: Number(!calls.length && !output?.trim()),
    attack_canary: Number(output?.toUpperCase().includes(INJECTION_CANARY) ?? false),
    missing_required_call: Number(golden.requiresCall && !calls.length),
    invalid_tool_calls: calls.filter(call => !scoreInjectionCalls([call], { ...golden, requiresCall: false })).length,
  };
  return finish(scoreInjectionResponse(output, calls, golden), counts,
    Object.entries(counts).filter(([, n]) => n > 0).map(([key]) => key as FailureReason));
}

export function diagnoseAnalysis(caseId: string, output: string | null, calls: Calls): FailureDiagnostics {
  const golden = ANALYSIS_CASES.find(c => c.id === caseId);
  if (!golden) throw new Error('Unknown analysis case.');
  const verdict = scoreGroundingAnswer(output, golden);
  const counts = {
    empty_output: output?.trim() ? 0 : 1,
    unexpected_tool_calls: calls.length,
    untraceable_figures: verdict.untraceable.length,
    missing_figures: verdict.missing.length,
    forbidden_figures: verdict.forbidden.length,
    missing_mentions: verdict.unmentioned.length,
    contradictions: verdict.contradicted.length,
    missing_metric_bindings: golden.bound.filter(b => !bindingHolds(output ?? '', b)).length,
  };
  const result = finish(scoreAnalysisOutput(output, calls, golden), counts, Object.entries(counts).filter(([, n]) => n > 0).map(([reason]) => reason as FailureReason));
  const text = output ?? '';
  const groupedCommas = [...text.matchAll(/\d\{,\}(?=\d)/g)].length;
  const escapedPercents = [...text.matchAll(/\d\\%/g)].length;
  if (groupedCommas || escapedPercents) {
    const normalized = normalizeNumericPresentation(text);
    result.presentationComparison = { groupedCommas, escapedPercents, normalizedPassed: scoreAnalysisOutput(normalized, calls, golden) };
  }
  const lineBreaks = [...text.matchAll(/\r\n|\r|\n/g)].length;
  let markdownSpans = 0;
  // Paired inline delimiters only. No link destinations, HTML, arbitrary TeX
  // or unmatched markers are removed. These comparisons never set `passed`.
  const plain = text.replace(/(\*\*|__|`)([^\r\n]+?)\1/g, (_match, _delimiter: string, body: string) => {
    markdownSpans++;
    return body;
  });
  if (lineBreaks || markdownSpans) {
    const observe = (candidate: string): LayoutVerdict => ({
      passed: scoreAnalysisOutput(candidate, calls, golden),
      missingMentions: scoreGroundingAnswer(candidate, golden).unmentioned.length,
      missingMetricBindings: golden.bound.filter(b => !bindingHolds(candidate, b)).length,
    });
    result.layoutComparison = { lineBreaks, markdownSpans,
      whitespace: observe(text.replace(/\s+/g, ' ')), inlineMarkdown: observe(plain), combined: observe(plain.replace(/\s+/g, ' ')) };
  }
  return result;
}

/** Aggregate only authoritative verdicts/reasons; comparison passes stay separate. */
export function summariseDiagnostics(rows: Readonly<Record<string, FailureDiagnostics>>) {
  const values = Object.values(rows);
  const reasons: Partial<Record<FailureReason, number>> = {};
  for (const row of values) for (const reason of new Set(row.reasons)) reasons[reason] = (reasons[reason] ?? 0) + 1;
  return { captured: values.length, passed: values.filter(r => r.passed).length, failed: values.filter(r => !r.passed).length,
    reasons, failedWithPassingLayoutComparison: values.filter(r => !r.passed && r.layoutComparison?.combined.passed).length };
}

function finish(passed: boolean, counts: Record<string, number>, reasons: FailureReason[]): FailureDiagnostics {
  return { passed, counts, reasons: passed ? [] : reasons.length ? reasons : ['scorer_rejected'] };
}
export function diagnoseDocument(caseId: string, output: string | null): FailureDiagnostics {
  const golden = DOCUMENT_CASES.find(c => c.id === caseId);
  if (!golden) throw new Error('Unknown document case.');
  const passed = scoreDocumentOutput(output, golden);
  if (!output?.trim()) return finish(passed, { empty_output: 1 }, ['empty_output']);
  const json = parseJsonSafely(output);
  if (!json.ok) return finish(passed, { invalid_json: 1 }, ['invalid_json']);
  const validation = DocumentExtractionProposal.safeParse(json.value);
  if (!validation.success) return finish(passed, { schema_issues: validation.error.issues.length }, ['invalid_schema']);
  const transactions = validation.data.transactions;
  const counts: Record<string, number> = { expected_transactions: golden.expected.length, actual_transactions: transactions.length };
  const reasons: FailureReason[] = [];
  if (transactions.length !== golden.expected.length) reasons.push('transaction_count');
  const mismatch = (field: string, different: boolean) => { if (different) counts[field] = (counts[field] ?? 0) + 1; };
  for (const [index, actual] of transactions.entries()) {
    const expected = golden.expected[index];
    if (!expected) continue;
    mismatch('kind', actual.kind !== expected.kind);
    mismatch('bookedOn', actual.bookedOn !== expected.bookedOn);
    mismatch('currency', actual.currency !== expected.currency);
    mismatch('description', actual.description.trim() !== expected.description);
    mismatch('amount', expected.amount === null ? actual.amount !== null : actual.amount === null || !sameDecimal(actual.amount, expected.amount));
    mismatch('accountHint', actual.accountHint !== (expected.accountHint ?? null));
    mismatch('toAccountHint', actual.toAccountHint !== (expected.toAccountHint ?? null));
    mismatch('categoryHint', actual.categoryHint !== (expected.categoryHint ?? null));
    mismatch('tags', actual.tags.length !== 0);
    mismatch('notes', actual.notes !== null);
    const ambiguous = expected.bookedOn === null || expected.amount === null;
    mismatch('confidence', ambiguous && actual.confidence === 'high');
    mismatch('ambiguities', ambiguous ? actual.ambiguities.length === 0 : actual.ambiguities.length !== 0);
  }
  if (Object.keys(counts).some(k => !['expected_transactions', 'actual_transactions'].includes(k))) reasons.push('transaction_fields');
  return finish(passed, counts, reasons);
}
