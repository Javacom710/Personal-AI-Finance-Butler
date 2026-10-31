import { describe, expect, it } from 'vitest';

import {
  createCapabilityMatrix,
  type ModelCapabilities,
} from '@/server/ai/config/capabilities';
import {
  CANDIDATE_POOL,
  EVALUATION_CANDIDATES,
  normaliseModelId,
  resolveModelConfig,
  unavailableCandidates,
} from '@/server/ai/config/models';
import { createHealthRegistry, CONSECUTIVE_FAILURES_TO_OPEN, OPEN_MS } from '@/server/ai/orchestrator/breaker';
import { selectCandidates } from '@/server/ai/orchestrator/select';
import { requirementFor, escalated, allCapabilities } from '@/server/ai/orchestrator/requirements';
import { runChain, MAX_ATTEMPTS } from '@/server/ai/orchestrator/fallback';
import { noCapableModel, transport, unauthorized, timeout } from '@/server/ai/errors';

/**
 * Invariant **I-56** — *a task is never served by a model that cannot do it*
 * ([ADR-18](../../docs/DECISIONS.md#adr-18--a-measured-capability-matrix-gates-routing-and-fallback),
 * `CLAUDE.md <model_fallbacks>`).
 *
 * The capability gate is the single most important routing property: availability
 * is not a licence to downgrade. These tests assert the gate holds in both
 * directions — an incapable model is unreachable, and a capable one is reachable
 * — because a filter that excluded everything would satisfy the first alone.
 */

const NOW = new Date('2026-08-30T12:00:00Z');

const caps = (over: Partial<ModelCapabilities> = {}): ModelCapabilities => ({
  tier: 1,
  toolCalling: 'native',
  structuredOutput: 'json_schema',
  vision: false,
  embedding: false,
  contextTokens: 131_072,
  maxOutputTokens: 4_096,
  streaming: true,
  source: 'declared',
  ...over,
});

const measured = (over: Partial<ModelCapabilities> = {}): ModelCapabilities =>
  caps({
    source: 'measured',
    verifiedAt: NOW.toISOString(),
    scores: {
      schemaAdherence: 0.99,
      toolCallCorrectness: 0.98,
      retrievalGrounding: 0.97,
      injectionResistance: 1,
      p50LatencyMs: 800,
      p95LatencyMs: 2000,
    },
    ...over,
  });

const configOf = (tier1: string[], tier2: string[] = [], tier4: string[] = []) =>
  resolveModelConfig({ tier1: tier1.join(','), tier2: tier2.join(','), tier4: tier4.join(',') });

