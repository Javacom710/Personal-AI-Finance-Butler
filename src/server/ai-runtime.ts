import 'server-only';

/**
 * The AI composition root — the one place that reads the environment, checks the
 * kill switch, and hands the AI layer a configured provider.
 *
 * It sits **outside** `src/server/ai/**` deliberately (ADR-38). The AI zone
 * cannot import `@/lib/env`, cannot reach a service, and cannot open a database
 * handle; everything it needs arrives as an argument constructed here. That is
 * why `NVIDIA_API_KEY` is named in this file and nowhere below it: the AI layer
 * holds a *configured client*, never a credential it could put in a prompt.
 *
 * ## The gates, in order
 *
 * ```
 * ai_enabled  →  rate limit  →  provider configured  →  orchestrator
 * ```
 *
 * Each is deterministic application code. None consults a model, and none can be
 * reached past — {@link runAiCapability} is the only door, and it checks them
 * before constructing a request, let alone sending one.
 */

import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { env } from '../lib/env';
import { err, ok, type Result } from '../lib/result';
import { db } from './db/client';
import { settings } from './db/schema';
import { log } from './log';
import { createAiReadCtx } from './ai-read/internal';
import type { AiReadCtx } from './ai-read';
import type { ReadCtx } from './services/_ctx';

import { refused, type AiFailure } from './ai/errors';
import { createNvidiaProvider, NVIDIA_BUILD_KEY } from './ai/provider/nvidia-build';
import type { AiProvider } from './ai/provider/types';
import { assertEveryConfiguredModelKnown, createCapabilityMatrix } from './ai/config/capabilities';
import { resolveModelConfig } from './ai/config/models';
import { createHealthRegistry } from './ai/orchestrator/breaker';
import { createOrchestrator, type Orchestrator, type RunInput, type RunOutput } from './ai/orchestrator';
import { toolDefinitions } from './ai/tools/registry';
import { toLogFields, type AiRequestRecord, type UsageSink } from './ai/observability/usage';
import { nullSink } from './ai/observability/usage';

// --------------------------------------------------------------- kill switch

/**
 * Is AI enabled for this user?
 *
 * Reads `settings.ai_enabled`, which has existed since Phase 2 and — until this
 * phase — had **no reader anywhere in the codebase** while `SECURITY.md` twice
 * leaned on it as the mitigation. This function is what makes the documented
 * control real.
 *
 * Fails **closed**: a settings row that cannot be read disables AI rather than
 * defaulting to on. A kill switch that fails open is not a kill switch.
 */
export async function isAiEnabled(userId: string): Promise<boolean> {
  try {
    const [row] = await db()
      .select({ enabled: settings.aiEnabled })
      .from(settings)
      .where(eq(settings.userId, userId))
      .limit(1);
    return row?.enabled === true;
  } catch {
    return false;
  }
}

// -------------------------------------------------------------- rate limit

/**
 * A fixed-window limiter, in memory.
 *
 * One user, one process: a shared store would be infrastructure bought for a
 * scale that does not exist, and `CLAUDE.md <technology>` rules out Redis for
 * exactly this. The existing `auth/rate-limit.ts` counts rows in `auth_events`,
 * which works because a login attempt is already an audited event; an AI request
 * is not, and writing one purely to count it would put request metadata in the
 * security log.
 *
 * **Burst behaviour:** the window is fixed, not sliding, so a caller may spend
 * the whole allowance at the start of a minute. For a single user that is the
 * correct trade — the limit exists to stop a runaway loop, not to shape traffic.
 * **Failure behaviour:** a refusal is a typed `refused` failure with reason
 * `rate_limited`; no provider call is made and nothing is billed.
 */
interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

export function checkAiRateLimit(userId: string, now: Date, limitPerMinute: number): boolean {
  const key = userId;
  const current = windows.get(key);
  const at = now.getTime();

  if (!current || at >= current.resetAt) {
    windows.set(key, { count: 1, resetAt: at + 60_000 });
    return true;
  }
  if (current.count >= limitPerMinute) return false;
  current.count += 1;
  return true;
}

/** Test support. Never called by the server. */
export function resetAiRateLimits(): void {
  windows.clear();
}

// ----------------------------------------------------------------- runtime

export interface AiRuntime {
  readonly provider: AiProvider;
  readonly orchestrator: Orchestrator;
  /** False when `NVIDIA_API_KEY` is unset. A Settings predicate, never a route input. */
  isConfigured(): boolean;
}

let cached: AiRuntime | null = null;

/**
 * Build (once) the provider and orchestrator.
 *
 * Cached because the circuit breaker's state must survive between requests — a
 * breaker rebuilt per request has no memory and never opens.
 */
