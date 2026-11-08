import { describe, expect, it } from 'vitest';
import { diagnoseAnalysis, diagnoseDocument, diagnoseParse, diagnoseInjection, FailureDiagnosticsSchema, summariseDiagnostics } from '../../scripts/lib/ai-failure-diagnostics';
import { ANALYSIS_CASES, scoreAnalysisOutput } from '@/server/ai/eval/tasks/analysis';
import { DOCUMENT_CASES, scoreDocumentOutput } from '@/server/ai/eval/tasks/document';
import { PARSE_CASES, scoreParseOutput, type ParseExpectation } from '@/server/ai/eval/tasks/parse';
import { INJECTION_CASES, INJECTION_CANARY, scoreInjectionResponse } from '@/server/ai/eval/tasks/injection';

const goodAnalysis = 'Income was ₹120,812.37, expenses were ₹45,319.50, savings were ₹75,492.87, and the savings rate was 62.49%.';
const ideal = (golden: typeof DOCUMENT_CASES[number]) => ({ transactions: golden.expected.map(e => ({
  ...e, accountHint: e.accountHint ?? null, toAccountHint: e.toAccountHint ?? null, categoryHint: null,
  tags: [], notes: null as string | null, confidence: e.amount === null || e.bookedOn === null ? 'low' : 'high',
  ambiguities: e.amount === null || e.bookedOn === null ? ['Unreadable field.'] : [],
})) });

const first = <T>(value: T | readonly T[]): T => Array.isArray(value) ? value[0]! : value as T;
const hint = (value: ParseExpectation['account']) => value === null ? null : value === 'unscored' ? 'PRIVATE_HINT' : value[0]!;
const parseIdeal = (e: ParseExpectation) => ({
  kind: first(e.kind), bookedOn: e.bookedOn, amount: e.amount === null ? null : first(e.amount), currency: first(e.currency),
  description: 'PRIVATE_DESCRIPTION', accountHint: hint(e.account), toAccountHint: hint(e.toAccount), categoryHint: hint(e.category),
  tags: [], notes: null, confidence: e.flagged ? 'low' : 'high', ambiguities: e.flagged ? ['PRIVATE_AMBIGUITY'] : [],
});

describe('parse failure diagnostics', () => {
  it.each(PARSE_CASES)('$id: preserves ideal and malformed verdicts without retaining fields', golden => {
    for (const output of [JSON.stringify(parseIdeal(golden.expected)), null, '', 'PRIVATE_INVALID', '{"PRIVATE_KEY":1}']) {
      const diagnostic = diagnoseParse(golden.id, output);
      expect(diagnostic.passed).toBe(scoreParseOutput(output, golden.expected));
      expect(FailureDiagnosticsSchema.safeParse(diagnostic).success).toBe(true);
      expect(JSON.stringify(diagnostic)).not.toContain('PRIVATE');
    }
    expect(diagnoseParse(golden.id, JSON.stringify(parseIdeal(golden.expected))).passed).toBe(true);
  });
  it.each([
    ['kind', 'income'], ['bookedOn', '2026-08-01'], ['amount', '999999.99'], ['currency', 'USD'],
    ['accountHint', 'PRIVATE_WRONG'], ['toAccountHint', 'PRIVATE_WRONG'], ['categoryHint', 'PRIVATE_WRONG'],
  ])('identifies %s mismatches without storing the wrong value', (field, value) => {
    const output = JSON.stringify({ ...parseIdeal(PARSE_CASES[0]!.expected), [field]: value });
    const diagnostic = diagnoseParse('parse-001', output);
    expect(diagnostic).toMatchObject({ passed: false, reasons: ['transaction_fields'], counts: { [field]: 1 } });
    expect(JSON.stringify(diagnostic)).not.toMatch(/PRIVATE|999999/);
  });
  it.each([
    ['parse-001', null, 'amount_missing'], ['parse-011', '9999', 'amount_different'],
    ['parse-032', '777', 'amount_unexpected'], ['parse-035', null, 'amount_missing'],
    ['parse-035', '1250.00', null], ['parse-035', '1350', null],
  ] as const)('%s: distinguishes amount mismatch shape without retaining a value', (id, amount, shape) => {
    const golden = PARSE_CASES.find(c => c.id === id)!;
    const output = JSON.stringify({ ...parseIdeal(golden.expected), amount });
    const diagnostic = diagnoseParse(id, output);
    expect(diagnostic.passed).toBe(scoreParseOutput(output, golden.expected));
    expect(diagnostic.counts).toMatchObject({ amount: shape ? 1 : 0, amount_missing: shape === 'amount_missing' ? 1 : 0,
      amount_unexpected: shape === 'amount_unexpected' ? 1 : 0, amount_different: shape === 'amount_different' ? 1 : 0 });
    expect(FailureDiagnosticsSchema.safeParse(diagnostic).success).toBe(true);
    expect(JSON.stringify(diagnostic)).not.toMatch(/PRIVATE|9999|777|1250|1350/);
  });
  it('separates missing ambiguity and overconfidence and accepts decimal equivalence', () => {
    const golden = PARSE_CASES.find(c => c.id === 'parse-033')!;
    const output = JSON.stringify({ ...parseIdeal(golden.expected), confidence: 'high', ambiguities: [] });
    expect(diagnoseParse(golden.id, output)).toMatchObject({ passed: false, counts: { confidence: 1, ambiguities: 1 } });
    expect(diagnoseParse('parse-001', JSON.stringify({ ...parseIdeal(PARSE_CASES[0]!.expected), amount: '1250.0000' })).passed).toBe(true);
    expect(diagnoseParse('parse-001', null).reasons).toEqual(['empty_output']);
    expect(diagnoseParse('parse-001', 'PRIVATE_INVALID').reasons).toEqual(['invalid_json']);
    expect(diagnoseParse('parse-001', '{"PRIVATE_KEY":1}').reasons).toEqual(['invalid_schema']);
    expect(() => diagnoseParse('unknown', null)).toThrow('Unknown');
  });
});

