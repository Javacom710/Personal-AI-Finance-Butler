import { describe, expect, it } from 'vitest';

import { ok } from '@/lib/result';
import { evaluateModel, renderReport } from '@/server/ai/eval/harness';
import { GROUNDING_CALLS, GROUNDING_TODAY } from '@/server/ai/eval/tasks/grounding-calls';
import {
  GROUNDING_CASES,
  GROUNDING_RESULTS,
  GROUNDING_SUITE_VERSION,
  groundingMessages,
  groundingSuite,
  scoreGrounding,
  scoreGroundingAnswer,
  statedFigures,
  traceableValues,
  type Figure,
  type GroundingGoldenCase,
} from '@/server/ai/eval/tasks/grounding';
import { findTool } from '@/server/ai/tools/registry';
import type { AiProvider, ChatRequest, ToolCall } from '@/server/ai/provider/types';

/**
 * The `grounding` golden corpus (AI-SYSTEM.md §14). No model runs here: these
 * tests prove the corpus is coherent — every expected figure is in the results
 * the model is given, a correct answer passes, and each known wrong answer
 * (a parent's own row, a sum of rows, summed levels, an untraceable figure,
 * a missing basis, an unavailable metric reported as zero) fails.
 *
 * That the frozen results are the engine's output is proved against a database
 * in `tests/integration/ai-eval-grounding.test.ts`.
 */

const byId = (id: number): GroundingGoldenCase =>
  GROUNDING_CASES.find((c) => c.id === `grounding-${String(id).padStart(3, '0')}`)!;

const answer = (id: number, text: string) => scoreGroundingAnswer(text, byId(id));
const call = (name: string, args: Record<string, unknown> = {}) => ({ name, argumentsJson: JSON.stringify(args) });

/** "8640.50" → "₹8,640.50"; a rate → "62.49%". */
function render(figure: Figure): string {
  if ('rate' in figure) return `${(Number(figure.rate) * 100).toFixed(2)}%`;
  const [whole, fraction] = figure.money.split('.');
  const grouped = Number(whole).toLocaleString('en-IN');
  return `₹${grouped}${fraction ? `.${fraction.padEnd(2, '0')}` : ''}`;
}

/** An answer that states each required figure and says each required thing. */
function exemplar(c: GroundingGoldenCase): string {
  const figures = c.required.map((anyOf) => render(anyOf[0]!)).join(', ');
  const mentions: Record<string, string> = {
    '/housing/i': 'Housing',
    '/HDFC Savings/i': 'HDFC Savings',
    '/dining/i': 'Dining',
    '/\\bcost\\b/i': 'at cost',
    '/market/i': 'at market value',
    '/HDFC ?BANK/i': 'HDFC Bank is excluded because it has no price',
  };
  const words = c.mentions.map((m) => mentions[String(m)] ?? 'it is unavailable: insufficient price history');
  return `From your records: ${figures}. ${words.join('; ')}.`.trim();
}

