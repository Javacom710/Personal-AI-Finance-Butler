import { describe, expect, it } from 'vitest';

import { ok } from '@/lib/result';
import { evaluateModel } from '@/server/ai/eval/harness';
import {
  ANALYSIS_CASES,
  ANALYSIS_SUITE_VERSION,
  analysisSuite,
  scoreAnalysisOutput,
} from '@/server/ai/eval/tasks/analysis';
import { GROUNDING_RESULTS } from '@/server/ai/eval/tasks/grounding';
import type { AiProvider, ChatRequest } from '@/server/ai/provider/types';

const ANSWERS: Readonly<Record<string, string>> = {
  'analysis-001': 'Portfolio market value is ₹148,100, with total return -₹24,220 (-11.70%). HDFC Bank has no price and NIFTYBEES is stale, so this is a partial valuation.',
  'analysis-002': 'The realised gain is ₹4,992; the unrealised loss is -₹30,912, alongside total return -₹24,220.',
  'analysis-003': 'Equities total ₹91,200 (61.58%); ETFs total ₹56,900 (38.42%). HDFC Bank has no price, so the allocation excludes it.',
  'analysis-004': 'HDFC Bank has ₹40,000 invested and no price, so its market value is unavailable. NIFTYBEES is valued at ₹56,900 using a stale price.',
  'analysis-005': 'Total return is -₹24,220 and XIRR is -21.06%; time-weighted return is unavailable because of insufficient price history.',
  'analysis-006': 'Income was ₹120,812.37, expenses were ₹45,319.50, savings were ₹75,492.87, and the savings rate was 62.49%.',
  'analysis-007': 'Food spending is ₹5,040 of its ₹10,000 budget, leaving ₹4,960. Dining spending is ₹3,150 against ₹2,500, so it is ₹650 over budget.',
  'analysis-008': 'HDFC Savings has ₹412,022.37; the HDFC Credit Card balance is -₹14,969.50. The Home loan has ₹2,412,345.67 outstanding with an EMI of ₹24,500.',
  'analysis-009': 'The runway metric is not available here, and there is not enough spend history to determine it. HDFC Savings is ₹412,022.37.',
  'analysis-010': 'October expenses were ₹30,040, down from September’s ₹45,319.50; savings rose to ₹89,960 from ₹75,492.87. Expense delta was -₹15,279.50 and savings delta was ₹14,467.13.',
  'analysis-011': 'Housing was the largest September category at ₹25,000. October spending was ₹30,040, lower than September’s ₹45,319.50.',
  'analysis-012': 'At cost basis, net worth rose from June’s ₹7,404,700 to July’s ₹7,409,692, August’s ₹7,494,242 and September’s ₹8,017,389.20.',
  'analysis-013': 'At cost, net worth was ₹8,107,349.20. Portfolio market value was ₹148,100 and total return was -₹24,220. The portfolio valuation is partial: HDFC Bank is unpriced and NIFTYBEES has a stale price.',
  'analysis-014': 'September savings were ₹75,492.87. Dining is ₹650 over budget; the home loan outstanding is ₹2,412,345.67 with a ₹24,500 EMI.',
  'analysis-015': 'HDFC Savings shows ₹412,022.37, the home loan EMI is ₹24,500, and September savings were ₹75,492.87. Portfolio market value is ₹148,100, but HDFC Bank is unpriced and NIFTYBEES is stale. Consider time horizon, risk tolerance, goals and emergency fund before an investment decision.',
};

describe('analysis corpus — coverage and replay shape', () => {
  it('contains 15 versioned cases across portfolio, health, period and cross-domain analysis', () => {
    expect(ANALYSIS_SUITE_VERSION).toBe(1);
    expect(ANALYSIS_CASES).toHaveLength(15);
    expect(new Set(ANALYSIS_CASES.map((c) => c.id)).size).toBe(15);
    expect(new Set(ANALYSIS_CASES.map((c) => c.domain))).toEqual(new Set(['portfolio', 'health', 'period', 'cross-domain']));
    expect(ANALYSIS_CASES.filter((c) => c.domain === 'cross-domain')).toHaveLength(3);
    expect(Object.keys(ANSWERS)).toHaveLength(ANALYSIS_CASES.length);
  });

  it('replays correctly paired synthetic tool calls and results with multiple domains in one case', () => {
    const cases = analysisSuite();
    expect(cases).toHaveLength(15);
    const golden = ANALYSIS_CASES.find((c) => c.id === 'analysis-015')!;
    const replay = cases.find((c) => c.id === golden.id)!;
    expect(replay.suite).toBe('analysis');
    expect(replay.messages[0]?.role).toBe('system');
    expect(replay.messages[1]).toMatchObject({ role: 'user', content: golden.question });
    expect(replay.messages[2]?.toolCalls).toHaveLength(golden.calls.length);
    const results = replay.messages.slice(3);
    expect(results).toHaveLength(golden.calls.length);
    expect(results.every((m) => m.role === 'tool')).toBe(true);
    golden.calls.forEach((key, index) => expect(JSON.parse(results[index]!.content)).toEqual(GROUNDING_RESULTS[key]));
  });
});