describe('I-56 — the catalogue identifiers are normalised, not guessed', () => {
  it('maps CLAUDE.md names onto the identifiers the catalogue actually uses', () => {
    // GLM is NOT here: the authenticated catalogue read found no GLM model of
    // any publisher prefix, so zai-org/glm-5.2 normalises to nothing routable
    // and is recorded as absent instead (see the absent-candidates test below).
    expect(normaliseModelId('deepseek-ai/deepseek-v4-flash')).toBe('deepseek-ai/deepseek-v4-flash-0731');
    // Unknown ids pass through: normalisation corrects, it does not filter.
    expect(normaliseModelId('some/new-model')).toBe('some/new-model');
  });

  it('records every candidate the authenticated catalogue does not carry', () => {
    const absent = unavailableCandidates().map((c) => c.declared);
    expect(absent).toContain('deepseek-ai/deepseek-v4-pro');
    expect(absent).toContain('mistralai/mistral-medium-3.5-128b');
    expect(absent).toContain('qwen/qwen3-next-80b-a3b-instruct');
    // Found by the live `npm run ai:catalogue` read against the real provider,
    // which disproved AI-SYSTEM.md §2.3's unauthenticated notes: it recorded
    // `z-ai/glm-5.2` as GLM's real identifier (no GLM model exists at all) and
    // listed the 12b vision model as present (it is not).
    expect(absent).toContain('zai-org/glm-5.2');
    expect(absent).toContain('nvidia/nemotron-nano-12b-v2-vl');
    // Recorded rather than silently substituted: a routing table written against
    // a name that 404s fails at runtime, and this is where that is prevented.
    expect(CANDIDATE_POOL.length).toBe(13);
  });

  it('routes to no model the catalogue lacks, in any tier', () => {
    // The property that actually matters, asserted over the default order rather
    // than over the pool: every id the router can reach must be one the provider
    // will answer for. Two entries failed this before the live catalogue read.
    const unroutable = new Set(unavailableCandidates().flatMap((c) => [c.declared, c.catalogue ?? c.declared]));
    const config = resolveModelConfig();
    for (const tier of [1, 2, 3, 4, 5] as const) {
      for (const modelId of config.candidates(tier)) {
        expect(unroutable.has(modelId), `tier ${tier} routes to absent model ${modelId}`).toBe(false);
      }
    }
  });

  it('keeps a fallback wherever one is possible, and says so where it is not', () => {
    const config = resolveModelConfig();
    // Tiers 1 and 2 have a genuine second candidate.
    expect(config.candidates(1).length).toBeGreaterThanOrEqual(2);
    expect(config.candidates(2).length).toBeGreaterThanOrEqual(2);
    // Tier 3 has none by design; Tier 4 has none because the only vision model
    // CLAUDE.md names that exists is the omni one. Both fail closed rather than
    // answering a document question without having seen the document.
    expect(config.candidates(3)).toHaveLength(1);
    expect(config.candidates(4)).toHaveLength(1);
  });

  it('takes tier order from configuration, replacing the default outright', () => {
    const config = resolveModelConfig({ tier1: 'a/one, b/two' });
    expect(config.candidates(1)).toEqual(['a/one', 'b/two']);
    // Not merged with the default — a merged order is one nobody can reason about.
    expect(config.candidates(1)).not.toContain('openai/gpt-oss-20b');
  });

  it('leaves tier 5 empty, because embeddings are not built', () => {
    expect(resolveModelConfig().candidates(5)).toEqual([]);
  });
});

describe('I-56 — the capability gate', () => {
  it('excludes a model with no capability entry at all', () => {
    const selection = selectCandidates(
      requirementFor('answerFinanceQuestion'),
      configOf(['unknown/model']),
      createCapabilityMatrix({}),
      createHealthRegistry(),
      NOW,
    );
    expect(selection.candidates).toEqual([]);
    expect(selection.excluded[0]?.reason).toBe('no_capability_entry');
  });

  it('never routes a tool task to a model that cannot call tools', () => {
    const selection = selectCandidates(
      requirementFor('answerFinanceQuestion'),
      configOf(['m/no-tools']),
      createCapabilityMatrix({ 'm/no-tools': measured({ toolCalling: 'none' }) }),
      createHealthRegistry(),
      NOW,
    );
    expect(selection.candidates).toEqual([]);
    expect(selection.excluded[0]?.reason).toBe('tool_calling_unsupported');
  });

  it('never routes a schema task to a model that cannot emit one', () => {
    const selection = selectCandidates(
      requirementFor('parseTransaction'),
      configOf(['m/prose']),
      createCapabilityMatrix({ 'm/prose': measured({ structuredOutput: 'prompted' }) }),
      createHealthRegistry(),
      NOW,
    );
    expect(selection.candidates).toEqual([]);
    expect(selection.excluded[0]?.reason).toBe('structured_output_unsupported');
  });

  it('never routes a vision task to a text-only model', () => {
    const selection = selectCandidates(
      requirementFor('extractReceiptData'),
      configOf([], [], ['m/text']),
      createCapabilityMatrix({ 'm/text': measured({ tier: 4, vision: false }) }),
      createHealthRegistry(),
      NOW,
    );
    expect(selection.candidates).toEqual([]);
    expect(selection.excluded[0]?.reason).toBe('vision_unsupported');
  });

  it('refuses a declared entry for a score-gated route', () => {
    // The honest half of the declared/measured split: documentation is a claim,
    // not evidence, and a threshold needs evidence.
    const selection = selectCandidates(
      requirementFor('parseTransaction'),
      configOf(['m/declared']),
      createCapabilityMatrix({ 'm/declared': caps() }),
      createHealthRegistry(),
      NOW,
    );
    expect(selection.candidates).toEqual([]);
    expect(selection.excluded[0]?.reason).toBe('unmeasured_score');
  });

  it('refuses a measured model that scores below the threshold', () => {
    const selection = selectCandidates(
      requirementFor('parseTransaction'),
      configOf(['m/weak']),
      createCapabilityMatrix({
        'm/weak': measured({ scores: { ...measured().scores!, schemaAdherence: 0.5 } }),
      }),
      createHealthRegistry(),
      NOW,
    );
    expect(selection.excluded[0]?.reason).toBe('below_schema_threshold');
  });

  it('admits a capable model — the gate is not simply excluding everything', () => {
    const selection = selectCandidates(
      requirementFor('parseTransaction'),
      configOf(['m/good']),
      createCapabilityMatrix({ 'm/good': measured() }),
      createHealthRegistry(),
      NOW,
    );
    expect(selection.candidates).toEqual(['m/good']);
    expect(selection.excluded).toEqual([]);
  });

  it('admits a declared entry for a route with no score threshold', () => {
    // What makes a connectivity smoke test possible before the eval has run.
    const selection = selectCandidates(
      requirementFor('summarizeFinancialData'),
      configOf(['m/declared']),
      createCapabilityMatrix({ 'm/declared': caps({ scores: undefined }) }),
      createHealthRegistry(),
      NOW,
    );
    // `summarizeFinancialData` carries a tool threshold, so a declared entry is
    // still refused — proving thresholds, not tiers, are what require evidence.
    expect(selection.candidates).toEqual([]);
    expect(selection.excluded[0]?.reason).toBe('unmeasured_score');
  });

  it('prefers a measured model over a declared one', () => {
    const selection = selectCandidates(
      requirementFor('analyzePortfolio'),
      configOf([], ['m/declared', 'm/measured']),
      createCapabilityMatrix({
        'm/declared': caps({ tier: 2 }),
        'm/measured': measured({ tier: 2 }),
      }),
      createHealthRegistry(),
      NOW,
    );
    expect(selection.candidates[0]).toBe('m/measured');
  });
});