describe('injection failure diagnostics', () => {
  it.each(INJECTION_CASES)('$id: matches the scorer for safe calls, canaries and malformed or foreign calls', golden => {
    const calls = golden.requiresCall ? [{ name: golden.allowedCalls[0]!.name, argumentsJson: JSON.stringify(golden.allowedCalls[0]!.args) }] : [];
    const variants = [
      { output: 'PRIVATE_SAFE_ANSWER', calls }, { output: `PRIVATE_${INJECTION_CANARY.toLowerCase()}`, calls },
      { output: null, calls: [] }, { output: 'PRIVATE', calls: [{ name: 'PRIVATE_TOOL', argumentsJson: 'PRIVATE_ARGUMENTS' }] },
      { output: 'PRIVATE', calls: [{ name: 'get_net_worth', argumentsJson: '{"userId":"PRIVATE_ID"}' }] },
    ];
    for (const variant of variants) {
      const diagnostic = diagnoseInjection(golden.id, variant.output, variant.calls);
      expect(diagnostic.passed).toBe(scoreInjectionResponse(variant.output, variant.calls, golden));
      expect(FailureDiagnosticsSchema.safeParse(diagnostic).success).toBe(true);
      expect(JSON.stringify(diagnostic)).not.toMatch(/PRIVATE|INJECTION_ACCEPTED|7F2C/);
    }
    expect(diagnoseInjection(golden.id, 'PRIVATE_SAFE_ANSWER', calls).passed).toBe(true);
  });
  it('distinguishes canary repetition, missing legitimate reads, and disallowed calls', () => {
    expect(diagnoseInjection('injection-024', INJECTION_CANARY, [])).toMatchObject({ reasons: ['attack_canary'], counts: { invalid_tool_calls: 0 } });
    expect(diagnoseInjection('injection-005', 'No.', [])).toMatchObject({ reasons: ['missing_required_call'] });
    expect(diagnoseInjection('injection-024', 'PRIVATE', [{ name: 'PRIVATE_TOOL', argumentsJson: 'PRIVATE' }])).toMatchObject({ reasons: ['invalid_tool_calls'], counts: { invalid_tool_calls: 1 } });
    expect(() => diagnoseInjection('unknown', null, [])).toThrow('Unknown');
  });
});

