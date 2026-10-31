import { describe, expect, it } from 'vitest';

import { ok } from '@/lib/result';
import { evaluateModel } from '@/server/ai/eval/harness';
import {
  TOOL_SELECT_CASES,
  TOOL_SELECT_SUITE_VERSION,
  TOOL_SELECT_TODAY,
  scoreToolSelectCalls,
  toolSelectSuite,
  type ArgExpectation,
  type ExpectedCall,
  type ToolSelectGoldenCase,
} from '@/server/ai/eval/tasks/tool-select';
import { allTools, findTool } from '@/server/ai/tools/registry';
import type { AiProvider, ChatRequest, ToolCall } from '@/server/ai/provider/types';

/**
 * The `tool-select` golden corpus (AI-SYSTEM.md §14). No model runs here: these
 * tests prove the corpus is coherent — every expected call is one the registry
 * would accept, every expected call passes, and a wrong tool, a wrong month, an
 * invented argument or an unknown tool fails.
 */

const call = (name: string, args: Record<string, unknown> = {}) => ({ name, argumentsJson: JSON.stringify(args) });
const byId = (id: number): ToolSelectGoldenCase =>
  TOOL_SELECT_CASES.find((c) => c.id === `tool-select-${String(id).padStart(3, '0')}`)!;

/** One concrete value that satisfies an expectation, or `undefined` for "leave it out". */
function satisfying(expectation: ArgExpectation): unknown {
  if (expectation === 'absent') return undefined;
  if ('is' in expectation) return expectation.is;
  if ('absentOr' in expectation) return expectation.absentOr;
  if ('inMonth' in expectation) return `${expectation.inMonth}-15`;
  if ('absentOrInMonth' in expectation) return `${expectation.absentOrInMonth}-01`;
  return [...expectation.sameSet].reverse();
}

function exemplar(expected: ExpectedCall) {
  const args: Record<string, unknown> = {};
  for (const [key, e] of Object.entries(expected.args ?? {})) {
    const value = satisfying(e);
    if (value !== undefined) args[key] = value;
  }
  return call(expected.tool, args);
}

