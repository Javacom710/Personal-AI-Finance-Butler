import { describe, expect, it } from 'vitest';

import { capabilitiesFromEvaluations as convertEvaluations, evaluationProviderIdentity, type StoredEvaluation } from '@/server/ai-evaluations';
import { DECLARED_CAPABILITIES } from '@/server/ai/config/capabilities';
import { MODEL_SUITES, TIER_SUITES, type ModelSuite } from '@/server/ai/eval/runner';

/**
 * Stored measurements → measured capability entries (ADR-44). Pure: the rows
 * are built here, so these tests pin the rules — complete, current, fully
 * answered, declared — without a database.
 */

const PROVIDER = 'https://api.groq.com/openai/v1';
const capabilitiesFromEvaluations = (...args: Parameters<typeof convertEvaluations>) =>
  convertEvaluations(args[0], args[1], args[2], PROVIDER);

const TIER2 = 'nvidia/nemotron-3-super-120b-a12b';
const TIER1 = 'openai/gpt-oss-20b';

function row(model: string, suite: ModelSuite, over: Partial<StoredEvaluation> & { counts?: Partial<StoredEvaluation['detail']> } = {}): StoredEvaluation {
  const { counts, ...rest } = over;
  return {
    model,
    tier: DECLARED_CAPABILITIES[model]?.tier ?? 2,
    suite,
    evalVersion: MODEL_SUITES[suite].version,
    casesPassed: 9,
    p50LatencyMs: 1000,
    p95LatencyMs: 3000,
    runAt: new Date('2026-11-01T10:00:00Z'),
    detail: { providerIdentity: PROVIDER,
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

describe('stored tier provenance', () => {
  it.each([1, 3, 4, 0, 99])('cannot use tier %s rows to certify a declared Tier 2 model', tier => {
    expect(capabilitiesFromEvaluations(fullTier2({ tier }))).toEqual({});
  });

  it('rejects rows with no tier rather than guessing the declared tier', () => {
    const missing = fullTier2();
    missing.forEach(r => Reflect.deleteProperty(r, 'tier'));
    expect(capabilitiesFromEvaluations(missing)).toEqual({});
  });

  it('keeps newer other-tier results from shadowing the declared tier or completing its missing suite', () => {
    const own = fullTier2();
    const foreign = fullTier2({ tier: 3, runAt: new Date('2026-11-07') }).map(r => ({ ...r, casesPassed: 10, detail: { ...r.detail, toolCallValid: 10 } }));
    const measured = capabilitiesFromEvaluations([...foreign, ...own])[TIER2]!;
    expect(measured.verifiedAt).toBe('2026-11-01T10:00:00.000Z');
    expect(measured.scores?.toolCallCorrectness).toBe(0.9);
    expect(capabilitiesFromEvaluations([...own.slice(1), foreign[0]!])).toEqual({});
  });
});

describe('measured capability entries', () => {
  it('requires analysis for advanced tiers and loads document schema measurements for vision', () => {
    expect(capabilitiesFromEvaluations(fullTier2().filter((r) => r.suite !== 'analysis'))).toEqual({});
    const model = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning';
    const measured = capabilitiesFromEvaluations([row(model, 'document', {
      counts: { schemaValid: 19, schemaApplicable: 20, toolCallValid: 0, toolCallApplicable: 0 },
    })]);
    expect(measured[model]).toMatchObject({ source: 'measured', vision: true, scores: { schemaAdherence: 0.95 } });
  });

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

  it.each(['grounding', 'robustness', 'analysis'] as const)('does not authorize v3 routes using the old %s scorer', suite => {
    const old = fullTier2().map(r => r.suite === suite ? { ...r, evalVersion: 2 } : r);
    expect(capabilitiesFromEvaluations(old)).toEqual({});
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

describe('provider provenance', () => {
  it('keeps DeepInfra and Groq evidence separate even for identical model ids', () => {
    const endpoint = 'https://api.deepinfra.com/v1/openai';
    const groq = TIER_SUITES[1].map(s => row(TIER1, s));
    const deepinfra = groq.map(r => ({ ...r, detail: { ...r.detail, providerIdentity: endpoint } }));
    expect(convertEvaluations(groq, undefined, undefined, endpoint)).toEqual({});
    expect(convertEvaluations([...deepinfra.slice(1), groq[0]!], undefined, undefined, endpoint)).toEqual({});
    expect(convertEvaluations([...groq, ...deepinfra], undefined, undefined, endpoint)[TIER1]?.source).toBe('measured');
    expect(convertEvaluations(deepinfra, undefined, undefined, PROVIDER)).toEqual({});
    expect(evaluationProviderIdentity(endpoint + '/')).toBe(endpoint);
  });
  it('never authorizes missing, foreign or mixed-provider results', () => {
    const current = fullTier2();
    const foreign = current.map(r => ({ ...r, runAt: new Date('2026-11-02'), detail: { ...r.detail, providerIdentity: 'https://integrate.api.nvidia.com/v1' } }));
    const legacy = current.map(r => ({ ...r, detail: { ...r.detail, providerIdentity: undefined } }));
    expect(convertEvaluations(current)).toEqual({});
    expect(convertEvaluations(legacy, undefined, undefined, PROVIDER)).toEqual({});
    expect(convertEvaluations(foreign, undefined, undefined, PROVIDER)).toEqual({});
    expect(convertEvaluations([...current.slice(1), foreign[0]!], undefined, undefined, PROVIDER)).toEqual({});
    expect(convertEvaluations([...foreign, ...current], undefined, undefined, PROVIDER)[TIER2]?.source).toBe('measured');
  });

  it('normalizes endpoint identity without retaining credentials or query secrets', () => {
    expect(evaluationProviderIdentity('https://user:password@API.GROQ.COM:443/openai/v1/?key=secret#fragment')).toBe(PROVIDER);
    expect(evaluationProviderIdentity('https://api.groq.com/other/v1')).not.toBe(PROVIDER);
    expect(() => evaluationProviderIdentity('file:///tmp/key')).toThrow();
  });
});
