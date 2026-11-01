import { describe, expect, it } from 'vitest';

import { capabilitiesFromEvaluations, type StoredEvaluation } from '@/server/ai-evaluations';
import { DECLARED_CAPABILITIES } from '@/server/ai/config/capabilities';
import { MODEL_SUITES, TIER_SUITES, type ModelSuite } from '@/server/ai/eval/runner';

/**
 * Stored measurements → measured capability entries (ADR-44). Pure: the rows
 * are built here, so these tests pin the rules — complete, current, fully
 * answered, declared — without a database.
 */

const TIER2 = 'nvidia/nemotron-3-super-120b-a12b';
const TIER1 = 'openai/gpt-oss-20b';

function row(model: string, suite: ModelSuite, over: Partial<StoredEvaluation> & { counts?: Partial<StoredEvaluation['detail']> } = {}): StoredEvaluation {
  const { counts, ...rest } = over;
  return {
    model,
    suite,
    evalVersion: MODEL_SUITES[suite].version,
    casesPassed: 9,
    p50LatencyMs: 1000,
    p95LatencyMs: 3000,
    runAt: new Date('2026-11-01T10:00:00Z'),
    detail: {
      answered: 10,
      unanswered: 0,
      schemaValid: 0,
      schemaApplicable: 0,
      toolCallValid: 9,
      toolCallApplicable: 10,
      failedCases: [],
      errors: {},
      ...counts,
    },
    ...rest,
  };
}

const fullTier2 = (over: Partial<StoredEvaluation> = {}) => TIER_SUITES[2].map((s) => row(TIER2, s, over));

describe('measured capability entries', () => {
  it('a model measured on every suite of its tier becomes measured, keeping its declared fields', () => {
    const measured = capabilitiesFromEvaluations(fullTier2());
    const entry = measured[TIER2]!;
    expect(entry.source).toBe('measured');
    expect(entry.toolCalling).toBe(DECLARED_CAPABILITIES[TIER2]!.toolCalling);
    expect(entry.contextTokens).toBe(DECLARED_CAPABILITIES[TIER2]!.contextTokens);
    expect(entry.scores).toMatchObject({ toolCallCorrectness: 0.9, retrievalGrounding: 0.9, injectionResistance: 0.9 });
    expect(entry.verifiedAt).toBe('2026-11-01T10:00:00.000Z');
  });

  it('combines exact counts across suites rather than averaging rates', () => {
    const rows = TIER_SUITES[1].map((s, i) =>
      row(TIER1, s, {
        counts:
          s === 'parse' || s === 'classify'
            ? { schemaValid: i === 0 ? 40 : 30, schemaApplicable: i === 0 ? 40 : 60, toolCallApplicable: 0, toolCallValid: 0 }
            : {},
      }),
    );
    // (40 + 30) / (40 + 60) = 0.70, not the 0.75 mean of 1.00 and 0.50.
    expect(capabilitiesFromEvaluations(rows)[TIER1]!.scores!.schemaAdherence).toBe(0.7);
  });

  it('an unmeasured score is 0, which fails every gate that needs it', () => {
    // Tier 2 is measured on tool suites only: nothing measured its schema adherence.
    expect(capabilitiesFromEvaluations(fullTier2())[TIER2]!.scores!.schemaAdherence).toBe(0);
  });

  it('a missing suite, an old suite version or an unanswered case leaves the declared entry', () => {
    expect(capabilitiesFromEvaluations(fullTier2().slice(1))).toEqual({});
    const stale = fullTier2().map((r, i) => (i === 0 ? { ...r, evalVersion: r.evalVersion - 1 } : r));
    expect(capabilitiesFromEvaluations(stale)).toEqual({});
    const partial = fullTier2().map((r, i) => (i === 0 ? { ...r, detail: { ...r.detail, unanswered: 1 } } : r));
    expect(capabilitiesFromEvaluations(partial)).toEqual({});
  });

  it('a model with no declared entry is not routable on a measurement alone', () => {
    const rows = TIER_SUITES[2].map((s) => row('z-ai/glm-5.3-flash', s));
    expect(capabilitiesFromEvaluations(rows)).toEqual({});
  });

  it('latency is the slowest suite, and the entry is as old as its oldest row', () => {
    const rows = fullTier2().map((r, i) =>
      i === 1 ? { ...r, p50LatencyMs: 5000, runAt: new Date('2026-10-30T00:00:00Z') } : r,
    );
    const entry = capabilitiesFromEvaluations(rows)[TIER2]!;
    expect(entry.scores!.p50LatencyMs).toBe(5000);
    expect(entry.verifiedAt).toBe('2026-10-30T00:00:00.000Z');
  });
});