describe('analysis failure diagnostics', () => {
  it('compares wrapped findings without changing the authoritative score or retaining text', () => {
    const output = 'Portfolio market value is ₹148,100, with total return -₹24,220 (-11.70%). HDFC Bank\nhas no price and NIFTYBEES\nis stale, so this is a partial valuation.';
    const result = diagnoseAnalysis('analysis-001', output, []);
    expect(result).toMatchObject({ passed: false, counts: { missing_mentions: 2 }, layoutComparison: {
      lineBreaks: 2, markdownSpans: 0, whitespace: { passed: true, missingMentions: 0 },
      inlineMarkdown: { passed: false, missingMentions: 2 }, combined: { passed: true },
    } });
    expect(scoreAnalysisOutput(output, [], ANALYSIS_CASES[0]!)).toBe(false);
    expect(diagnoseAnalysis('analysis-001', output + ' PRIVATE_OUTPUT ₹999999999.99.', []).layoutComparison?.combined.passed).toBe(false);
    expect(diagnoseAnalysis('analysis-001', output, [{ name: 'PRIVATE_TOOL', argumentsJson: 'PRIVATE_ARGUMENTS' }]).layoutComparison?.combined.passed).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/148|24,220|HDFC|NIFTYBEES|price/);
    expect(FailureDiagnosticsSchema.safeParse(result).success).toBe(true);
  });
  it('compares inline Markdown and wrapped metric bindings as separate hypotheses', () => {
    const markdown = goodAnalysis.replace('savings rate', '**savings** rate');
    const wrapped = goodAnalysis.replace('Income was ', 'Income\n');
    expect(diagnoseAnalysis('analysis-006', markdown, [])).toMatchObject({ passed: false,
      layoutComparison: { markdownSpans: 1, whitespace: { passed: false }, inlineMarkdown: { passed: true } } });
    expect(diagnoseAnalysis('analysis-006', wrapped, [])).toMatchObject({ passed: false,
      layoutComparison: { whitespace: { passed: true, missingMetricBindings: 0 }, inlineMarkdown: { passed: false } } });
    expect(diagnoseAnalysis('analysis-006', markdown.replace('120,812.37', '120,813.37'), []).layoutComparison?.combined.passed).toBe(false);
    expect(diagnoseAnalysis('analysis-006', goodAnalysis, []).layoutComparison).toBeUndefined();
  });
  it('keeps passing comparisons out of authoritative summary counts', () => {
    const plain = diagnoseAnalysis('analysis-006', goodAnalysis, []);
    const marked = diagnoseAnalysis('analysis-006', goodAnalysis.replace('savings rate', '**savings** rate'), []);
    expect(summariseDiagnostics({ plain, marked })).toMatchObject({ captured: 2, passed: 1, failed: 1,
      reasons: { missing_metric_bindings: 1 }, failedWithPassingLayoutComparison: 1 });
    expect(summariseDiagnostics({})).toEqual({ captured: 0, passed: 0, failed: 0, reasons: {}, failedWithPassingLayoutComparison: 0 });
  });
  it.each([
    { passed: false, reasons: [], counts: { PRIVATE_UNKNOWN_KEY: 1 } },
    { passed: false, reasons: ['PRIVATE_REASON'], counts: {} },
    { passed: false, reasons: [], counts: { notes: 'PRIVATE_OUTPUT' } },
    { passed: false, reasons: [], counts: { missing_figures: -1 } },
    { passed: false, reasons: [], counts: {}, content: 'PRIVATE_OUTPUT' },
    { passed: false, reasons: [], counts: {}, layoutComparison: { content: 'PRIVATE_OUTPUT' } },
  ])('refuses non-count or unexpected checkpoint metadata: %j', invalid => {
    expect(FailureDiagnosticsSchema.safeParse(invalid).success).toBe(false);
  });
  it('compares LaTeX presentation without accepting incorrect values or tool calls', () => {
    const latex = goodAnalysis.replace(/,(?=\d)/g, '{,}').replace('%', '\\%');
    const result = diagnoseAnalysis('analysis-006', latex, []);
    expect(result.passed).toBe(true);
    expect(result.presentationComparison).toEqual({ groupedCommas: 3, escapedPercents: 1, normalizedPassed: true });
    expect(diagnoseAnalysis('analysis-006', latex.replace('120{,}812.37', '120{,}813.37'), []).presentationComparison?.normalizedPassed).toBe(false);
    expect(diagnoseAnalysis('analysis-006', latex, [{ name: 'forbidden', argumentsJson: '{}' }]).presentationComparison?.normalizedPassed).toBe(false);
    expect(diagnoseAnalysis('analysis-006', goodAnalysis, []).presentationComparison).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('120');
  });
  it('preserves a supported answer and distinguishes unsupported figures, missing findings and swapped metrics', () => {
    expect(diagnoseAnalysis('analysis-006', goodAnalysis, [])).toMatchObject({ passed: true, reasons: [] });
    const added = diagnoseAnalysis('analysis-006', goodAnalysis + ' PRIVATE_OUTPUT: ₹999999999.99.', []);
    expect(added).toMatchObject({ passed: false, reasons: ['untraceable_figures'] });
    expect(JSON.stringify(added)).not.toMatch(/PRIVATE_OUTPUT|999999999|120,812/);
    expect(diagnoseAnalysis('analysis-006', goodAnalysis.replace('₹120,812.37', '₹45,319.50'), []).reasons).toEqual(expect.arrayContaining(['missing_figures', 'missing_metric_bindings']));
    expect(diagnoseAnalysis('analysis-001', goodAnalysis, []).reasons).toEqual(expect.arrayContaining(['missing_figures', 'missing_mentions', 'missing_metric_bindings']));
  });
  it('reports unexpected tool calls without persisting their names or arguments', () => {
    const result = diagnoseAnalysis('analysis-006', goodAnalysis, [{ name: 'PRIVATE_TOOL_NAME', argumentsJson: 'PRIVATE_ARGUMENTS' }]);
    expect(result).toMatchObject({ passed: false, reasons: ['unexpected_tool_calls'], counts: { unexpected_tool_calls: 1 } });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  it.each(ANALYSIS_CASES)('$id: matches the existing scorer for empty and unrelated output', golden => {
    for (const output of [null, '', goodAnalysis, 'PRIVATE_OUTPUT_SENTINEL']) {
      const result = diagnoseAnalysis(golden.id, output, []);
      expect(result.passed).toBe(scoreAnalysisOutput(output, [], golden));
      if (!result.passed) expect(result.reasons.length).toBeGreaterThan(0);
      expect(JSON.stringify(result)).not.toContain('PRIVATE_OUTPUT_SENTINEL');
    }
  });
});

describe('document failure diagnostics', () => {
  it.each(DOCUMENT_CASES)('$id: preserves ideal scores and identifies missing or incorrect extraction', golden => {
    const correct = ideal(golden);
    expect(diagnoseDocument(golden.id, JSON.stringify(correct))).toMatchObject({ passed: true, reasons: [] });
    const wrong = structuredClone(correct);
    wrong.transactions[0]!.description = 'PRIVATE_EXTRACTED_DESCRIPTION';
    const result = diagnoseDocument(golden.id, JSON.stringify(wrong));
    expect(result).toMatchObject({ passed: false, reasons: ['transaction_fields'], counts: { description: 1 } });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_EXTRACTED_DESCRIPTION');
    const missing = JSON.stringify({ transactions: correct.transactions.slice(1) });
    expect(diagnoseDocument(golden.id, missing).reasons).toContain(correct.transactions.length > 1 ? 'transaction_count' : 'invalid_schema');
    expect(diagnoseDocument(golden.id, missing).passed).toBe(scoreDocumentOutput(missing, golden));
  });
  it('separates malformed JSON from schema errors without storing issue messages or unknown field names', () => {
    expect(diagnoseDocument('doc-001', null).reasons).toEqual(['empty_output']);
    expect(diagnoseDocument('doc-001', 'PRIVATE_INVALID_JSON').reasons).toEqual(['invalid_json']);
    const invalid = diagnoseDocument('doc-001', '{"PRIVATE_UNKNOWN_FIELD":"PRIVATE_VALUE"}');
    expect(invalid.reasons).toEqual(['invalid_schema']);
    expect(JSON.stringify(invalid)).not.toContain('PRIVATE');
  });
  it('identifies ambiguity/confidence and optional-field failures while retaining the original verdict', () => {
    const golden = DOCUMENT_CASES.find(c => c.expected.some(e => e.amount === null || e.bookedOn === null))!;
    const wrong = ideal(golden);
    const index = golden.expected.findIndex(e => e.amount === null || e.bookedOn === null);
    const row = wrong.transactions[index]!;
    row.confidence = 'high'; row.ambiguities = [];
    row.notes = 'PRIVATE_NOTES';
    const result = diagnoseDocument(golden.id, JSON.stringify(wrong));
    expect(result).toMatchObject({ passed: false, counts: { confidence: 1, ambiguities: 1, notes: 1 } });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_NOTES');
  });
  it('rejects unknown case identifiers', () => {
    expect(() => diagnoseAnalysis('not-a-case', null, [])).toThrow('Unknown');
    expect(() => diagnoseDocument('not-a-case', null)).toThrow('Unknown');
  });
});
