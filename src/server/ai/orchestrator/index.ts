import 'server-only';

/**
 * The orchestrator — capability in, result out
 * ([AI-SYSTEM.md §6](../../../../docs/AI-SYSTEM.md)).
 *
 * ```
 * run(capability, input)
 *   ├─ requirements   capability ─────► CapabilityRequirement   (never from content)
 *   ├─ select         hard capability gate + circuit breaker
 *   ├─ fallback       ordered attempts, bounded, sideways only
 *   └─ observability  model, tier, latency, outcome, depth — no payloads
 * ```
 *
 * **Routing happens before any tool runs and before any content is read.** The
 * requirement comes from the capability alone, so nothing a user wrote and
 * nothing a model returned can change which model serves a request or which
 * tools are in play. That ordering *is* the injection defence
 * (`SECURITY.md` §8) — not a filter on the text.
 *
 * **The orchestrator holds no context and no capability.** It is given a
 * provider and a configuration. It cannot read financial data, so a bug here
 * cannot leak any; the tool layer below it holds the read capability, and only
 * the tool layer.
 */

import { err, ok, type Result } from '../../../lib/result';
import {
  noCapableModel,
  type AiFailure,
} from '../errors';
import type { AiProvider, ChatMessage, ChatRequest, ChatResponse, ToolDefinition } from '../provider/types';
import type { CapabilityMatrix } from '../config/capabilities';
import type { ModelConfig } from '../config/models';
import { runChain, type Attempt } from './fallback';
import { selectCandidates, type Excluded } from './select';
import { requirementFor, type AiCapability, type CapabilityRequirement } from './requirements';
import type { HealthRegistry } from './breaker';

export interface OrchestratorDeps {
  readonly provider: AiProvider;
  readonly config: ModelConfig;
  readonly matrix: CapabilityMatrix;
  readonly health: HealthRegistry;
  readonly now: () => Date;
  readonly defaultTimeoutMs: number;
}

export interface RunInput {
  readonly capability: AiCapability;
  readonly messages: readonly ChatMessage[];
  readonly tools?: readonly ToolDefinition[];
  /** Structured output name+schema; must match the capability's requirement. */
  readonly schema?: { readonly name: string; readonly schema: Record<string, unknown> };
  /** Tier 3 only: proof the user asked for it explicitly. */
  readonly explicitUserRequest?: boolean;
  readonly signal?: AbortSignal;
}

export interface RunOutput {
  readonly response: ChatResponse;
  readonly modelId: string;
  readonly tier: number;
  readonly fallbackDepth: number;
  readonly attempts: readonly Attempt[];
}

export interface Orchestrator {
  run(input: RunInput): Promise<Result<RunOutput, AiFailure>>;
  /** Diagnostics for Settings → AI. Never an input to a routing decision. */
  explain(capability: AiCapability): { requirement: CapabilityRequirement; candidates: readonly string[]; excluded: readonly Excluded[] };
}

export function createOrchestrator(deps: OrchestratorDeps): Orchestrator {
  function plan(requirement: CapabilityRequirement) {
    return selectCandidates(requirement, deps.config, deps.matrix, deps.health, deps.now());
  }

  return {
    explain(capability) {
      const requirement = requirementFor(capability);
      const selection = plan(requirement);
      return { requirement, candidates: selection.candidates, excluded: selection.excluded };
    },

    async run(input) {
      const requirement = requirementFor(input.capability);

      // The Tier 3 access rule, enforced here rather than trusted to callers.
      // Escalation cannot reach Tier 3 (see `escalated`), so this is the only
      // door, and it needs an explicit user action to open.
      if (requirement.requiresExplicitUserRequest && input.explicitUserRequest !== true) {
        return err(
          noCapableModel(
            input.capability,
            `${input.capability} is reachable only on an explicit user request. It is never entered by escalation.`,
          ),
        );
      }

      // A schema requirement with no schema supplied is a programming error, and
      // a silent prose answer would be the wrong way to report it.
      if (requirement.needsStructuredOutput !== 'none' && !input.schema) {
        return err(
          noCapableModel(input.capability, `${input.capability} requires a response schema; none was supplied.`),
        );
      }
      if (requirement.needsTools && !input.tools?.length) {
        return err(
          noCapableModel(input.capability, `${input.capability} requires tools; none were supplied.`),
        );
      }

      const selection = plan(requirement);
      if (selection.candidates.length === 0) {
        const why = selection.excluded.map((e) => `${e.modelId}: ${e.reason}`).join('; ');
        return err(
          noCapableModel(
            input.capability,
            `No model in tier ${requirement.tier} satisfies ${input.capability}.` +
              (why ? ` Excluded — ${why}.` : '') +
              ' Cross-tier downgrade is forbidden, so the request fails rather than being served by a weaker tier.',
          ),
        );
      }

      const chain = await runChain(
        selection.candidates,
        async (modelId) => {
          const request: ChatRequest = {
            model: modelId,
            messages: input.messages,
            maxTokens: requirement.maxTokens,
            timeoutMs: deps.defaultTimeoutMs,
            ...(input.tools?.length ? { tools: input.tools, toolChoice: 'auto' as const } : {}),
            ...(input.schema
              ? {
                  responseFormat: {
                    type: 'json_schema' as const,
                    name: input.schema.name,
                    schema: input.schema.schema,
                  },
                }
              : {}),
            ...(input.signal ? { signal: input.signal } : {}),
          };
          return deps.provider.chat(request);
        },
        deps.health,
        deps.now,
        noCapableModel(input.capability, 'Every candidate was exhausted.'),
      );

      if (!chain.ok) return err(chain.failure);

      return ok({
        response: chain.response,
        modelId: chain.modelId,
        tier: requirement.tier,
        fallbackDepth: chain.fallbackDepth,
        attempts: chain.attempts,
      });
    },
  };
}
