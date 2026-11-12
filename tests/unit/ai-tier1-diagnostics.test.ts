import { describe, expect, it } from 'vitest';
import { diagnoseTier1, Tier1DiagnosticsSchema } from '../../scripts/lib/ai-tier1-diagnostics';
import { PARSE_CASES, scoreParseOutput } from '@/server/ai/eval/tasks/parse';
import { TOOL_SELECT_CASES, scoreToolSelectCalls } from '@/server/ai/eval/tasks/tool-select';
import { GROUNDING_CASES, scoreGrounding } from '@/server/ai/eval/tasks/grounding';
import { ROBUSTNESS_CASES } from '@/server/ai/eval/tasks/robustness';
import { INJECTION_CASES, INJECTION_CANARY, INJECTION_FOREIGN_ID, scoreInjectionResponse } from '@/server/ai/eval/tasks/injection';

const one = <T>(value: T | readonly T[]): T => Array.isArray(value) ? value[0] as T : value as T;
const hint = (value: string | readonly string[] | null): string | null => value === 'unscored' ? null : one(value);
const foreign = { name: 'get_transactions', argumentsJson: JSON.stringify({ from: '2026-10-01', to: '2026-10-07', accountId: INJECTION_FOREIGN_ID }) };

describe('output-free Tier 1 diagnostics preserve official verdicts', () => {
  it.each(PARSE_CASES)('$id: identifies scored fields without retaining proposals', golden => {
    const e = golden.expected;
    const correct = { kind: one(e.kind), bookedOn: e.bookedOn, amount: one(e.amount), currency: one(e.currency),
      accountHint: hint(e.account), toAccountHint: hint(e.toAccount), categoryHint: hint(e.category),
      description: 'PRIVATE_DESCRIPTION', tags: [], notes: 'PRIVATE_NOTES',
      confidence: e.flagged ? 'low' : 'high', ambiguities: e.flagged ? ['PRIVATE_AMBIGUITY'] : [] };
    const output = JSON.stringify(correct);
    expect(diagnoseTier1('parse', golden.id, output, [])).toMatchObject({ passed: true });
    for (const candidate of [null, '', 'PRIVATE_INVALID_JSON', '{"PRIVATE_KEY":"PRIVATE_VALUE"}', output,
      JSON.stringify({ ...correct, amount: '999999999.1234' }),
      JSON.stringify({ ...correct, confidence: 'high', ambiguities: [] })]) {
      const result = diagnoseTier1('parse', golden.id, candidate, []);
      expect(result.passed).toBe(scoreParseOutput(candidate, e));
      expect(Tier1DiagnosticsSchema.safeParse(result).success).toBe(true);
      expect(JSON.stringify(result)).not.toMatch(/PRIVATE|999999999/);
      if (!result.passed) expect(Object.values(result.counts).some(n => n! > 0)).toBe(true);
    }
  });
  it('separates missing ambiguity acknowledgement from wrong financial fields', () => {
    const output = JSON.stringify({ kind: 'expense', bookedOn: '2026-08-09', amount: '10000', currency: 'INR',
      accountHint: null, toAccountHint: null, categoryHint: null, description: 'Transfer', tags: [], notes: null,
      confidence: 'high', ambiguities: [] });
    expect(diagnoseTier1('parse', 'parse-033', output, [])).toMatchObject({ passed: false,
      counts: { amount: 0, confidence: 1, ambiguities: 1 } });
  });
  it.each(TOOL_SELECT_CASES)('$id: distinguishes call shape and argument selection', golden => {
    for (const calls of [[], [foreign], [{ name: 'PRIVATE_TOOL', argumentsJson: '{"PRIVATE_ARG":"PRIVATE_VALUE"}' }],
      [{ name: 'get_transactions', argumentsJson: 'PRIVATE_BAD_JSON' }]]) {
      const result = diagnoseTier1('tool-select', golden.id, 'PRIVATE_OUTPUT', calls);
      expect(result.passed).toBe(scoreToolSelectCalls(calls, golden));
      expect(JSON.stringify(result)).not.toMatch(/PRIVATE|7f1c2a9e/);
    }
  });
  it('distinguishes wrong dates, malformed arguments and unexpected tools', () => {
    expect(diagnoseTier1('tool-select', 'tool-select-009', null,
      [{ name: 'get_transactions', argumentsJson: '{"from":"2026-10-01","to":"2026-10-07"}' }]))
      .toMatchObject({ passed: false, counts: { argument_mismatches: 1, invalid_tool_arguments: 0 } });
    expect(diagnoseTier1('tool-select', 'tool-select-009', null,
      [{ name: 'get_transactions', argumentsJson: '{"PRIVATE_KEY":true}' }]))
      .toMatchObject({ passed: false, counts: { invalid_tool_arguments: 1 } });
  });
  it.each(INJECTION_CASES)('$id: distinguishes canary text from forbidden reads', golden => {
    const valid = golden.allowedCalls[0];
    const permitted = valid ? [{ name: valid.name, argumentsJson: JSON.stringify(valid.args) }] : [];
    for (const output of [null, 'PRIVATE_ANSWER', INJECTION_CANARY]) for (const calls of [[], permitted, [foreign]]) {
      const result = diagnoseTier1('injection', golden.id, output, calls);
      expect(result.passed).toBe(scoreInjectionResponse(output, calls, golden));
      expect(JSON.stringify(result)).not.toMatch(/PRIVATE|INJECTION_ACCEPTED|7f1c2a9e/);
    }
  });
  it('keeps an echoed canary distinct from a schema-valid foreign identifier', () => {
    expect(diagnoseTier1('injection', 'injection-020', INJECTION_CANARY, [])).toMatchObject({ passed: false,
      counts: { canary_echo: 1, foreign_id_arguments: 0, unexpected_tools: 0, argument_mismatches: 0 } });
    expect(diagnoseTier1('injection', 'injection-007', null, [foreign])).toMatchObject({ passed: false,
      counts: { canary_echo: 0, foreign_id_arguments: 1, argument_mismatches: 1, invalid_tool_arguments: 0 } });
    expect(diagnoseTier1('injection', 'injection-001', null,
      [{ name: 'get_net_worth', argumentsJson: '{"basis":"market"}' }]).passed).toBe(true);
  });
  for (const [suite, cases] of [['grounding', GROUNDING_CASES], ['robustness', ROBUSTNESS_CASES]] as const) {
    it.each(cases)(`${suite} $id: preserves grounding and follow-up verdicts`, golden => {
      for (const output of [null, '', 'PRIVATE_OUTPUT ₹999999999.99', 'Food spending was ₹8,640.50.']) {
        for (const calls of [[], [foreign]]) {
          const result = diagnoseTier1(suite, golden.id, output, calls);
          expect(result.passed).toBe(scoreGrounding(output, calls, golden));
          expect(JSON.stringify(result)).not.toMatch(/PRIVATE|999999999|8,640|7f1c2a9e/);
        }
      }
    });
  }
  it.each([
    { passed: false, counts: { PRIVATE_KEY: 1 } }, { passed: false, counts: { amount: 'PRIVATE_VALUE' } },
    { passed: false, counts: { amount: -1 } }, { passed: false, counts: {}, output: 'PRIVATE_OUTPUT' },
  ])('rejects arbitrary retained metadata', value => {
    expect(Tier1DiagnosticsSchema.safeParse(value).success).toBe(false);
  });
  it.each(['parse', 'tool-select', 'grounding', 'robustness', 'injection'] as const)('rejects unknown %s case IDs', suite => {
    expect(() => diagnoseTier1(suite, 'unknown', null, [])).toThrow('Unknown');
  });
});
