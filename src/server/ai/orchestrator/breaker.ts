import 'server-only';

/**
 * Per-model health, as a circuit breaker
 * ([AI-SYSTEM.md §7](../../../../docs/AI-SYSTEM.md)).
 *
 * Three consecutive failures **of the same class** open the circuit for five
 * minutes, doubling to a one-hour ceiling while it keeps failing. A single
 * probe closes it again.
 *
 * *Of the same class* is the part that matters. A model that times out once,
 * then rate-limits, then returns malformed JSON has three unrelated problems
 * and is probably fine; a model that times out three times running is not.
 * Counting indiscriminately would open circuits on noise and hide the signal.
 *
 * **Time is injected.** Every decision takes a `now`, so the breaker is testable
 * without waiting five real minutes and without mocking a global clock — the
 * same rule the financial engine follows for `ReadCtx.now`.
 *
 * State is in memory, deliberately. A single-user application runs one process;
 * a shared store would be infrastructure bought for a scale that does not exist
 * (`CLAUDE.md <technology>`). Losing the state on restart re-probes each model
 * once, which is the correct behaviour after a restart anyway.
 */

import type { AiFailure } from '../errors';

export const OPEN_MS = 5 * 60 * 1000;
export const MAX_OPEN_MS = 60 * 60 * 1000;
export const CONSECUTIVE_FAILURES_TO_OPEN = 3;

interface ModelHealth {
  consecutiveFailures: number;
  lastFailureKind: AiFailure['kind'] | null;
  openUntil: number | null;
  currentOpenMs: number;
  /** Set while a half-open probe is in flight, so only one probe is admitted. */
  probing: boolean;
}

export interface HealthRegistry {
  /** False while the circuit is open and no probe slot is free. */
  isAvailable(modelId: string, now: Date): boolean;
  recordSuccess(modelId: string): void;
  recordFailure(modelId: string, failure: AiFailure, now: Date): void;
  /** Diagnostics for Settings → AI. Never used to make a routing decision. */
  snapshot(now: Date): readonly { modelId: string; open: boolean; openUntil: string | null }[];
  reset(): void;
}

function blank(): ModelHealth {
  return {
    consecutiveFailures: 0,
    lastFailureKind: null,
    openUntil: null,
    currentOpenMs: OPEN_MS,
    probing: false,
  };
}

export function createHealthRegistry(): HealthRegistry {
  const models = new Map<string, ModelHealth>();
  const of = (id: string): ModelHealth => {
    const existing = models.get(id);
    if (existing) return existing;
    const fresh = blank();
    models.set(id, fresh);
    return fresh;
  };

  return {
    isAvailable(modelId, now) {
      const health = models.get(modelId);
      if (!health?.openUntil) return true;

      if (now.getTime() < health.openUntil) return false;

      // Half-open: admit exactly one probe. Admitting all of them would send a
      // burst at a model that has just been failing, which is how a recovering
      // provider gets knocked over again.
      if (health.probing) return false;
      health.probing = true;
      return true;
    },

    recordSuccess(modelId) {
      const health = of(modelId);
      health.consecutiveFailures = 0;
      health.lastFailureKind = null;
      health.openUntil = null;
      health.currentOpenMs = OPEN_MS;
      health.probing = false;
    },

    recordFailure(modelId, failure, now) {
      const health = of(modelId);

      if (health.lastFailureKind === failure.kind) {
        health.consecutiveFailures += 1;
      } else {
        health.consecutiveFailures = 1;
        health.lastFailureKind = failure.kind;
      }

      const wasProbing = health.probing;
      health.probing = false;

      if (wasProbing) {
        // The probe failed: reopen, longer. This is the exponential step, and
        // it is here rather than at the threshold so that a model which keeps
        // failing its probes backs off rather than being retried every 5 min.
        health.currentOpenMs = Math.min(health.currentOpenMs * 2, MAX_OPEN_MS);
        health.openUntil = now.getTime() + health.currentOpenMs;
        return;
      }

      if (health.consecutiveFailures >= CONSECUTIVE_FAILURES_TO_OPEN) {
        health.openUntil = now.getTime() + health.currentOpenMs;
      }
    },

    snapshot(now) {
      return [...models.entries()].map(([modelId, h]) => ({
        modelId,
        open: h.openUntil !== null && now.getTime() < h.openUntil,
        openUntil: h.openUntil === null ? null : new Date(h.openUntil).toISOString(),
      }));
    },

    reset() {
      models.clear();
    },
  };
}