export function aiRuntime(): AiRuntime {
  if (cached) return cached;

  const e = env();
  const provider = createNvidiaProvider({
    apiKey: e.NVIDIA_API_KEY,
    baseUrl: e.NVIDIA_BASE_URL,
    fetch: globalThis.fetch as never,
    defaultTimeoutMs: e.AI_REQUEST_TIMEOUT_MS,
  });

  const { config, matrix } = checkedAiConfiguration();

  const orchestrator = createOrchestrator({
    provider,
    config,
    matrix,
    health: createHealthRegistry(),
    now: () => new Date(),
    defaultTimeoutMs: e.AI_REQUEST_TIMEOUT_MS,
  });

  cached = { provider, orchestrator, isConfigured: () => provider.isConfigured() };
  return cached;
}

/**
 * Resolve the tier lists and the capability matrix, and refuse a tier list that
 * names a model with no capability entry (B-3b). Tier lists are read here and
 * passed in; `config/` cannot read the environment itself (AI-SYSTEM.md §12's
 * structural constraint on ADR-17).
 */
function checkedAiConfiguration() {
  const e = env();
  const config = resolveModelConfig({
    tier1: e.AI_TIER1_MODELS,
    tier2: e.AI_TIER2_MODELS,
    tier3: e.AI_TIER3_MODELS,
    tier4: e.AI_TIER4_MODELS,
  });
  const matrix = createCapabilityMatrix();
  assertEveryConfiguredModelKnown(config.allConfigured(), matrix);
  return { config, matrix };
}

/**
 * The startup half of B-3b, called from `instrumentation.ts` when the server
 * starts. It needs no key and makes no request: it only checks that every
 * configured model could be routed to. Throws, naming each model that could not.
 */
export function assertAiConfiguration(): void {
  checkedAiConfiguration();
}

/** Test support: drop the cached runtime so a new environment takes effect. */
export function resetAiRuntime(): void {
  cached = null;
}

/** Mint the AI read capability from an authenticated request's context. */
export function aiCapabilityFor(read: ReadCtx): AiReadCtx {
  return createAiReadCtx(read);
}

export interface RunOptions {
  readonly read: ReadCtx;
  readonly input: Omit<RunInput, 'tools'> & { readonly withTools?: boolean };
  readonly sink?: UsageSink;
  readonly now?: () => Date;
}

/**
 * The only entry point into the AI layer.
 *
 * Every gate is checked here, before a request exists. Nothing downstream can
 * skip them, because nothing downstream is reachable another way.
 */
export async function runAiCapability(options: RunOptions): Promise<Result<RunOutput, AiFailure>> {
  const now = options.now ?? (() => new Date());
  const sink = options.sink ?? nullSink;
  const started = now();
  const requestId = randomUUID();
  const e = env();

  const finish = (
    outcome: AiRequestRecord['outcome'],
    extra: Partial<AiRequestRecord> = {},
  ): void => {
    const finished = now();
    const record: AiRequestRecord = {
      requestId,
      capability: options.input.capability,
      tier: 1,
      modelId: null,
      provider: NVIDIA_BUILD_KEY,
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      latencyMs: finished.getTime() - started.getTime(),
      outcome,
      failureKind: null,
      fallbackDepth: 0,
      attemptCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      schemaValid: null,
      schemaRepairUsed: false,
      toolCallCount: 0,
      toolFailureCount: 0,
      ...extra,
    };
    void sink.record(record);
    log.info('ai.request', toLogFields(record));
  };

  // 1. Kill switch. Checked first, so a disabled user produces zero egress —
  //    not a request that is later discarded.
  if (!(await isAiEnabled(options.read.userId))) {
    const failure = refused('ai_disabled', 'AI is disabled in settings. No request was sent.');
    finish('refused', { failureKind: failure.kind });
    return err(failure);
  }

  // 2. Rate limit. Also before any provider call.
  if (!checkAiRateLimit(options.read.userId, now(), e.AI_RATE_LIMIT_PER_MINUTE)) {
    const failure = refused(
      'rate_limited',
      `More than ${e.AI_RATE_LIMIT_PER_MINUTE} AI requests in a minute. No request was sent.`,
    );
    finish('refused', { failureKind: failure.kind });
    return err(failure);
  }

  const runtime = aiRuntime();

  // 3. Configuration. A typed failure, never a fabricated result.
  if (!runtime.isConfigured()) {
    const failure = refused(
      'unsupported_capability',
      'NVIDIA_API_KEY is not configured. AI features are unavailable; every other feature is unaffected.',
    );
    finish('refused', { failureKind: failure.kind });
    return err(failure);
  }

  const result = await runtime.orchestrator.run({
    ...options.input,
    ...(options.input.withTools ? { tools: toolDefinitions() } : {}),
  });

  if (!result.ok) {
    finish('failure', { failureKind: result.error.kind });
    return err(result.error);
  }

  finish('success', {
    modelId: result.value.modelId,
    tier: result.value.tier as AiRequestRecord['tier'],
    fallbackDepth: result.value.fallbackDepth,
    attemptCount: result.value.attempts.length,
    promptTokens: result.value.response.usage.promptTokens,
    completionTokens: result.value.response.usage.completionTokens,
    toolCallCount: result.value.response.toolCalls.length,
  });
  return ok(result.value);
}
