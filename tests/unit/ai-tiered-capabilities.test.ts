import { describe, expect, it } from 'vitest';
import { capabilitiesFromEvaluations, tierCapabilitiesFromEvaluations, type StoredEvaluation } from '@/server/ai-evaluations';
import { createCapabilityMatrix, DECLARED_CAPABILITIES } from '@/server/ai/config/capabilities';
import { resolveModelConfig, type Tier } from '@/server/ai/config/models';
import { DEFAULT_REQUEST_PROFILE, requestProfileIdentity } from '@/server/ai/config/request-profiles';
import { maxTokensFor, MODEL_SUITES, TIER_SUITES } from '@/server/ai/eval/runner';
import { requirementFor } from '@/server/ai/orchestrator/requirements';
import { selectCandidates } from '@/server/ai/orchestrator/select';
import { createHealthRegistry } from '@/server/ai/orchestrator/breaker';

const MODEL = 'openai/gpt-oss-120b';
const PROVIDER = 'https://api.deepinfra.com/v1/openai';
const NOW = new Date('2026-11-07T10:00:00Z');
const config = resolveModelConfig({ tier1: MODEL, tier2: MODEL, tier3: MODEL, tier4: MODEL });
function rows(tier: Tier, good = true): StoredEvaluation[] {
  return TIER_SUITES[tier].map(suite => {
    const n = MODEL_SUITES[suite].build().length;
    const schema = ['parse', 'classify', 'document'].includes(suite) ? n : 0;
    const tools = ['tool-select', 'injection'].includes(suite) ? n : 0;
    return { model: MODEL, tier, suite, evalVersion: MODEL_SUITES[suite].version, casesPassed: good ? n : 0, runAt: NOW, p50LatencyMs: 10, p95LatencyMs: 20,
      detail: { providerIdentity: PROVIDER, requestProfile: requestProfileIdentity(DEFAULT_REQUEST_PROFILE), maxTokens: maxTokensFor(tier, suite),
        answered: n, unanswered: 0, schemaApplicable: schema, schemaValid: good ? schema : 0, toolCallApplicable: tools, toolCallValid: good ? tools : 0, failedCases: [], errors: {} } };
  });
}
const load = (r: StoredEvaluation[], provider: string | undefined = PROVIDER) => tierCapabilitiesFromEvaluations(r, undefined, undefined, provider);
const select = (r: StoredEvaluation[], capability: Parameters<typeof requirementFor>[0]) => {
  const matrix = createCapabilityMatrix({}, load(r));
  return selectCandidates(requirementFor(capability), config, matrix, createHealthRegistry(), NOW);
};

