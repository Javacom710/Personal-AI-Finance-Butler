import 'server-only';

/**
 * Candidate selection — the hard capability gate
 * ([AI-SYSTEM.md §6, §7](../../../../docs/AI-SYSTEM.md),
 * [ADR-18](../../../../docs/DECISIONS.md#adr-18--a-measured-capability-matrix-gates-routing-and-fallback)).
 *
 * ```
 * candidates(tier)
 *   .filter(has a capability entry at all)   ← no entry means unusable
 *   .filter(satisfies the requirement)       ← HARD GATE, never relaxed
 *   .filter(health.isAvailable)              ← circuit breaker
 *   .sort(measured score, then latency)
 * ```
 *
 * **The gate is applied before ordering, not during fallback.** That is what
 * makes an incapable model *unreachable* rather than merely deprioritised: by
 * the time `fallback.ts` walks the list, everything in it already satisfies the
 * requirement, so there is no ordering bug that could produce a downgrade. A
 * vision task cannot reach a text model; a schema task cannot reach a model that
 * cannot emit one.
 *
 * **Selection never reads user input.** It takes a requirement — computed from
 * the capability alone — and a configuration. Nothing a model or a user wrote
 * reaches this file, which is what stops injected text choosing its own model
 * (`SECURITY.md` §8).
 */

import type { CapabilityMatrix, ModelCapabilities, StructuredOutputSupport } from '../config/capabilities';
import type { ModelConfig } from '../config/models';
import type { CapabilityRequirement } from './requirements';
import type { HealthRegistry } from './breaker';

/** Why a model was excluded. Diagnostics — never shown to a model. */
export type ExclusionReason =
  | 'no_capability_entry'
  | 'tool_calling_unsupported'
  | 'structured_output_unsupported'
  | 'vision_unsupported'
  | 'unmeasured_score'
  | 'below_schema_threshold'
  | 'below_tool_threshold'
  | 'circuit_open';

export interface Excluded {
  readonly modelId: string;
  readonly reason: ExclusionReason;
}

export interface Selection {
  /** Ordered, every entry already satisfying the requirement. */
  readonly candidates: readonly string[];
  readonly excluded: readonly Excluded[];
}

/**
 * Structured-output modes, weakest to strongest. A requirement is satisfied by
 * its own mode or a stronger one — `json_schema` will serve a `json_object`
 * requirement, never the reverse.
 */
const OUTPUT_STRENGTH: Readonly<Record<StructuredOutputSupport, number>> = {
  none: 0,
  prompted: 1,
  json_object: 2,
  json_schema: 3,
};

function excludeReason(
  capabilities: ModelCapabilities,
  requirement: CapabilityRequirement,
): ExclusionReason | null {
  if (requirement.needsTools && capabilities.toolCalling !== 'native') {
    return 'tool_calling_unsupported';
  }
  if (
    OUTPUT_STRENGTH[capabilities.structuredOutput] <
    OUTPUT_STRENGTH[requirement.needsStructuredOutput]
  ) {
    return 'structured_output_unsupported';
  }
  if (requirement.needsVision && !capabilities.vision) {
    return 'vision_unsupported';
  }

  const wantsScores =
    requirement.minSchemaAdherence > 0 || requirement.minToolCallCorrectness > 0;

  if (wantsScores) {
    // A declared entry is a claim from documentation, not evidence. It can
    // serve a route with no threshold; it can never satisfy one.
    if (capabilities.source !== 'measured' || !capabilities.scores) return 'unmeasured_score';
    if (capabilities.scores.schemaAdherence < requirement.minSchemaAdherence) {
      return 'below_schema_threshold';
    }
    if (capabilities.scores.toolCallCorrectness < requirement.minToolCallCorrectness) {
      return 'below_tool_threshold';
    }
  }

  return null;
}

export function selectCandidates(
  requirement: CapabilityRequirement,
  config: ModelConfig,
  matrix: CapabilityMatrix,
  health: HealthRegistry,
  now: Date,
): Selection {
  const excluded: Excluded[] = [];
  const eligible: { modelId: string; capabilities: ModelCapabilities }[] = [];

  // Only this tier. Cross-tier downgrade is forbidden, so a lower tier's models
  // are not even considered — the list they would join is never built.
  for (const modelId of config.candidates(requirement.tier)) {
    const capabilities = matrix.get(modelId);
    if (!capabilities) {
      excluded.push({ modelId, reason: 'no_capability_entry' });
      continue;
    }
    const reason = excludeReason(capabilities, requirement);
    if (reason) {
      excluded.push({ modelId, reason });
      continue;
    }
    eligible.push({ modelId, capabilities });
  }

  // Health last: an unhealthy model is temporarily unavailable, not incapable,
  // and the distinction matters in the diagnostics.
  const available = eligible.filter((entry) => {
    if (health.isAvailable(entry.modelId, now)) return true;
    excluded.push({ modelId: entry.modelId, reason: 'circuit_open' });
    return false;
  });

  // Measured models first, then by the score that matters for this requirement,
  // then by latency. Configuration order breaks every remaining tie, so an
  // operator who wants a specific order gets one.
  const ordered = available
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => {
      const measured = Number(b.capabilities.source === 'measured') - Number(a.capabilities.source === 'measured');
      if (measured !== 0) return measured;

      const score = (c: ModelCapabilities): number =>
        requirement.needsTools
          ? (c.scores?.toolCallCorrectness ?? 0)
          : (c.scores?.schemaAdherence ?? 0);
      const byScore = score(b.capabilities) - score(a.capabilities);
      if (byScore !== 0) return byScore;

      const latency = (c: ModelCapabilities): number => c.scores?.p50LatencyMs ?? Number.MAX_SAFE_INTEGER;
      const byLatency = latency(a.capabilities) - latency(b.capabilities);
      if (byLatency !== 0) return byLatency;

      return a.index - b.index;
    })
    .map((entry) => entry.modelId);

  return { candidates: ordered, excluded };
}