describe('grounding corpus — shape', () => {
  it('has the 25 cases AI-SYSTEM.md §14 specifies, with unique sequential ids', () => {
    expect(GROUNDING_CASES).toHaveLength(25);
    expect(GROUNDING_CASES.map((c) => c.id)).toEqual(
      GROUNDING_CASES.map((_, n) => `grounding-${String(n + 1).padStart(3, '0')}`),
    );
    expect(GROUNDING_SUITE_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('includes "how much did I spend on food last month" over the Food → {Groceries, Dining} tree', () => {
    const food = GROUNDING_CASES.filter((c) => c.question === 'How much did I spend on food last month?');
    expect(food.map((c) => c.calls[0])).toEqual(['expenseSepRollup', 'expenseSepDetail']);
    const detail = GROUNDING_RESULTS.expenseSepDetail as { data: { rows: { label: string }[] } };
    expect(detail.data.rows.map((r) => r.label)).toEqual(
      expect.arrayContaining(['Food', 'Food › Groceries', 'Food › Dining']),
    );
  });

  it('freezes a successful result for every call, and every call is one dispatch accepts', () => {
    expect(Object.keys(GROUNDING_RESULTS).sort()).toEqual(Object.keys(GROUNDING_CALLS).sort());
    for (const [key, spec] of Object.entries(GROUNDING_CALLS)) {
      expect(findTool(spec.tool)?.input.safeParse(spec.args).success, key).toBe(true);
      expect((GROUNDING_RESULTS[key as keyof typeof GROUNDING_CALLS] as { ok: boolean }).ok, key).toBe(true);
    }
  });

  it('every required and forbidden figure is decided by the results the case is given', () => {
    for (const c of GROUNDING_CASES) {
      const values = traceableValues(c.calls.map((k) => GROUNDING_RESULTS[k]));
      const inResults = (f: Figure) =>
        'rate' in f ? values.rates.some((r) => Number(r) === Number(f.rate)) : values.numbers.some((n) => Math.abs(Number(n)) === Number(f.money));
      // A required figure the model was not given could only be guessed or computed.
      for (const anyOf of c.required) expect(anyOf.some(inResults), `${c.id} requires ${JSON.stringify(anyOf)}`).toBe(true);
      // A forbidden figure that is in the results is a figure the answer may legitimately state.
      for (const f of c.forbidden) if (!('rate' in f && f.rate === '0')) expect(inResults(f), `${c.id} forbids ${JSON.stringify(f)}`).toBe(false);
    }
  });

  it('every follow-up case names a call its results cannot answer, and nothing it could', () => {
    const followUps = GROUNDING_CASES.filter((c) => c.followUp);
    expect(followUps.map((c) => c.id)).toEqual(['grounding-002', 'grounding-004']);
    for (const c of followUps) expect(c.required).toEqual([]);
  });

  it('replays the call and its result as the model would see them', () => {
    const messages = groundingMessages(byId(1));
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    expect(messages[0]!.content).toContain(GROUNDING_TODAY);
    expect(messages[2]!.toolCalls?.[0]).toEqual({
      id: 'call_1',
      name: 'get_expense_summary',
      argumentsJson: JSON.stringify(GROUNDING_CALLS.expenseSepRollup.args),
    });
    expect(messages[3]!.toolCallId).toBe('call_1');
    expect(JSON.parse(messages[3]!.content)).toEqual(GROUNDING_RESULTS.expenseSepRollup);
  });
});

describe('grounding scorer — stated figures', () => {
  it('reads Indian grouping, lakh and crore, and percentages', () => {
    const figures = statedFigures('₹81,07,349.20, Rs. 8,640.50, INR 410000, ₹24.12 lakh, ₹1.05 crore and 62.5%');
    expect(figures.map((f) => [f.kind, f.digits, f.places, f.shift])).toEqual([
      ['money', 810734920n, 2, 0],
      ['money', 864050n, 2, 0],
      ['money', 410000n, 0, 0],
      ['money', 2412n, 2, 5],
      ['money', 105n, 2, 7],
      ['percent', 625n, 1, 0],
    ]);
  });

  it('dates, years and small whole numbers are not figures', () => {
    expect(statedFigures('On 2026-09-30, 30 September 2026, across 3 accounts and 12 months.')).toEqual([]);
  });

  it('a number in a table without a currency sign is still a figure', () => {
    expect(statedFigures('| Food | 8,640.50 |').map((f) => f.digits)).toEqual([864050n]);
  });
});

describe('grounding scorer — answers', () => {
  it.each(GROUNDING_CASES.filter((c) => !c.followUp).map((c) => [c.id, c] as const))(
    '%s: an answer stating the required figures passes',
    (_, c) => {
      const verdict = scoreGroundingAnswer(exemplar(c), c);
      expect(verdict, exemplar(c)).toMatchObject({ passed: true });
    },
  );

  it('accepts rounding to the rupee and rejects truncation', () => {
    expect(answer(1, 'You spent ₹8,640.50 on food.').passed).toBe(true);
    expect(answer(1, 'You spent ₹8,641 on food.').passed).toBe(true);
    expect(answer(1, 'You spent ₹8,640 on food.').passed).toBe(false);
  });

  it('a lakh figure traces, but does not state the amount to the rupee', () => {
    expect(answer(18, 'Your net worth at cost is ₹81.07 lakh.').missing).toHaveLength(1);
    expect(answer(18, 'Your net worth at cost is ₹81,07,349.20 (about ₹81.07 lakh).').passed).toBe(true);
  });

  it("the parent's own row is not its total, and neither are its children", () => {
    expect(answer(1, 'You spent ₹800 on food.').passed).toBe(false);
    expect(answer(1, 'Food: ₹8,640.50, of which ₹7,840.50 was groceries and dining.').forbidden).toEqual(['7840.50']);
  });

  it('a detail breakdown cannot answer a parent total in prose, only by a rollup call', () => {
    const detail = byId(2);
    expect(scoreGroundingAnswer('Food came to ₹8,640.50.', detail)).toMatchObject({ passed: false, untraceable: ['₹8,640.50'] });
    expect(scoreGroundingAnswer('Food ₹800, Groceries ₹4,230.50, Dining ₹3,610.', detail).passed).toBe(false);
    expect(scoreGrounding(null, [call('get_expense_summary', { asOf: '2026-09-15' })], detail)).toBe(true);
    expect(scoreGrounding(null, [call('get_expense_summary', { asOf: '2026-09-15', depth: 'rollup', groupBy: 'category' })], detail)).toBe(true);
    expect(scoreGrounding(null, [call('get_expense_summary', { asOf: '2026-09-15', depth: 'detail' })], detail)).toBe(false);
    expect(scoreGrounding(null, [call('get_expense_summary', { asOf: '2026-10-15' })], detail)).toBe(false);
  });

  it('a child missing from the rollup needs a detail call', () => {
    const groceries = byId(4);
    expect(scoreGrounding(null, [call('get_expense_summary', { asOf: '2026-09-01', depth: 'detail' })], groceries)).toBe(true);
    expect(scoreGrounding(null, [call('get_expense_summary', { asOf: '2026-09-01' })], groceries)).toBe(false);
    expect(scoreGroundingAnswer('Groceries were part of Food, ₹8,640.50.', groceries).passed).toBe(false);
  });

  it('a further call on a case its results already answer fails', () => {
    expect(scoreGrounding(null, [call('get_expense_summary', { asOf: '2026-09-15' })], byId(1))).toBe(false);
  });

  it('two categories are reported side by side, never summed', () => {
    expect(answer(7, 'Food ₹8,640.50 and transport ₹3,240.').passed).toBe(true);
    expect(answer(7, 'Food ₹8,640.50 and transport ₹3,240, together ₹11,880.50.')).toMatchObject({
      passed: false,
      forbidden: ['11880.50'],
    });
  });

  it('overlapping tag rows are never added', () => {
    expect(answer(10, 'reimbursable ₹8,859 and goa-trip ₹5,600; they overlap.').passed).toBe(true);
    expect(answer(10, 'reimbursable ₹8,859 and goa-trip ₹5,600, so ₹14,459 in all.').passed).toBe(false);
  });

  it('a figure the model computed is untraceable, however plausible', () => {
    // September − October spending: true arithmetic, but no tool returned it.
    expect(answer(14, 'This month ₹30,040 against ₹45,319.50 last month: ₹15,279.50 less.').passed).toBe(true);
    expect(answer(14, 'This month ₹30,040 against ₹45,319.50 last month: ₹15,280 less.').passed).toBe(true);
    expect(answer(14, 'This month ₹30,040 against ₹45,319.50 last month: 33.7% less.')).toMatchObject({
      passed: false,
      untraceable: ['33.7%'],
    });
    expect(answer(16, 'Your HDFC Savings balance is ₹4,12,022.37, up ₹2,62,022.37 this year.').untraceable).toEqual(['₹2,62,022.37']);
  });

  it('net-worth levels are reported, not summed, and the basis is stated', () => {
    const levels = 'At cost: June ₹74,04,700, July ₹74,09,692, August ₹74,94,242, September ₹80,17,389.20.';
    expect(answer(20, levels).passed).toBe(true);
    expect(answer(20, `${levels} Total ₹3,03,26,023.20.`).forbidden).toEqual(['30326023.20']);
    expect(answer(20, levels.replace('At cost: ', '')).unmentioned).toEqual(['/\\bcost\\b/i']);
    expect(answer(18, 'Your net worth is ₹81,07,349.20.').unmentioned).toHaveLength(1);
  });

  it('the market figure names what it leaves out', () => {
    expect(answer(19, 'At market value your net worth is ₹80,76,437.20.').passed).toBe(false);
    expect(answer(19, 'At market value your net worth is ₹80,76,437.20; HDFCBANK has no price and is excluded.').passed).toBe(true);
  });

  it('an unavailable metric is never zero', () => {
    expect(answer(24, 'Time-weighted return is unavailable: there is not enough price history.').passed).toBe(true);
    expect(answer(24, 'Your time-weighted return is 0%.').passed).toBe(false);
    expect(answer(24, 'TWR is unavailable, so call it 0%.').forbidden).toEqual(['0 (rate)']);
  });

  it('a percentage rounds from the engine rate at any precision', () => {
    expect(answer(12, 'Your savings rate was 62.49%.').passed).toBe(true);
    expect(answer(12, 'Your savings rate was 62%.').passed).toBe(true);
    expect(answer(12, 'Your savings rate was 63%.').passed).toBe(false);
    expect(answer(25, 'ETFs are 38.4% of your priced portfolio.').passed).toBe(true);
  });

  it('a credit-card balance is stated as an amount owed, either sign', () => {
    expect(answer(17, 'You owe ₹14,969.50 on the card.').passed).toBe(true);
    expect(answer(17, 'The card balance is -₹14,969.50.').passed).toBe(true);
  });

  it('an empty answer fails', () => {
    expect(answer(5, '').passed).toBe(false);
    expect(scoreGrounding(null, [], byId(5))).toBe(false);
  });
});

describe('grounding suite — through the harness', () => {
  function provider(reply: (request: ChatRequest) => { content: string | null; toolCalls?: ToolCall[] }): AiProvider {
    return {
      id: 'stub',
      chat: async (request: ChatRequest) => {
        const r = reply(request);
        return ok({ content: r.content, toolCalls: r.toolCalls ?? [], finishReason: 'stop', usage: null, latencyMs: 1, modelId: request.model });
      },
    } as unknown as AiProvider;
  }

  it('reports retrievalGrounding, and a prose answer does not count as a tool call', async () => {
    const suite = groundingSuite();
    const answers = new Map(GROUNDING_CASES.map((c) => [c.question + c.calls.join(), exemplar(c)]));
    const report = await evaluateModel(
      provider((request) => {
        const user = request.messages.find((m) => m.role === 'user')!.content;
        const tool = request.messages.find((m) => m.role === 'tool')!.content;
        const golden = GROUNDING_CASES.find((c) => c.question === user && JSON.stringify(GROUNDING_RESULTS[c.calls[0]!]) === tool)!;
        if (golden.followUp) {
          const depth = golden.id === 'grounding-004' ? { depth: 'detail' } : {};
          return { content: null, toolCalls: [{ id: 'x', name: 'get_expense_summary', argumentsJson: JSON.stringify({ asOf: '2026-09-15', ...depth }) }] };
        }
        return { content: answers.get(golden.question + golden.calls.join())! };
      }),
      'stub-model',
      suite,
    );
    expect(report.retrievalGrounding).toBe(1);
    // Only the two follow-up calls are judged as tool calls.
    expect(report.cases.filter((r) => r.toolCallValid !== null)).toHaveLength(2);
    expect(report.toolCallCorrectness).toBe(1);
    expect(renderReport([report])).toContain('| 1.00 |');
  });

  it('a wrong answer lowers retrievalGrounding', async () => {
    const report = await evaluateModel(provider(() => ({ content: 'You spent ₹1,23,456.' })), 'stub-model', groundingSuite());
    expect(report.retrievalGrounding).toBe(0);
    expect(report.toolCallCorrectness).toBeNull();
  });
});
