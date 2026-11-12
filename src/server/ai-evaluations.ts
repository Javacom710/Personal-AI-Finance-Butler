import 'server-only';

/**
 * Stored model measurements, and the capability entries they become
 * ([ADR-44](../../docs/DECISIONS.md#adr-44--the-capability-matrix-stays-capabilitiests-checked-at-startup),
 * AI-SYSTEM.md §5, §14).
 *
 * `npm run ai:eval` writes one row per model, tier and suite.
 * At server start, {@link measuredCapabilities} turns the latest rows into
 * `source: 'measured'` entries, which `createCapabilityMatrix(measured)` layers
 * over the declared matrix. A score-gated route can then serve a model, which a
 * declared entry never can.
 *
 * Lives outside `src/server/ai/**` because the AI layer may not open a
 * database (ADR-38); like `ai-runtime.ts`, it is the bridge.
 *
 * **What makes a measured entry.** A model gets one only when every suite its
 * tier is measured on has a stored result at the suite's **current** version,
 * with **no unanswered case**, and the model has a declared entry for the
 * fields a measurement cannot supply (context window, vision, tool support).
 * Anything short of that leaves the declared entry in place, which serves no
 * score-gated route: a partial or stale measurement is not a measurement.
 */

import { sql } from 'drizzle-orm';
import { isOpenRouterEndpoint } from './ai/provider/openrouter-policy';

import { db, type DbExecutor } from './db/client';
import { aiModelEvaluations } from './db/schema';
import { DECLARED_CAPABILITIES, type ModelCapabilities, type TierMeasuredCapabilities } from './ai/config/capabilities';
import { maxTokensFor, MODEL_SUITES, TIER_SUITES, type EvalRun, type ModelSuite, type SuiteCounts } from './ai/eval/runner';
import type { Tier } from './ai/config/models';
import { aiProviderSettings, env } from '../lib/env';
import { DEFAULT_REQUEST_PROFILE, matchesRequestProfile, requestProfileById, requestProfileIdentity, resolveRequestProfiles, type RequestProfileIdentity, type RequestProfiles } from './ai/config/request-profiles';

/** Endpoint identity excludes credentials, query parameters and fragments. */
export function evaluationProviderIdentity(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid evaluation provider endpoint.');
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/** Measurement is authorized; accepting host-scoped runtime evidence requires the owner's lineup decision. */
export function assertEvaluationRecordingSupported(providerIdentity: string): void {
  if (isOpenRouterEndpoint(providerIdentity)) throw new Error('OpenRouter measurements are review-only (--no-record). Host-scoped approval and runtime recording must be implemented after the owner accepts a lineup.');
}

/** What a stored row keeps beyond its columns: counts and case ids, never output. */
export interface EvaluationDetail extends SuiteCounts {
  readonly providerIdentity?: string;
  readonly requestProfile?: RequestProfileIdentity;
  readonly finishReasons?: Readonly<Record<string, number>>;
  readonly maxTokens?: number;
  readonly requestTimeoutMs?: number;
  readonly failedCases: readonly string[];
  readonly errors: Readonly<Record<string, number>>;
}

/**
 * Encode a run: one row per model and suite. A wire check (`--limit`) is refused
 * here as well as in the script, because a row is what the router believes.
 */
export function evaluationRowsForRun(run: EvalRun, providerIdentity: string) {
  if (run.limit !== null) throw new Error('A partial run (--limit) is a wire check and is never stored.');
  assertEvaluationRecordingSupported(providerIdentity);
  if (run.providerIdentity !== providerIdentity) throw new Error('Missing or mismatched evaluation provider provenance.');
  return run.models.flatMap((m) =>
    m.suites.map((s) => {
      const profile = requestProfileById(m.modelId, m.requestProfile?.id ?? DEFAULT_REQUEST_PROFILE.id);
      if (!matchesRequestProfile(m.requestProfile, profile)) throw new Error('Invalid evaluation request-profile provenance.');
      const detail: EvaluationDetail = {
        providerIdentity,
        requestProfile: requestProfileIdentity(profile),
        ...s.counts,
        failedCases: s.failedCases,
        errors: s.errors,
        ...(s.finishReasons === undefined ? {} : { finishReasons: s.finishReasons }),
        ...(s.maxTokens === undefined ? {} : { maxTokens: s.maxTokens }),
        ...(run.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: run.requestTimeoutMs }),
      };
      const score = s.counts.answered === 0 ? 0 : s.passed / s.counts.answered;
      return {
        model: m.modelId,
        tier: run.tier,
        evalVersion: s.version,
        suite: s.suite,
        casesTotal: s.total,
        casesPassed: s.passed,
        score: score.toFixed(4),
        p50LatencyMs: s.report.p50LatencyMs,
        p95LatencyMs: s.report.p95LatencyMs,
        detail,
        runAt: new Date(run.startedAt),
      };
    }),
  );
}

