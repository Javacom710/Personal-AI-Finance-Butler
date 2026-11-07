import { describe, expect, it } from 'vitest';
import { MODEL_SUITES } from '@/server/ai/eval/runner';
import { answerFinanceQuestionSystemPrompt } from '@/server/ai/prompts/answer-finance-question';
import { analyzeDocumentSystemPrompt } from '@/server/ai/prompts/analyze-document';

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
  it('versions all affected suites while preserving the unrelated parsing and category contracts', () => {
    expect(Object.fromEntries(Object.entries(MODEL_SUITES).map(([suite, definition]) => [suite, definition.version])))
      .toEqual({ parse: 2, classify: 2, 'tool-select': 3, grounding: 5, robustness: 5, injection: 4, analysis: 5, document: 2 });
  });
});
