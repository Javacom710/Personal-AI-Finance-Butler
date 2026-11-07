import { describe, expect, it } from 'vitest';
import { ANALYSIS_CASES, ANALYSIS_SUITE_VERSION, bindingHolds, scoreAnalysisOutput } from '@/server/ai/eval/tasks/analysis';
import { GROUNDING_CASES, GROUNDING_SUITE_VERSION, scoreGroundingAnswer, statedFigures } from '@/server/ai/eval/tasks/grounding';
import { ROBUSTNESS_SUITE_VERSION } from '@/server/ai/eval/tasks/robustness';
import { normalizeNumericPresentation } from '@/server/ai/eval/score';

const answer = 'Income was ₹120,812.37, expenses were ₹45,319.50, savings were ₹75,492.87, and the savings rate was 62.49%.';
const case6 = ANALYSIS_CASES.find(c => c.id === 'analysis-006')!;
const tex = (text: string) => text.replace(/,(?=\d)/g, '{,}').replace(/%/g, '\\%');

describe('numeric presentation preserves financial meaning', () => {
  it('is idempotent and leaves unrelated text, digits and unsupported TeX syntax intact', () => {
    const raw = String.raw`Text {,} stays, 12{,}345.67 becomes grouped, 62.49\% is a rate, and 1\,234 is untouched.`;
    const rendered = String.raw`Text {,} stays, 12,345.67 becomes grouped, 62.49% is a rate, and 1\,234 is untouched.`;
    expect(normalizeNumericPresentation(raw)).toBe(rendered);
    expect(normalizeNumericPresentation(rendered)).toBe(rendered);
  });
  it.each([
    answer,
    answer.replace('120,812.37', '1,20,812.37'),
    tex(answer),
    `$${tex(answer)}$`,
    `\\(${tex(answer)}\\)`,
  ])('accepts the same supported facts in plain, Indian, or LaTeX presentation: %s', text => {
    expect(scoreAnalysisOutput(text, [], case6)).toBe(true);
  });

  it('keeps all monetary digits, decimal places, signs and percent units', () => {
    const text = String.raw`-₹24{,}220, ₹1{,}20{,}812.37, -11.70\%`;
    expect(statedFigures(text).map(f => ({ kind: f.kind, digits: f.digits, places: f.places, negative: f.negative }))).toEqual([
      { kind: 'money', digits: 24220n, places: 0, negative: true },
      { kind: 'money', digits: 12081237n, places: 2, negative: false },
      { kind: 'percent', digits: 1170n, places: 2, negative: true },
    ]);
  });

  it.each([
    answer.replace('120,812.37', '120,812.38'),
    answer.replace('45,319.50', '45,319.49'),
    answer.replace('75,492.87', '-75,492.87'),
    answer.replace('62.49%', '63.49%'),
    answer.replace('62.49%', '-62.49%'),
    answer.replace('₹120,812.37', '₹45,319.50'),
    answer + ' An additional balance is ₹999,999.99.',
  ])('still rejects wrong, swapped or unsupported facts after LaTeX rendering: %s', wrong => {
    expect(scoreAnalysisOutput(tex(wrong), [], case6)).toBe(false);
  });

  it('does not let rendered text authorize an additional tool call', () => {
    expect(scoreAnalysisOutput(tex(answer), [{ name: 'get_accounts', argumentsJson: '{}' }], case6)).toBe(false);
  });

  it('uses rendered positions consistently when the figure precedes its metric', () => {
    const binding = { subject: /income/i, figures: [{ money: '120812.37' }] };
    expect(bindingHolds(String.raw`₹120{,}812.37 in income`, binding)).toBe(true);
    expect(bindingHolds(String.raw`₹45{,}319.50 in income`, binding)).toBe(false);
  });

  it('preserves exact grounding, rounding and rejection of computed totals', () => {
    const golden = GROUNDING_CASES.find(c => c.id === 'grounding-001')!;
    expect(scoreGroundingAnswer(String.raw`Food spending was ₹8{,}640.50.`, golden).passed).toBe(true);
    expect(scoreGroundingAnswer(String.raw`Food spending was ₹8{,}641.`, golden).passed).toBe(true);
    expect(scoreGroundingAnswer(String.raw`Food spending was ₹8{,}640.`, golden).passed).toBe(false);
    expect(scoreGroundingAnswer(String.raw`Food spending was ₹8{,}640.50 and the two totals add to ₹11{,}880.50.`, golden).passed).toBe(false);
  });

  it('retains unsupported-metric and sign checks through escaped percentages', () => {
    const golden = ANALYSIS_CASES.find(c => c.id === 'analysis-005')!;
    const supported = 'Total return is -₹24,220 and XIRR is -21.06%; time-weighted return is unavailable because of insufficient price history.';
    expect(scoreAnalysisOutput(tex(supported), [], golden)).toBe(true);
    expect(scoreAnalysisOutput(tex(supported + ' TWR is -21.06%.'), [], golden)).toBe(false);
    expect(scoreAnalysisOutput(tex(supported.replace('-₹24,220', '₹24,220')), [], golden)).toBe(false);
  });

  it('invalidates old scorer measurements for every affected suite', () => {
    expect([GROUNDING_SUITE_VERSION, ROBUSTNESS_SUITE_VERSION, ANALYSIS_SUITE_VERSION]).toEqual([4, 4, 4]);
  });
});