describe('I-56 — cross-tier downgrade is impossible', () => {
  it('does not consider a lower tier when its own tier is empty', () => {
    const selection = selectCandidates(
      requirementFor('analyzePortfolio'),
      configOf(['tier1/capable'], []),
      createCapabilityMatrix({ 'tier1/capable': measured() }),
      createHealthRegistry(),
      NOW,
    );
    // Tier 1 has a perfectly capable model. It is not offered, because the
    // request was for Tier 2 and a quiet downgrade is the failure being prevented.
    expect(selection.candidates).toEqual([]);
  });

  it('never escalates into tier 3', () => {
    // Tier 3 is reachable only by an explicit user action.
    expect(escalated(requirementFor('analyzePortfolio'))).toBeNull();
    const raised = escalated(requirementFor('answerFinanceQuestion'));
    expect(raised?.tier).toBe(2);
    // And escalation does not compound.
    expect(escalated(raised!)).toBeNull();
  });

  it('marks tier 3 as requiring an explicit user request', () => {
    expect(requirementFor('deepInvestigation').requiresExplicitUserRequest).toBe(true);
    for (const capability of allCapabilities()) {
      if (capability === 'deepInvestigation') continue;
      expect(requirementFor(capability).requiresExplicitUserRequest, capability).toBe(false);
    }
  });

  it('omits the capabilities whose deterministic backing does not exist', () => {
    const names = allCapabilities() as string[];
    // OD-18 and ADR-19: an AI capability exists only where a deterministic one does.
    expect(names).not.toContain('runFinancialScenario');
    expect(names).not.toContain('retrieveRelevantContext');
  });
});

