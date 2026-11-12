import { describe, expect, it } from 'vitest';
import { MODEL_SUITES } from '@/server/ai/eval/runner';
import { answerFinanceQuestionSystemPrompt } from '@/server/ai/prompts/answer-finance-question';
import { analyzeDocumentSystemPrompt } from '@/server/ai/prompts/analyze-document';
import { parseTransactionSystemPrompt } from '@/server/ai/prompts/parse-transaction';
import { PARSE_CASES } from '@/server/ai/eval/tasks/parse';

// Prompt changes need a new measurement contract even when the scorer, corpus
// and provider controls remain identical. Every case must send the production
// prompt; a benchmark-only instruction would measure a different application.
describe('shared production prompt contracts', () => {
  const context = { today: '2026-10-15', baseCurrency: 'INR' };
  it.each(['tool-select', 'grounding', 'robustness', 'injection', 'analysis'] as const)(
    '%s sends the shared finance prompt on every first turn', suite => {
      for (const testCase of MODEL_SUITES[suite].build()) {
        expect(testCase.messages[0], testCase.id).toEqual({ role: 'system', content: answerFinanceQuestionSystemPrompt(context) });
      }
    },
  );
  it('sends the document prompt on every extraction case with no benchmark-only instructions', () => {
    for (const testCase of MODEL_SUITES.document.build()) {
      expect(testCase.messages[0], testCase.id).toEqual({ role: 'system', content: analyzeDocumentSystemPrompt(context) });
    }
  });
  it('sends the shared v3 parsing clarification with each case date and no model-specific instruction', () => {
    const cases = MODEL_SUITES.parse.build();
    for (const [index, testCase] of cases.entries()) {
      expect(testCase.messages[0]).toEqual({ role: 'system', content: parseTransactionSystemPrompt({ today: PARSE_CASES[index]!.today ?? '2026-08-09', baseCurrency: 'INR' }) });
    }
    const prompt = parseTransactionSystemPrompt(context);
    expect(prompt).toContain('For income, accountHint identifies the receiving account and toAccountHint is always null.');
    expect(prompt).toContain('A payee\'s name alone does not identify either of the user\'s own accounts.');
    expect(prompt).toContain('person without a purpose or ownership context, the kind is ambiguous');
    expect(prompt).toContain('multiple different candidate amounts');
    expect(prompt).toContain('lower confidence');
    expect(prompt).toContain('If no amount is stated, amount is null. Never estimate one.');
  });
  it('versions parsing while preserving every other suite contract', () => {
    expect(Object.fromEntries(Object.entries(MODEL_SUITES).map(([suite, definition]) => [suite, definition.version])))
      .toEqual({ parse: 3, classify: 2, 'tool-select': 3, grounding: 5, robustness: 5, injection: 4, analysis: 5, document: 2 });
  });
});
