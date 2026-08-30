import 'server-only';

/**
 * What an AI request records, and — more importantly — what it does not
 * ([AI-SYSTEM.md §13](../../../../docs/AI-SYSTEM.md), `CLAUDE.md <ai_observability>`).
 *
 * The record must answer the operational questions the specification names —
 * which models serve, which fail and how, which are slow, which produce invalid
 * structured output, how often fallback fires and to what depth — **without**
 * carrying a financial figure, a prompt, a completion, or a tool payload.
 *
 * That is why {@link AiRequestRecord} is a closed set of scalars rather than a
 * bag of context. A shape that *could* hold a transaction description eventually
 * will: someone debugging at 2am adds one field, and the log becomes a copy of
 * the ledger with none of its access controls. Nothing here has anywhere to put
 * one, so nothing has to remember not to.
 *
 * Conversation content is a separate matter with a separate answer: it lives in
 * `ai_messages` because the product needs it, covered by export and delete, and
 * deliberately distinct from application logs.
 */

import type { AiFailure } from '../errors';
import type { AiCapability } from '../orchestrator/requirements';
import type { Tier } from '../config/models';

export type RequestOutcome = 'success' | 'failure' | 'refused';

/**
 * One AI request, as it is recorded.
 *
 * Every field is a scalar, an identifier, or a count. There is no `prompt`, no
 * `response`, no `input`, no `result` — by construction, not by convention.
 */
export interface AiRequestRecord {
  readonly requestId: string;
  readonly capability: AiCapability;
  readonly tier: Tier;
  /** The model that actually served it, or `null` when none was reached. */
  readonly modelId: string | null;
  readonly provider: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly latencyMs: number;
  readonly outcome: RequestOutcome;
  /** The failure *class*, never its message — messages can quote model output. */
  readonly failureKind: AiFailure['kind'] | null;
  /** 0 when the first candidate served it. */
  readonly fallbackDepth: number;
  readonly attemptCount: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  /** Whether structured output validated, after any repair. `null` if not required. */
  readonly schemaValid: boolean | null;
  readonly schemaRepairUsed: boolean;
  readonly toolCallCount: number;
  readonly toolFailureCount: number;
}

/** Where records go. A sink so the orchestrator has no database dependency. */
export interface UsageSink {
  record(entry: AiRequestRecord): void | Promise<void>;
}

/** Collects in memory. Used by tests, and by a process with no database yet. */
export function createMemorySink(): UsageSink & { entries(): readonly AiRequestRecord[]; clear(): void } {
  const entries: AiRequestRecord[] = [];
  return {
    record: (entry) => {
      entries.push(entry);
    },
    entries: () => entries,
    clear: () => {
      entries.length = 0;
    },
  };
}

/** Discards. The correct sink when AI is disabled and nothing should be written. */
export const nullSink: UsageSink = { record: () => undefined };

/**
 * The safe log projection of a record.
 *
 * `src/server/log.ts` already redacts every `bigint` and every field whose name
 * looks financial, and Phase 7 relies on that rather than building a second
 * redactor. This function is the belt: it names the fields that may be logged,
 * so a field added to the record above does not reach a log line merely by
 * existing.
 */
export function toLogFields(entry: AiRequestRecord): Record<string, unknown> {
  return {
    requestId: entry.requestId,
    capability: entry.capability,
    tier: entry.tier,
    model: entry.modelId,
    provider: entry.provider,
    latencyMs: entry.latencyMs,
    outcome: entry.outcome,
    failureKind: entry.failureKind,
    fallbackDepth: entry.fallbackDepth,
    attemptCount: entry.attemptCount,
    promptTokens: entry.promptTokens,
    completionTokens: entry.completionTokens,
    schemaValid: entry.schemaValid,
    schemaRepairUsed: entry.schemaRepairUsed,
    toolCallCount: entry.toolCallCount,
    toolFailureCount: entry.toolFailureCount,
  };
}