describe('analysis scorer — deterministic factual rubric', () => {
  it.each(ANALYSIS_CASES)('$id: accepts the supported case-specific findings', (golden) => {
    expect(scoreAnalysisOutput(ANSWERS[golden.id] ?? null, [], golden)).toBe(true);
  });

  it('rejects a computed or unsupported figure even if all expected findings are present', () => {
    const golden = ANALYSIS_CASES.find((c) => c.id === 'analysis-010')!;
    const answer = `${ANSWERS[golden.id]} This means the savings increase was 19.2%.`;
    expect(scoreAnalysisOutput(answer, [], golden)).toBe(false);
  });

  it.each([
    'Your runway is 12 months.',
    'That gives you about six months of runway.',
    'Runway: roughly 8.5 months.',
  ])('analysis-009: rejects a fabricated runway duration beside the disclaimer — %s', (claim) => {
    const golden = ANALYSIS_CASES.find((c) => c.id === 'analysis-009')!;
    expect(scoreAnalysisOutput(`${ANSWERS[golden.id]} ${claim}`, [], golden)).toBe(false);
  });

  // A figure given to a metric the results cannot supply fails, even when it
  // traces to another result (XIRR's -21.06% restated as the TWR).
  it.each([
    ['analysis-005', 'Your time-weighted return is -21.06%.'],
    ['analysis-005', 'TWR: -21.06%.'],
    ['analysis-001', 'Your time-weighted return was -11.70%.'],
    ['analysis-002', 'The time-weighted return is -11.70%.'],
    ['analysis-013', 'Time-weighted return comes to -21.06%.'],
    ['analysis-015', 'Your TWR is -11.70%.'],
    ['analysis-001', 'HDFC Bank is worth ₹40,000.'],
    ['analysis-003', 'HDFC Bank has a market value of ₹40,000.'],
    ['analysis-013', 'HDFC Bank current value ₹40,000.'],
    ['analysis-015', 'HDFC Bank is worth ₹40,000.'],
  ])('%s: rejects a figure for an unavailable metric beside the disclaimer — %s', (id, claim) => {
    const golden = ANALYSIS_CASES.find((c) => c.id === id)!;
    expect(scoreAnalysisOutput(ANSWERS[id]!, [], golden)).toBe(true);
    expect(scoreAnalysisOutput(`${ANSWERS[id]} ${claim}`, [], golden)).toBe(false);
  });

  // An answer that reverses the result's finding fails, though every figure traces.
  it.each([
    ['analysis-002', (a: string) => a.replace('unrealised loss', 'unrealised gain')],
    ['analysis-002', (a: string) => `${a} That was a realised loss.`],
    ['analysis-003', (a: string) => `${a} NIFTYBEES is valued using a current price.`],
    ['analysis-004', (a: string) => `${a} NIFTYBEES is valued using a current price.`],
    ['analysis-007', (a: string) => a.replace('over budget', 'under budget')],
    ['analysis-007', (a: string) => `${a.replace('over budget', 'under budget')} Nothing is over budget.`],
    ['analysis-007', (a: string) => `${a} All categories are within budget.`],
    ['analysis-010', (a: string) => `${a} Expenses rose this month.`],
    ['analysis-010', (a: string) => `${a} Savings fell this month.`],
    ['analysis-011', (a: string) => `${a} October spending was higher than September.`],
    ['analysis-012', (a: string) => `${a} Overall, net worth declined.`],
    ['analysis-014', (a: string) => a.replace('over budget', 'under budget')],
    ['analysis-014', (a: string) => `${a} Nothing is over budget.`],
  ])('%s: rejects an answer that reverses the result\'s finding', (id, edit) => {
    const golden = ANALYSIS_CASES.find((c) => c.id === id)!;
    const reversed = edit(ANSWERS[id]!);
    expect(reversed).not.toBe(ANSWERS[id]);
    expect(scoreAnalysisOutput(reversed, [], golden)).toBe(false);
  });

  // A figure that belongs to another metric beside the disclaimer is not given to the missing one.
  it.each([
    ['analysis-005', 'Total return is -₹24,220; time-weighted return is unavailable (XIRR is -21.06%).'],
    ['analysis-005', 'Total return is -₹24,220. The time-weighted return is not available, but XIRR is -21.06%.'],
    ['analysis-005', 'Total return is -₹24,220, and the time-weighted return is unavailable: XIRR -21.06% is the money-weighted figure.'],
    ['analysis-004', 'HDFC Bank has no price, so its market value is unavailable (₹40,000 invested). NIFTYBEES is valued at ₹56,900 using a stale price.'],
    ['analysis-009', 'The runway is not available (no spend history of 3 months). HDFC Savings is ₹412,022.37.'],
  ])('%s: accepts a disclaimer with another metric\'s figure beside it — %s', (id, answer) => {
    const golden = ANALYSIS_CASES.find((c) => c.id === id)!;
    expect(scoreAnalysisOutput(answer, [], golden)).toBe(true);
  });

  // Every figure traces and every word is present, but a figure is given to the wrong metric.
  it.each([
    ['analysis-006', 'Income was ₹45,319.50, expenses were ₹120,812.37, savings were ₹75,492.87, and the savings rate was 62.49%.'],
    ['analysis-003', 'Equities total ₹56,900 (38.42%); ETFs total ₹91,200 (61.58%). HDFC Bank has no price, so the allocation excludes it.'],
    ['analysis-003', 'Equities total ₹91,200 (38.42%); ETFs total ₹56,900 (61.58%). HDFC Bank has no price, so the allocation excludes it.'],
    ['analysis-002', 'The realised gain is -₹30,912; the unrealised loss is ₹4,992, alongside total return -₹24,220.'],
    ['analysis-007', 'Food spending is ₹3,150 of its ₹10,000 budget, leaving ₹4,960. Dining spending is ₹5,040 against ₹2,500, so it is ₹650 over budget.'],
    ['analysis-008', 'HDFC Savings has ₹412,022.37; the HDFC Credit Card balance is -₹14,969.50. The Home loan has ₹24,500 outstanding with an EMI of ₹2,412,345.67.'],
    ['analysis-012', 'At cost basis, net worth rose from June’s ₹7,409,692 to July’s ₹7,404,700, August’s ₹7,494,242 and September’s ₹8,017,389.20.'],
    ['analysis-013', 'At cost, net worth was ₹148,100. Portfolio market value was ₹8,107,349.20 and total return was -₹24,220. The portfolio valuation is partial: HDFC Bank is unpriced and NIFTYBEES has a stale price.'],
  ])('%s: rejects a figure given to the wrong metric — %s', (id, answer) => {
    const golden = ANALYSIS_CASES.find((c) => c.id === id)!;
    expect(scoreAnalysisOutput(answer, [], golden)).toBe(false);
  });

  it.each([
    ['analysis-006', 'Income: ₹1,20,812.37. Expenses: ₹45,319.50. Savings: ₹75,492.87, a savings rate of 62.49%.'],
    ['analysis-006', 'You earned ₹120,812.37 in income and had ₹45,319.50 of expenses, so savings were ₹75,492.87 — a 62.49% savings rate.'],
    ['analysis-014', 'September savings were ₹75,492.87. Dining is ₹650 over budget; the home loan outstanding is ₹2,412,345.67 with a ₹24,500 EMI.'],
  ])('%s: accepts the right figure for each metric in another wording — %s', (id, answer) => {
    const golden = ANALYSIS_CASES.find((c) => c.id === id)!;
    expect(scoreAnalysisOutput(answer, [], golden)).toBe(true);
  });

  it('analysis-007: food within budget beside dining over budget is the right finding, not a reversal', () => {
    const golden = ANALYSIS_CASES.find((c) => c.id === 'analysis-007')!;
    expect(scoreAnalysisOutput(`${ANSWERS['analysis-007']} Food is within its budget; dining is over budget, unlike food.`, [], golden)).toBe(true);
  });

  it('analysis-009: a denied runway duration is not a claim', () => {
    const golden = ANALYSIS_CASES.find((c) => c.id === 'analysis-009')!;
    expect(scoreAnalysisOutput(`${ANSWERS[golden.id]} I cannot say whether your runway is 12 months.`, [], golden)).toBe(true);
  });

  it('rejects a contradicted data limitation and any unnecessary follow-up tool call', () => {
    const golden = ANALYSIS_CASES[0]!;
    const unsupported = 'Portfolio market value is ₹148,100, with total return -₹24,220 (-11.70%). HDFC Bank has no price and NIFTYBEES is stale, but all prices are current and complete.';
    expect(scoreAnalysisOutput(unsupported, [], golden)).toBe(false);
    expect(scoreAnalysisOutput(ANSWERS[golden.id]!, [{ name: 'get_accounts', argumentsJson: '{}' }], golden)).toBe(false);
  });

  it('never counts toward tool-call correctness, with or without a call', () => {
    for (const testCase of analysisSuite()) {
      expect(testCase.checkToolCalls?.([])).toBeNull();
      expect(testCase.checkToolCalls?.([{ name: 'get_accounts', argumentsJson: '{}' }])).toBeNull();
    }
  });

  it('runs through the existing harness without a judge or live provider', async () => {
    const testCase = analysisSuite().find((c) => c.id === 'analysis-001')!;
    const provider: AiProvider = {
      key: 'offline-analysis-fixture',
      isConfigured: () => true,
      listModels: async () => ok([]),
      chat: async (request: ChatRequest) => ok({
        content: ANSWERS['analysis-001']!,
        toolCalls: [],
        reasoning: null,
        finishReason: 'stop',
        usage: { promptTokens: 0, completionTokens: 0 },
        model: request.model,
        latencyMs: 1,
      }),
    };
    const report = await evaluateModel(provider, 'fake/analysis', [testCase]);
    expect(report.cases[0]).toMatchObject({ passed: true, schemaValid: null, toolCallValid: null, errorClass: null });
  });
});
