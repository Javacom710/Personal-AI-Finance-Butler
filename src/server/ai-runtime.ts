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

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import { env } from '../lib/env';
import { err, ok, type Result } from '../lib/result';
import { db } from './db/client';
import { aiUsageDaily, settings } from './db/schema';
import { todayIn } from '../lib/date';
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
import { requirementFor } from './ai/orchestrator/requirements';
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

// ------------------------------------------------------------ daily budget

/**
 * The daily budget (B-3a, decided 2026-10-26: a table, not memory).
 *
 * Read from `ai_usage_daily` **before** a request is built, and written after
 * every request that reached the provider. A table, because an in-memory count
 * resets on every restart, and a budget that a restart clears is not a budget.
 *
 * **What counts is a call to the provider**, not a call to `runAiCapability`:
 * the provider handed to the orchestrator is wrapped by {@link meterProvider},
 * so each fallback attempt is one request on the ledger, with its own model and
 * tokens, and a request refused before any call costs nothing.
 *
 * The day is the user's calendar day in `settings.timezone`. The gate runs once
 * per `runAiCapability`, before the request is built; the fallback chain behind
 * it is bounded at `MAX_ATTEMPTS` (3). So the most a day can exceed its request
 * limit by is the rest of one chain — two calls — and two requests racing at
 * the limit can both pass. The limit exists to stop a runaway loop, not to meter
 * to the token.
 */
export interface DailyUsage {
  readonly requests: number;
  readonly tokens: number;
}

export interface DailyLimits {
  readonly requests: number;
  readonly tokens: number;
}

/** The decision itself, pure. The first limit reached closes the day. */
export function isWithinDailyBudget(used: DailyUsage, limits: DailyLimits): boolean {
  return used.requests < limits.requests && used.tokens < limits.tokens;
}

/** The user's calendar day, or `null` when they have no settings row. */
export async function aiUsageDayFor(userId: string, now: Date): Promise<string | null> {
  const [row] = await db()
    .select({ timezone: settings.timezone })
    .from(settings)
    .where(eq(settings.userId, userId))
    .limit(1);
  return row ? todayIn(row.timezone, now) : null;
}

export async function dailyAiUsage(userId: string, day: string): Promise<DailyUsage> {
  const [row] = await db()
    .select({
      requests: sql<string>`coalesce(sum(${aiUsageDaily.requests}), 0)`,
      tokens: sql<string>`coalesce(sum(${aiUsageDaily.promptTokens} + ${aiUsageDaily.completionTokens}), 0)`,
    })
    .from(aiUsageDaily)
    .where(and(eq(aiUsageDaily.userId, userId), eq(aiUsageDaily.day, day)));
  return { requests: Number(row?.requests ?? 0), tokens: Number(row?.tokens ?? 0) };
}

export interface DailyUsageEntry {
  readonly userId: string;
  readonly day: string;
  readonly tier: number;
  /** The model the call was sent to. */
  readonly model: string;
  readonly failed: boolean;
  readonly fallback: boolean;
  readonly promptTokens: number;
  readonly completionTokens: number;
}

/**
 * Mark the serving model's row as having served after a fallback. The calls
 * themselves were already counted, one by one, by {@link meterProvider}.
 */
export async function markDailyFallback(userId: string, day: string, tier: number, model: string): Promise<void> {
  await db()
    .update(aiUsageDaily)
    .set({ fallbackRequests: sql`${aiUsageDaily.fallbackRequests} + 1` })
    .where(
      and(
        eq(aiUsageDaily.userId, userId),
        eq(aiUsageDaily.day, day),
        eq(aiUsageDaily.tier, tier),
        eq(aiUsageDaily.model, model),
      ),
    );
}

/** Who a provider call is charged to. Set for the duration of one run. */
interface Metering {
  readonly userId: string;
  readonly day: string;
  readonly tier: number;
}

const metering = new AsyncLocalStorage<Metering>();

/** Run `fn` with every provider call inside it charged to `meter`. */
export function withMetering<T>(meter: Metering, fn: () => Promise<T>): Promise<T> {
  return metering.run(meter, fn);
}

/**
 * Wrap a provider so that every `chat` call made while a {@link withMetering}
 * scope is active is added to `ai_usage_daily`: one request, its model, and the
 * tokens it reports. A call outside any scope (the smoke test) is not charged.
 * A failed ledger write is logged and never changes the provider's result.
 */