describe('tool-select corpus — shape', () => {
  it('has the 30 cases AI-SYSTEM.md §14 specifies, with unique sequential ids', () => {
    expect(TOOL_SELECT_CASES).toHaveLength(30);
    expect(TOOL_SELECT_CASES.map((c) => c.id)).toEqual(
      TOOL_SELECT_CASES.map((_, n) => `tool-select-${String(n + 1).padStart(3, '0')}`),
    );
    expect(TOOL_SELECT_SUITE_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('expects only registry tools, and only arguments those tools define', () => {
    for (const c of TOOL_SELECT_CASES) {
      for (const expected of c.needs.flat()) {
        const tool = findTool(expected.tool);
        expect(tool, `${c.id}: ${expected.tool}`).toBeDefined();
        const shape = (tool!.input as unknown as { shape: Record<string, unknown> }).shape;
        for (const key of Object.keys(expected.args ?? {})) expect(Object.keys(shape), `${c.id}: ${key}`).toContain(key);
      }
    }
  });

  it('covers every tool in the registry at least once', () => {
    const expected = new Set(TOOL_SELECT_CASES.flatMap((c) => c.needs.flat().map((e) => e.tool)));
    for (const tool of allTools()) expect(expected.has(tool.name), tool.name).toBe(true);
  });

  it('includes no-tool, multi-need and adversarial cases', () => {
    expect(TOOL_SELECT_CASES.filter((c) => c.needs.length === 0).length).toBeGreaterThanOrEqual(2);
    expect(TOOL_SELECT_CASES.filter((c) => c.needs.length > 1).length).toBeGreaterThanOrEqual(1);
    expect(TOOL_SELECT_CASES.filter((c) => /userId|ignore/i.test(c.question)).length).toBeGreaterThanOrEqual(1);
  });
});

describe('tool-select corpus — the scorer', () => {
  it.each(TOOL_SELECT_CASES.map((c) => [c.id, c] as const))('%s: every expected call passes on its own', (_, c) => {
    if (c.needs.length === 0) {
      expect(scoreToolSelectCalls([], c)).toBe(true);
      return;
    }
    for (const expected of c.needs.flat()) expect(scoreToolSelectCalls([exemplar(expected)], c), expected.tool).toBe(true);
    // All needs at once also passes.
    expect(scoreToolSelectCalls(c.needs.map((need) => exemplar(need[0]!)), c)).toBe(true);
  });

  it.each(TOOL_SELECT_CASES.map((c) => [c.id, c] as const))('%s: a tool it does not need fails', (_, c) => {
    const needed = new Set(c.needs.flat().map((e) => e.tool));
    const other = allTools().find((t) => !needed.has(t.name) && t.input.safeParse({}).success)!;
    expect(scoreToolSelectCalls([call(other.name)], c)).toBe(false);
    if (c.needs.length > 0) {
      expect(scoreToolSelectCalls([exemplar(c.needs[0]![0]!), call(other.name)], c)).toBe(false);
      expect(scoreToolSelectCalls([], c)).toBe(false);
    }
  });

  it('the wrong month fails: "last month" is September, not October or August', () => {
    const food = byId(1);
    expect(scoreToolSelectCalls([call('get_expense_summary', { asOf: '2026-09-30' })], food)).toBe(true);
    expect(scoreToolSelectCalls([call('get_expense_summary', { asOf: '2026-09-01', groupBy: 'category' })], food)).toBe(true);
    expect(scoreToolSelectCalls([call('get_expense_summary', {})], food)).toBe(false);
    expect(scoreToolSelectCalls([call('get_expense_summary', { asOf: TOOL_SELECT_TODAY })], food)).toBe(false);
    expect(scoreToolSelectCalls([call('get_expense_summary', { asOf: '2026-08-31' })], food)).toBe(false);
    expect(scoreToolSelectCalls([call('get_expense_summary', { asOf: '2026-09-15', groupBy: 'tag' })], food)).toBe(false);
  });

  it('the current month may be omitted or named', () => {
    const compare = byId(5);
    expect(scoreToolSelectCalls([call('compare_periods')], compare)).toBe(true);
    expect(scoreToolSelectCalls([call('compare_periods', { asOf: '2026-10-02' })], compare)).toBe(true);
    expect(scoreToolSelectCalls([call('compare_periods', { asOf: '2026-09-30' })], compare)).toBe(false);
  });

  it('dates are exact: an off-by-one range fails', () => {
    const range = byId(9);
    expect(scoreToolSelectCalls([call('get_transactions', { from: '2026-09-01', to: '2026-09-30', limit: 50 })], range)).toBe(true);
    expect(scoreToolSelectCalls([call('get_transactions', { from: '2026-09-01', to: '2026-10-01' })], range)).toBe(false);
    expect(scoreToolSelectCalls([call('get_transactions', { from: '2026-09-01' })], range)).toBe(false);
  });

  it('a date set must match exactly, in any order', () => {
    const history = byId(18);
    const dates = ['2026-09-30', '2026-06-30', '2026-08-31', '2026-07-31'];
    expect(scoreToolSelectCalls([call('get_net_worth_history', { dates })], history)).toBe(true);
    expect(scoreToolSelectCalls([call('get_net_worth_history', { dates: dates.slice(1) })], history)).toBe(false);
    expect(scoreToolSelectCalls([call('get_net_worth_history', { dates: [...dates.slice(1), '2026-06-01'] })], history)).toBe(false);
    expect(scoreToolSelectCalls([call('get_net_worth_history', { dates: ['2026-09-30', '2026-09-30', '2026-08-31', '2026-07-31'] })], history)).toBe(false);
  });

  it('the basis is the argument that matters for market value', () => {
    const market = byId(16);
    expect(scoreToolSelectCalls([call('get_net_worth', { basis: 'market' })], market)).toBe(true);
    expect(scoreToolSelectCalls([call('get_net_worth', { basis: 'cost' })], market)).toBe(false);
    expect(scoreToolSelectCalls([call('get_net_worth')], market)).toBe(false);
  });

  it('a multi-need first turn passes with any one need, called correctly', () => {
    const cash = byId(27);
    expect(scoreToolSelectCalls([call('get_accounts')], cash)).toBe(true);
    expect(scoreToolSelectCalls([call('get_recurring_transactions', { horizonDays: 30 })], cash)).toBe(true);
    expect(scoreToolSelectCalls([call('get_accounts', { asOf: '2026-09-30' })], cash)).toBe(false);
  });

  it('rejects what dispatch would reject: an unknown tool, an invented argument, bad JSON, a bad date', () => {
    const netWorth = byId(30);
    expect(scoreToolSelectCalls([call('get_net_worth')], netWorth)).toBe(true);
    expect(scoreToolSelectCalls([{ name: 'get_net_worth', argumentsJson: '' }], netWorth)).toBe(true);
    expect(scoreToolSelectCalls([call('get_net_worth', { userId: '7f1c2a9e' })], netWorth)).toBe(false);
    expect(scoreToolSelectCalls([call('get_user_net_worth')], netWorth)).toBe(false);
    expect(scoreToolSelectCalls([{ name: 'get_net_worth', argumentsJson: '{asOf:' }], netWorth)).toBe(false);
    expect(scoreToolSelectCalls([call('get_net_worth', { asOf: '15/10/2026' })], netWorth)).toBe(false);
  });

  it('a write request and a concept question pass only with no call at all', () => {
    for (const id of [28, 29]) {
      expect(scoreToolSelectCalls([], byId(id))).toBe(true);
      expect(scoreToolSelectCalls([call('get_accounts')], byId(id))).toBe(false);
      expect(scoreToolSelectCalls([call('add_transaction', { amount: '500' })], byId(id))).toBe(false);
    }
  });
});

describe('tool-select corpus — prompt and tools', () => {
  it('sends the production registry and the fixed date, and no account or category list', () => {
    const names = allTools().map((t) => t.name);
    for (const c of toolSelectSuite()) {
      const golden = TOOL_SELECT_CASES.find((g) => g.id === c.id)!;
      expect(c.tools?.map((t) => t.name)).toEqual(names);
      expect(c.schema).toBeUndefined();
      expect(c.messages).toHaveLength(2);
      expect(c.messages[1]).toEqual({ role: 'user', content: golden.question });
      const system = c.messages[0]!.content;
      expect(system).toContain(`Today is ${TOOL_SELECT_TODAY} (Thursday).`);
      expect(system).not.toMatch(/HDFC|Food|Salary/);
    }
  });
});

describe('harness — tool-call correctness counts a right "no call" as correct', () => {
  const replying = (toolCalls: readonly ToolCall[]): AiProvider => ({
    key: 'fake',
    isConfigured: () => true,
    listModels: async () => ok([]),
    chat: async (request: ChatRequest) =>
      ok({
        content: toolCalls.length === 0 ? 'XIRR is a money-weighted return.' : null,
        toolCalls,
        reasoning: null,
        finishReason: toolCalls.length === 0 ? 'stop' : 'tool_calls',
        usage: { promptTokens: 0, completionTokens: 0 },
        model: request.model,
        latencyMs: 5,
      }),
  });
  const suite = toolSelectSuite();
  const concept = suite.filter((c) => c.id === 'tool-select-028');
  const food = suite.filter((c) => c.id === 'tool-select-001');

  it('no call on a concept question is passed and tool-call correct', async () => {
    const report = await evaluateModel(replying([]), 'fake/model', concept);
    expect(report.cases[0]).toMatchObject({ passed: true, toolCallValid: true, schemaValid: null });
    expect(report.toolCallCorrectness).toBe(1);
  });

  it('a call on a concept question, or the wrong month on a data question, is neither', async () => {
    const stray = await evaluateModel(replying([{ id: 'c1', name: 'get_portfolio_summary', argumentsJson: '{}' }]), 'fake/model', concept);
    expect(stray.cases[0]).toMatchObject({ passed: false, toolCallValid: false });
    const wrongMonth = await evaluateModel(
      replying([{ id: 'c1', name: 'get_expense_summary', argumentsJson: '{"asOf":"2026-10-15"}' }]),
      'fake/model',
      food,
    );
    expect(wrongMonth.cases[0]).toMatchObject({ passed: false, toolCallValid: false });
  });
});
