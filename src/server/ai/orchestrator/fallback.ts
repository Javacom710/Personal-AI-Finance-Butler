import 'server-only';

/**
 * The attempt chain ([AI-SYSTEM.md §7](../../../../docs/AI-SYSTEM.md)).
 *
 * Walks the candidate list produced by `select.ts`, which is **already**
 * capability-filtered — so every model reached here satisfies the requirement,
 * and no ordering mistake can produce a downgrade. Fallback moves *sideways*
 * within a tier and never down to another one: if every Tier 2 candidate fails,
 * the request fails, rather than quietly becoming a Tier 1 answer the caller
 * believes came from Tier 2.
 *
 * Three rules, each with a failure mode it exists to prevent:
 *
 * - **At most {@link MAX_ATTEMPTS} attempts.** An unbounded chain over a long
 *   candidate list is a way to spend a budget on a provider outage.
 * - **`content_filter` is never retried.** Retrying a refusal on another model
 *   is not fallback, it is shopping for a model that will comply.
 * - **A `fail_closed` failure stops the chain.** A missing credential or an
 *   unauthorised key will not be fixed by a different model — they share it.
 */

import { dispositionOf, type AiFailure } from '../errors';
import type { ChatResponse } from '../provider/types';
import type { HealthRegistry } from './breaker';

export const MAX_ATTEMPTS = 3;

export interface Attempt {
  readonly modelId: string;
  readonly latencyMs: number;
  readonly outcome: 'success' | 'failure';
  readonly failureKind?: AiFailure['kind'];
}

export interface ChainSuccess {
  readonly ok: true;
  readonly response: ChatResponse;
  readonly modelId: string;
  /** 0 when the first candidate served it. Recorded and surfaced. */
  readonly fallbackDepth: number;
  readonly attempts: readonly Attempt[];
}

export interface ChainFailure {
  readonly ok: false;
  readonly failure: AiFailure;
  readonly attempts: readonly Attempt[];
}

export type ChainResult = ChainSuccess | ChainFailure;

/** One attempt against one model. Returns a result; never throws. */
export type AttemptFn = (modelId: string) => Promise<
  { readonly ok: true; readonly value: ChatResponse } | { readonly ok: false; readonly error: AiFailure }
>;

/**
 * Try candidates in order until one succeeds or the chain is exhausted.
 *
 * `now` is injected for the same reason it is everywhere else in this codebase:
 * the circuit breaker's decisions are time-dependent and must be testable
 * without waiting.
 */
export async function runChain(
  candidates: readonly string[],
  attempt: AttemptFn,
  health: HealthRegistry,
  now: () => Date,
  exhausted: AiFailure,
): Promise<ChainResult> {
  const attempts: Attempt[] = [];

  if (candidates.length === 0) {
    return { ok: false, failure: exhausted, attempts };
  }

  const limit = Math.min(candidates.length, MAX_ATTEMPTS);
  let last: AiFailure = exhausted;

  for (let i = 0; i < limit; i += 1) {
    const modelId = candidates[i]!;
    const startedAt = Date.now();
    const result = await attempt(modelId);
    const latencyMs = Date.now() - startedAt;

    if (result.ok) {
      health.recordSuccess(modelId);
      attempts.push({ modelId, latencyMs, outcome: 'success' });
      return {
        ok: true,
        response: result.value,
        modelId,
        fallbackDepth: i,
        attempts,
      };
    }

    last = result.error;
    health.recordFailure(modelId, result.error, now());
    attempts.push({ modelId, latencyMs, outcome: 'failure', failureKind: result.error.kind });

    // A failure the class says is terminal ends the chain here. Trying more
    // models would be spending requests to reach the same answer.
    if (dispositionOf(result.error) === 'fail_closed') break;
  }

  return { ok: false, failure: last, attempts };
}

/**
 * Whether a finish reason must end the chain regardless of the failure class.
 *
 * `content_filter` is the case: the model answered, and its answer was a
 * refusal. Moving to another model is not fallback.
 */
export function isTerminalFinish(response: ChatResponse): boolean {
  return response.finishReason === 'content_filter';
}