export function meterProvider(inner: AiProvider): AiProvider {
  return {
    key: inner.key,
    isConfigured: () => inner.isConfigured(),
    listModels: () => inner.listModels(),
    async chat(request) {
      const result = await inner.chat(request);
      const meter = metering.getStore();
      if (meter) {
        await recordDailyAiUsage({
          ...meter,
          model: request.model,
          failed: !result.ok,
          fallback: false,
          promptTokens: result.ok ? result.value.usage.promptTokens : 0,
          completionTokens: result.ok ? result.value.usage.completionTokens : 0,
        }).catch(() => log.error('ai.usage_daily.write_failed', { model: request.model }));
      }
      return result;
    },
  };
}

/** Add one request to the day's ledger row, creating it on first use. */
export async function recordDailyAiUsage(entry: DailyUsageEntry): Promise<void> {
  const failures = entry.failed ? 1 : 0;
  const fallbacks = entry.fallback ? 1 : 0;
  await db()
    .insert(aiUsageDaily)
    .values({
      userId: entry.userId,
      day: entry.day,
      tier: entry.tier,
      model: entry.model,
      requests: 1,
      failures,
      fallbackRequests: fallbacks,
      promptTokens: entry.promptTokens,
      completionTokens: entry.completionTokens,
    })
    .onConflictDoUpdate({
      target: [aiUsageDaily.userId, aiUsageDaily.day, aiUsageDaily.tier, aiUsageDaily.model],
      set: {
        requests: sql`${aiUsageDaily.requests} + 1`,
        failures: sql`${aiUsageDaily.failures} + ${failures}`,
        fallbackRequests: sql`${aiUsageDaily.fallbackRequests} + ${fallbacks}`,
        promptTokens: sql`${aiUsageDaily.promptTokens} + ${entry.promptTokens}`,
        completionTokens: sql`${aiUsageDaily.completionTokens} + ${entry.completionTokens}`,
      },
    });
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
  const provider = meterProvider(createNvidiaProvider({
    apiKey: e.NVIDIA_API_KEY,
    baseUrl: e.NVIDIA_BASE_URL,
    fetch: globalThis.fetch as never,
    defaultTimeoutMs: e.AI_REQUEST_TIMEOUT_MS,
  }));

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

  // 3. Daily budget. Read from the ledger before any request exists, and fail
  //    closed: a budget that cannot be read is not known to have room.
  let day: string | null = null;
  try {
    day = await aiUsageDayFor(options.read.userId, now());
    const used = day === null ? null : await dailyAiUsage(options.read.userId, day);
    const limits = { requests: e.AI_DAILY_REQUEST_LIMIT, tokens: e.AI_DAILY_TOKEN_LIMIT };
    if (used === null || !isWithinDailyBudget(used, limits)) {
      const failure = refused(
        'daily_budget',
        `Today's AI budget (${limits.requests} requests or ${limits.tokens} tokens) is used up. No request was sent.`,
      );
      finish('refused', { failureKind: failure.kind });
      return err(failure);
    }
  } catch {
    const failure = refused('daily_budget', 'The daily AI budget could not be checked. No request was sent.');
    finish('refused', { failureKind: failure.kind });
    return err(failure);
  }

  const runtime = aiRuntime();

  // 4. Configuration. A typed failure, never a fabricated result.
  if (!runtime.isConfigured()) {
    const failure = refused(
      'unsupported_capability',
      'NVIDIA_API_KEY is not configured. AI features are unavailable; every other feature is unaffected.',
    );
    finish('refused', { failureKind: failure.kind });
    return err(failure);
  }

  const tier = requirementFor(options.input.capability).tier;
  const result = await withMetering({ userId: options.read.userId, day: day as string, tier }, () =>
    runtime.orchestrator.run({
      ...options.input,
      ...(options.input.withTools ? { tools: toolDefinitions() } : {}),
    }),
  );

  if (!result.ok) {
    finish('failure', { failureKind: result.error.kind });
    return err(result.error);
  }

  if (result.value.fallbackDepth > 0) {
    await markDailyFallback(options.read.userId, day as string, tier, result.value.modelId).catch(() => {
      log.error('ai.usage_daily.write_failed', { requestId });
    });
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
