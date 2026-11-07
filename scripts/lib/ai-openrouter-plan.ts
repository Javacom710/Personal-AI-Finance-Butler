/** The owner's finite evaluation targets, independent of every production tier order. */
import { OPENROUTER_MEASUREMENT_MODELS } from '../../src/server/ai/config/models';
import { resolveRequestProfiles, requestProfileIdentity, type RequestProfiles } from '../../src/server/ai/config/request-profiles';
import { MODEL_SUITES, TIER_SUITES } from '../../src/server/ai/eval/runner';
import type { MeasurementTier, Workload } from './ai-openrouter-campaign';
export function openRouterWorkloads(visionModel: string, profiles: RequestProfiles = resolveRequestProfiles()): Workload[] {
  const targets: readonly [MeasurementTier, string][] = [[1, OPENROUTER_MEASUREMENT_MODELS.primary], [1, OPENROUTER_MEASUREMENT_MODELS.small], [2, OPENROUTER_MEASUREMENT_MODELS.primary], [3, OPENROUTER_MEASUREMENT_MODELS.primary], [4, visionModel]];
  return targets.flatMap(([tier, model]) => TIER_SUITES[tier].map(suite => ({ tier, model, suite, version: MODEL_SUITES[suite].version, profile: requestProfileIdentity(profiles.forModel(model)), cases: MODEL_SUITES[suite].build() })));
}
