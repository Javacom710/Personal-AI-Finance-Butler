/** Output-free explanations of unchanged Tier 1 scorers. */
import { z } from 'zod';
import { PARSE_CASES, scoreParseOutput } from '../../src/server/ai/eval/tasks/parse';
import { TOOL_SELECT_CASES, scoreToolSelectCalls } from '../../src/server/ai/eval/tasks/tool-select';
import { GROUNDING_CASES, scoreGrounding, scoreGroundingAnswer } from '../../src/server/ai/eval/tasks/grounding';
import { ROBUSTNESS_CASES } from '../../src/server/ai/eval/tasks/robustness';
import { INJECTION_CASES, INJECTION_CANARY, INJECTION_FOREIGN_ID, scoreInjectionCalls, scoreInjectionResponse } from '../../src/server/ai/eval/tasks/injection';
import { TransactionProposal } from '../../src/server/ai/proposals/schemas';
import { parseJsonSafely } from '../../src/server/ai/structured/validate';
import { findTool } from '../../src/server/ai/tools/registry';
import { hintMatches, sameDecimal } from '../../src/server/ai/eval/score';

export type Tier1DiagnosticSuite = 'parse' | 'tool-select' | 'grounding' | 'robustness' | 'injection';
const key = z.enum(['empty_output', 'invalid_json', 'schema_issues', 'kind', 'bookedOn', 'amount', 'currency',
  'accountHint', 'toAccountHint', 'categoryHint', 'confidence', 'ambiguities', 'missing_required_call',
  'unknown_tools', 'invalid_tool_arguments', 'unexpected_tools', 'argument_mismatches', 'foreign_id_arguments',
  'canary_echo', 'unexpected_tool_calls', 'untraceable_figures', 'missing_figures', 'forbidden_figures',
  'missing_mentions', 'contradictions', 'scorer_rejected']);
export const Tier1DiagnosticsSchema = z.object({
  passed: z.boolean(), counts: z.partialRecord(key, z.number().int().safe().nonnegative()),
}).strict();
export type Tier1Diagnostics = z.infer<typeof Tier1DiagnosticsSchema>;
type Counts = Tier1Diagnostics['counts'];
type Calls = readonly { name: string; argumentsJson: string }[];
const flag = (condition: boolean) => condition ? 1 : 0;
const choices = <T>(value: T | readonly T[]): readonly T[] => Array.isArray(value) ? value as readonly T[] : [value as T];
function finish(passed: boolean, counts: Counts): Tier1Diagnostics {
  if (!passed && !Object.values(counts).some(n => n! > 0)) counts.scorer_rejected = 1;
  return Tier1DiagnosticsSchema.parse({ passed, counts });
}

/** Only counts escape: no tool names, argument values, schema messages or text. */
function callCounts(calls: Calls, allowed: readonly string[], accepts: (calls: Calls) => boolean): Counts {
  const counts: Counts = { unknown_tools: 0, invalid_tool_arguments: 0, unexpected_tools: 0,
    argument_mismatches: 0, foreign_id_arguments: 0 };
  for (const call of calls) {
    const tool = findTool(call.name);
    if (!tool) counts.unknown_tools!++;
    let raw: unknown;
    try { raw = JSON.parse(call.argumentsJson.trim() === '' ? '{}' : call.argumentsJson); }
    catch { counts.invalid_tool_arguments!++; continue; }
    if (raw && typeof raw === 'object' && Object.values(raw).includes(INJECTION_FOREIGN_ID)) counts.foreign_id_arguments!++;
    if (tool && !tool.input.safeParse(raw).success) counts.invalid_tool_arguments!++;
    if (!allowed.includes(call.name)) counts.unexpected_tools!++;
    else if (tool && tool.input.safeParse(raw).success && !accepts([call])) counts.argument_mismatches!++;
  }
  return counts;
}

export function diagnoseTier1(suite: Tier1DiagnosticSuite, caseId: string, output: string | null, calls: Calls): Tier1Diagnostics {
  if (suite === 'parse') {
    const golden = PARSE_CASES.find(c => c.id === caseId);
    if (!golden) throw new Error('Unknown parse diagnostic case.');
    const passed = scoreParseOutput(output, golden.expected);
    if (!output?.trim()) return finish(passed, { empty_output: 1 });
    const json = parseJsonSafely(output);
    if (!json.ok) return finish(passed, { invalid_json: 1 });
    const parsed = TransactionProposal.safeParse(json.value);
    if (!parsed.success) return finish(passed, { schema_issues: parsed.error.issues.length });
    const actual = parsed.data, expected = golden.expected;
    return finish(passed, {
      kind: flag(!choices(expected.kind).includes(actual.kind)), bookedOn: flag(actual.bookedOn !== expected.bookedOn),
      amount: flag(expected.amount === null ? actual.amount !== null : actual.amount === null ||
        !choices(expected.amount).some(accepted => sameDecimal(actual.amount!, accepted))),
      currency: flag(!choices(expected.currency).includes(actual.currency)),
      accountHint: flag(!hintMatches(actual.accountHint, expected.account)),
      toAccountHint: flag(!hintMatches(actual.toAccountHint, expected.toAccount)),
      categoryHint: flag(!hintMatches(actual.categoryHint, expected.category)),
      confidence: flag(expected.flagged === true && actual.confidence === 'high'),
      ambiguities: flag(expected.flagged === true && actual.ambiguities.length === 0),
    });
  }
  if (suite === 'tool-select') {
    const golden = TOOL_SELECT_CASES.find(c => c.id === caseId);
    if (!golden) throw new Error('Unknown tool-selection diagnostic case.');
    const accepts = (values: Calls) => scoreToolSelectCalls(values, golden);
    return finish(accepts(calls), { ...callCounts(calls, golden.needs.flat().map(c => c.tool), accepts),
      missing_required_call: flag(golden.needs.length > 0 && calls.length === 0) });
  }
  if (suite === 'injection') {
    const golden = INJECTION_CASES.find(c => c.id === caseId);
    if (!golden) throw new Error('Unknown injection diagnostic case.');
    const accepts = (values: Calls) => scoreInjectionCalls(values, golden);
    return finish(scoreInjectionResponse(output, calls, golden), {
      ...callCounts(calls, golden.allowedCalls.map(c => c.name), accepts),
      canary_echo: flag(output?.toUpperCase().includes(INJECTION_CANARY) ?? false),
      empty_output: flag(calls.length === 0 && !output?.trim()),
      missing_required_call: flag(golden.requiresCall && calls.length === 0),
    });
  }
  const golden = (suite === 'grounding' ? GROUNDING_CASES : ROBUSTNESS_CASES).find(c => c.id === caseId);
  if (!golden) throw new Error('Unknown grounding/robustness diagnostic case.');
  const passed = scoreGrounding(output, calls, golden);
  if (golden.followUp) {
    const accepts = (values: Calls) => scoreGrounding(output, values, golden);
    return finish(passed, { ...callCounts(calls, golden.followUp.map(c => c.tool), accepts),
      missing_required_call: flag(calls.length === 0) });
  }
  const result = scoreGroundingAnswer(output, golden);
  return finish(passed, { empty_output: flag(!output?.trim()), unexpected_tool_calls: calls.length,
    untraceable_figures: result.untraceable.length, missing_figures: result.missing.length,
    forbidden_figures: result.forbidden.length, missing_mentions: result.unmentioned.length,
    contradictions: result.contradicted.length });
}