/** The same provenance checks and row encoder, optionally inside an application transaction. */
export async function recordEvaluationRun(run: EvalRun, executor?: DbExecutor): Promise<number> {
  if (run.limit !== null) throw new Error('A partial run (--limit) is a wire check and is never stored.');
  const providerIdentity = evaluationProviderIdentity(aiProviderSettings(env()).baseUrl);
  const rows = evaluationRowsForRun(run, providerIdentity);
  if (rows.length === 0) return 0;
  await (executor ?? db()).insert(aiModelEvaluations).values(rows);
  return rows.length;
}

export interface StoredEvaluation {
  readonly model: string;
  readonly tier: number;
  readonly suite: string;
  readonly evalVersion: number;
  readonly casesPassed: number;
  readonly p50LatencyMs: number | null;
  readonly p95LatencyMs: number | null;
  readonly detail: EvaluationDetail;
  readonly runAt: Date;
}

/** Latest rows per model/tier/suite/profile at the active endpoint. */
export async function latestEvaluations(): Promise<readonly StoredEvaluation[]> {
  const providerIdentity = evaluationProviderIdentity(aiProviderSettings(env()).baseUrl);
  if (isOpenRouterEndpoint(providerIdentity)) return [];
  const { rows } = await db().execute<{
    model: string;
    tier: number;
    suite: string;
    eval_version: number;
    cases_passed: number;
    p50_latency_ms: number | null;
    p95_latency_ms: number | null;
    detail: EvaluationDetail;
    run_at: string | Date;
  }>(sql`
    select distinct on (model, tier, suite, detail->'requestProfile')
           model, tier, suite, eval_version, cases_passed, p50_latency_ms, p95_latency_ms, detail, run_at
      from ${aiModelEvaluations}
     where detail->>'providerIdentity' = ${providerIdentity}
     order by model, tier, suite, detail->'requestProfile', run_at desc
  `);
  return rows.map((r) => ({
    model: r.model,
    tier: r.tier,
    suite: r.suite,
    evalVersion: r.eval_version,
    casesPassed: r.cases_passed,
    p50LatencyMs: r.p50_latency_ms,
    p95LatencyMs: r.p95_latency_ms,
    detail: r.detail,
    runAt: new Date(r.run_at),
  }));
}

const ratio = (num: number, den: number): number => (den === 0 ? 0 : num / den);

/**
 * Turn stored rows from each model's declared tier into measured entries.
 * Other-tier and unlabelled rows cannot complete, replace or certify a suite.
 * Pure, so the rules are testable without a database.
 *
 * Scores combine exact counts across suites. A score with nothing to measure —
 * schema adherence for a tier measured only on tool suites — is **0**, which
 * fails every gate that needs it: unmeasured is never treated as passing.
 * Latency is the slowest suite's, and the entry is as old as its oldest row.
 */
export function capabilitiesFromEvaluations(
  rows: readonly StoredEvaluation[],
  declared: Readonly<Record<string, ModelCapabilities>> = DECLARED_CAPABILITIES,
  profiles: RequestProfiles = resolveRequestProfiles(),
  providerIdentity?: string,
): Record<string, ModelCapabilities> {
  const byModel = new Map<string, StoredEvaluation[]>();
  if (!providerIdentity || isOpenRouterEndpoint(providerIdentity)) return {};
  for (const row of rows) {
    if (row.detail.providerIdentity !== providerIdentity) continue;
    byModel.set(row.model, [...(byModel.get(row.model) ?? []), row]);
  }

  const measured: Record<string, ModelCapabilities> = {};
  for (const [model, modelRows] of byModel) {
    const base = declared[model];
    if (!base) continue;
    const required = TIER_SUITES[base.tier];
    if (required.length === 0) continue;
    const profile = profiles.forModel(model);
    const matching = modelRows
      .filter((r) => r.tier === base.tier && matchesRequestProfile(r.detail.requestProfile, profile))
      .sort((a, b) => b.runAt.getTime() - a.runAt.getTime());
    const current = required.map((suite) =>
      matching.find((r) => r.suite === suite),
    );
    if (current.some((r) => r === undefined)) continue;
    const used = current as StoredEvaluation[];
    if (used.some((r) => r.evalVersion !== MODEL_SUITES[r.suite as ModelSuite].version)) continue;
    if (used.some((r) => r.detail.unanswered > 0)) continue;

    const sum = (pick: (d: EvaluationDetail) => number) => used.reduce((n, r) => n + pick(r.detail), 0);
    const suiteScore = (suite: ModelSuite): number => {
      const row = used.find((r) => r.suite === suite);
      return row ? ratio(row.casesPassed, row.detail.answered) : 0;
    };
    const latencies = (pick: (r: StoredEvaluation) => number | null) =>
      Math.max(0, ...used.map(pick).filter((v): v is number => v !== null));

    measured[model] = {
      ...base,
      source: 'measured',
      requestProfile: requestProfileIdentity(profile),
      scores: {
        schemaAdherence: ratio(sum((d) => d.schemaValid), sum((d) => d.schemaApplicable)),
        toolCallCorrectness: ratio(sum((d) => d.toolCallValid), sum((d) => d.toolCallApplicable)),
        retrievalGrounding: suiteScore('grounding'),
        injectionResistance: suiteScore('injection'),
        p50LatencyMs: latencies((r) => r.p50LatencyMs),
        p95LatencyMs: latencies((r) => r.p95LatencyMs),
      },
      verifiedAt: new Date(Math.min(...used.map((r) => r.runAt.getTime()))).toISOString(),
      verifiedAgainstEvalVersion: Math.max(...used.map((r) => r.evalVersion)),
    };
  }
  return measured;
}