describe('independent tier measurements', () => {
  it('can serve Tier 2 on its own evidence while the same model fails Tier 1', () => {
    const input = [...rows(1, false), ...rows(2)];
    const measured = load(input);
    expect(measured[MODEL]?.[1]?.scores?.toolCallCorrectness).toBe(0);
    expect(measured[MODEL]?.[2]?.scores?.toolCallCorrectness).toBe(1);
    expect(select(input, 'answerFinanceQuestion').candidates).toEqual([]);
    expect(select(input, 'analyzePortfolio').candidates).toEqual([MODEL]);
    expect(DECLARED_CAPABILITIES[MODEL]?.tier).toBe(1);
  });

  it('never inherits a higher/lower tier or changes default lookup and routing', () => {
    const matrix = createCapabilityMatrix({}, load(rows(2)));
    expect(matrix.get(MODEL)).toMatchObject({ tier: 1, source: 'declared' });
    expect(matrix.get(MODEL, 2)).toMatchObject({ tier: 2, source: 'measured' });
    expect(select(rows(2), 'deepInvestigation').excluded).toEqual([{ modelId: MODEL, reason: 'tier_mismatch' }]);
    expect(select(rows(3), 'analyzePortfolio').candidates).toEqual([]);
    expect(selectCandidates(requirementFor('analyzePortfolio'), resolveModelConfig(), matrix, createHealthRegistry(), NOW).candidates).toEqual([]);
  });

  it('cannot complete a tier using a suite from another tier or provider', () => {
    const own = rows(2);
    expect(load([...own.slice(1), rows(3)[0]!])[MODEL]?.[2]).toBeUndefined();
    const foreign = { ...own[0]!, detail: { ...own[0]!.detail, providerIdentity: 'https://api.groq.com/openai/v1' } };
    expect(load([...own.slice(1), foreign])[MODEL]?.[2]).toBeUndefined();
    expect(tierCapabilitiesFromEvaluations(own)).toEqual({});
  });

  it.each([1, 2, 3, 4] as const)('cannot turn complete Tier %s OpenRouter host rows into endpoint-scoped eligibility', tier => {
    const endpoint = 'https://openrouter.ai/api/v1';
    const original = rows(tier);
    expect(load(original)[MODEL]?.[tier]?.source).toBe('measured');
    const forged = original.map(row => ({ ...row, detail: { ...row.detail, providerIdentity: endpoint,
      servingHost: 'DeepInfra', requestPolicyFingerprint: 'host-attributed-but-not-approved' } }));
    expect(load(forged, endpoint)).toEqual({});
    expect(load(forged)).toEqual({});
  });

  it.each([
    [1, 'tool-select', 2], [1, 'grounding', 3], [1, 'grounding', 4], [1, 'robustness', 3], [1, 'robustness', 4],
    [1, 'injection', 2], [1, 'injection', 3], [2, 'analysis', 3], [2, 'analysis', 4], [4, 'document', 1],
  ] as const)('Tier %s cannot activate with the previous %s prompt contract (v%s)', (tier, suite, previous) => {
    const current = rows(tier);
    expect(load(current)[MODEL]?.[tier]?.source).toBe('measured');
    const old = current.map(r => r.suite === suite ? { ...r, evalVersion: previous } : r);
    expect(load(old)[MODEL]?.[tier]).toBeUndefined();
  });

  it.each([
    ['wrong budget', (r: StoredEvaluation) => ({ ...r, detail: { ...r.detail, maxTokens: 8192 } })],
    ['missing budget', (r: StoredEvaluation) => ({ ...r, detail: { ...r.detail, maxTokens: undefined } })],
    ['partial corpus', (r: StoredEvaluation) => ({ ...r, casesPassed: 0, detail: { ...r.detail, answered: r.detail.answered - 1 } })],
    ['unanswered', (r: StoredEvaluation) => ({ ...r, detail: { ...r.detail, unanswered: 1 } })],
    ['old version', (r: StoredEvaluation) => ({ ...r, evalVersion: r.evalVersion - 1 })],
    ['invalid count', (r: StoredEvaluation) => ({ ...r, detail: { ...r.detail, toolCallValid: r.detail.toolCallApplicable + 1 } })],
    ['undersampled tools', (r: StoredEvaluation) => ({ ...r, detail: { ...r.detail, toolCallApplicable: 1, toolCallValid: 1 } })],
    ['foreign profile', (r: StoredEvaluation) => ({ ...r, detail: { ...r.detail, requestProfile: { id: 'default-v1', fingerprint: 'forged' } } })],
  ] as const)('rejects %s evidence for a new tier', (_label, mutate) => {
    const own = rows(2);
    expect(load([mutate(own[0]!), ...own.slice(1)])[MODEL]?.[2]).toBeUndefined();
  });

  it('does not revive an older passing row when the latest matching measurement has a wrong budget', () => {
    const own = rows(2);
    const newer = { ...own[0]!, runAt: new Date('2026-11-08'), detail: { ...own[0]!.detail, maxTokens: 8192 } };
    expect(load([...own, newer])[MODEL]?.[2]).toBeUndefined();
  });

  it('does not accept undersampled schema scores or pad the tool gate with analysis answers', () => {
    const own = rows(1);
    const undersampled = { ...own[0]!, detail: { ...own[0]!.detail, schemaApplicable: 1, schemaValid: 1 } };
    expect(load([undersampled, ...own.slice(1)])[MODEL]?.[1]).toBeUndefined();
    const padded = rows(2).map(r => r.suite === 'analysis' ? { ...r, detail: { ...r.detail, toolCallApplicable: r.detail.answered, toolCallValid: r.detail.answered } } : r);
    expect(load(padded)[MODEL]?.[2]).toBeUndefined();
  });

  it('cannot grant a physical capability or a score threshold that was not met', () => {
    expect(select(rows(4), 'extractReceiptData').excluded[0]?.reason).toBe('vision_unsupported');
    expect(select(rows(2, false), 'analyzePortfolio').excluded[0]?.reason).toBe('below_tool_threshold');
  });

  it('refuses unknown models and malformed tier-map entries', () => {
    expect(tierCapabilitiesFromEvaluations(rows(2), {}, undefined, PROVIDER)).toEqual({});
    const good = load(rows(2))[MODEL]![2]!;
    const matrix = createCapabilityMatrix({}, { [MODEL]: { 2: { ...good, tier: 3 }, 3: undefined }, unknown: { 2: good } });
    expect(matrix.get(MODEL, 2)?.source).toBe('declared');
    expect(matrix.get('unknown', 2)).toBeUndefined();
    expect(matrix.staleEntries(NOW)).toEqual([]);
  });

  it('retains the active request-profile check for tier-scoped selection', () => {
    const good = load(rows(2))[MODEL]![2]!;
    const matrix = createCapabilityMatrix({}, { [MODEL]: { 2: { ...good, requestProfile: { id: 'default-v1', fingerprint: 'forged' } } } });
    const result = selectCandidates(requirementFor('analyzePortfolio'), config, matrix, createHealthRegistry(), NOW);
    expect(result.candidates).toEqual([]);
    expect(result.excluded[0]?.reason).toBe('request_profile_mismatch');
  });

  it('reports staleness in a measured non-default tier without duplicating model ids', () => {
    const old = [...rows(2), ...rows(3)].map(r => ({ ...r, runAt: new Date('2026-09-01') }));
    expect(createCapabilityMatrix({}, load(old)).staleEntries(NOW)).toEqual([MODEL]);
  });

  it('keeps the declared-tier compatibility conversion isolated', () => {
    expect(capabilitiesFromEvaluations(rows(2), undefined, undefined, PROVIDER)).toEqual({});
    expect(capabilitiesFromEvaluations(rows(1), undefined, undefined, PROVIDER)[MODEL]?.tier).toBe(1);
  });
});