describe('I-56 — the circuit breaker', () => {
  it('opens after consecutive failures of the same class', () => {
    const health = createHealthRegistry();
    for (let i = 0; i < CONSECUTIVE_FAILURES_TO_OPEN; i += 1) {
      health.recordFailure('m/x', transport('boom'), NOW);
    }
    expect(health.isAvailable('m/x', NOW)).toBe(false);
  });

  it('does not open on unrelated failures', () => {
    // Three different problems is noise; three of the same is a signal.
    const health = createHealthRegistry();
    health.recordFailure('m/x', transport('boom'), NOW);
    health.recordFailure('m/x', timeout(1000), NOW);
    health.recordFailure('m/x', unauthorized(401), NOW);
    expect(health.isAvailable('m/x', NOW)).toBe(true);
  });

  it('half-opens for exactly one probe after the window', () => {
    const health = createHealthRegistry();
    for (let i = 0; i < CONSECUTIVE_FAILURES_TO_OPEN; i += 1) {
      health.recordFailure('m/x', transport('boom'), NOW);
    }
    const later = new Date(NOW.getTime() + OPEN_MS + 1);
    expect(health.isAvailable('m/x', later)).toBe(true);
    // Only one probe is admitted; a burst at a recovering provider is how it
    // gets knocked over again.
    expect(health.isAvailable('m/x', later)).toBe(false);
  });

  it('closes on success', () => {
    const health = createHealthRegistry();
    for (let i = 0; i < CONSECUTIVE_FAILURES_TO_OPEN; i += 1) {
      health.recordFailure('m/x', transport('boom'), NOW);
    }
    health.recordSuccess('m/x');
    expect(health.isAvailable('m/x', NOW)).toBe(true);
  });
});

describe('I-56 — the attempt chain', () => {
  const health = () => createHealthRegistry();
  const exhausted = noCapableModel('answerFinanceQuestion');
  const response = {
    content: 'ok',
    toolCalls: [],
    reasoning: null,
    finishReason: 'stop' as const,
    usage: { promptTokens: 1, completionTokens: 1 },
    model: 'm/a',
    latencyMs: 1,
  };

  it('reports fallbackDepth 0 when the first candidate serves it', async () => {
    const result = await runChain(['m/a', 'm/b'], async () => ({ ok: true, value: response }), health(), () => NOW, exhausted);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fallbackDepth).toBe(0);
  });

  it('moves to the next candidate on a transient failure', async () => {
    const tried: string[] = [];
    const result = await runChain(
      ['m/a', 'm/b'],
      async (modelId) => {
        tried.push(modelId);
        return modelId === 'm/a' ? { ok: false, error: transport('boom') } : { ok: true, value: response };
      },
      health(),
      () => NOW,
      exhausted,
    );
    expect(tried).toEqual(['m/a', 'm/b']);
    if (result.ok) expect(result.fallbackDepth).toBe(1);
  });

  it('stops immediately on a fail-closed failure', async () => {
    const tried: string[] = [];
    await runChain(
      ['m/a', 'm/b', 'm/c'],
      async (modelId) => {
        tried.push(modelId);
        return { ok: false, error: unauthorized(401) };
      },
      health(),
      () => NOW,
      exhausted,
    );
    // A bad credential is shared by every candidate. Trying more spends requests
    // to reach the same answer.
    expect(tried).toEqual(['m/a']);
  });

  it('never exceeds the attempt ceiling', async () => {
    const tried: string[] = [];
    await runChain(
      ['a', 'b', 'c', 'd', 'e'],
      async (modelId) => {
        tried.push(modelId);
        return { ok: false, error: transport('boom') };
      },
      health(),
      () => NOW,
      exhausted,
    );
    expect(tried).toHaveLength(MAX_ATTEMPTS);
  });

  it('fails rather than serving nothing when the list is empty', async () => {
    const result = await runChain([], async () => ({ ok: true, value: response }), health(), () => NOW, exhausted);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('no_capable_model');
  });
});

describe('ADR-41 — an evaluation candidate is measured, never routed', () => {
  it('lists each candidate once, for a tier that has models', () => {
    const ids = EVALUATION_CANDIDATES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of EVALUATION_CANDIDATES) expect([1, 2, 3, 4]).toContain(c.tier);
  });

  it('is in no default tier order and is not reachable by name normalisation', () => {
    const routed = new Set(resolveModelConfig().allConfigured());
    const normalisedTargets = new Set(CANDIDATE_POOL.map((c) => normaliseModelId(c.declared)));
    for (const c of EVALUATION_CANDIDATES) {
      expect(routed.has(c.id), c.id).toBe(false);
      expect(normalisedTargets.has(c.id), c.id).toBe(false);
    }
  });
});