/** Strict full-corpus, production-budget evidence, independently for every tier. */
export function tierCapabilitiesFromEvaluations(
  rows: readonly StoredEvaluation[],
  declared: Readonly<Record<string, ModelCapabilities>> = DECLARED_CAPABILITIES,
  profiles: RequestProfiles = resolveRequestProfiles(),
  providerIdentity?: string,
): TierMeasuredCapabilities {
  const measured: Record<string, Partial<Record<Tier, ModelCapabilities>>> = {};
  for (const tier of [1, 2, 3, 4] as const) {
    // Retarget metadata only inside this independent aggregation. No declaration
    // is mutated and no score is copied from another tier.
    const metadata = Object.fromEntries(Object.entries(declared).map(([model, base]) => [model, { ...base, tier }]));
    // Validate the latest matching row, rather than filtering invalid newer rows
    // and accidentally reviving older passing evidence.
    const entries = capabilitiesFromEvaluations(rows, metadata, profiles, providerIdentity);
    for (const [model, entry] of Object.entries(entries)) {
      const required = TIER_SUITES[tier];
      const matching = rows.filter(r => r.model === model && r.tier === tier && r.detail.providerIdentity === providerIdentity && matchesRequestProfile(r.detail.requestProfile, profiles.forModel(model)))
        .sort((a, b) => b.runAt.getTime() - a.runAt.getTime());
      const current = required.map(suite => matching.find(r => r.suite === suite)!);
      if (current.some(r => {
        const suite = r.suite as ModelSuite;
        const c = r.detail;
        const corpus = MODEL_SUITES[suite].build();
        const fixedTools = ['tool-select', 'injection'].includes(suite) ? corpus.filter(test => test.tools !== undefined).length
          : suite === 'analysis' || corpus.every(test => test.tools === undefined) ? 0 : null;
        return c.maxTokens !== maxTokensFor(tier, suite) || c.answered !== corpus.length ||
          c.schemaApplicable !== corpus.filter(test => test.schema !== undefined).length || (fixedTools !== null && c.toolCallApplicable !== fixedTools) ||
          ![r.casesPassed, c.answered, c.unanswered, c.schemaValid, c.schemaApplicable, c.toolCallValid, c.toolCallApplicable].every(n => Number.isSafeInteger(n) && n >= 0) ||
          r.casesPassed > c.answered || c.schemaValid > c.schemaApplicable || c.schemaApplicable > c.answered || c.toolCallValid > c.toolCallApplicable || c.toolCallApplicable > c.answered;
      })) continue;
      (measured[model] ??= {})[tier] = entry;
    }
  }
  return measured;
}

export interface MeasuredCapabilitySnapshot {
  readonly declaredTier: Readonly<Record<string, ModelCapabilities>>;
  readonly byTier: TierMeasuredCapabilities;
}

/** One database read supplies both legacy/default lookup and tier-aware lookup. */
export async function measuredCapabilitySnapshot(): Promise<MeasuredCapabilitySnapshot> {
  const byTier = tierCapabilitiesFromEvaluations(await latestEvaluations(), DECLARED_CAPABILITIES,
    resolveRequestProfiles(env().AI_REQUEST_PROFILES), evaluationProviderIdentity(aiProviderSettings(env()).baseUrl));
  const declaredTier = Object.fromEntries(Object.entries(DECLARED_CAPABILITIES).flatMap(([model, base]) => {
    const entry = byTier[model]?.[base.tier];
    return entry ? [[model, entry]] : [];
  }));
  return { declaredTier, byTier };
}

/** Default-tier entries retained for callers that do not request a tier. */
export async function measuredCapabilities(): Promise<Readonly<Record<string, ModelCapabilities>>> {
  return (await measuredCapabilitySnapshot()).declaredTier;
}
