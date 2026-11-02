import 'server-only';

/**
 * Stored model measurements, and the capability entries they become
 * ([ADR-44](../../docs/DECISIONS.md#adr-44--the-capability-matrix-stays-capabilitiests-checked-at-startup),
 * AI-SYSTEM.md §5, §14).
 *
 * `npm run ai:eval` writes one `ai_model_evaluations` row per model and suite.
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

import { db } from './db/client';
import { aiModelEvaluations } from './db/schema';
import { DECLARED_CAPABILITIES, type ModelCapabilities } from './ai/config/capabilities';
import { MODEL_SUITES, TIER_SUITES, type EvalRun, type ModelSuite, type SuiteCounts } from './ai/eval/runner';

/** What a stored row keeps beyond its columns: counts and case ids, never output. */
export interface EvaluationDetail extends SuiteCounts {
  readonly finishReasons?: Readonly<Record<string, number>>;
  readonly maxTokens?: number;
  readonly requestTimeoutMs?: number;
  readonly failedCases: readonly string[];
  readonly errors: Readonly<Record<string, number>>;
}

/**
 * Store a run: one row per model and suite. A wire check (`--limit`) is refused
 * here as well as in the script, because a row is what the router believes.
 */
export async function recordEvaluationRun(run: EvalRun): Promise<number> {
  if (run.limit !== null) throw new Error('A partial run (--limit) is a wire check and is never stored.');
  const rows = run.models.flatMap((m) =>
    m.suites.map((s) => {
      const detail: EvaluationDetail = {
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
  if (rows.length === 0) return 0;
  await db().insert(aiModelEvaluations).values(rows);
  return rows.length;
}

export interface StoredEvaluation {
  readonly model: string;
  readonly suite: string;
  readonly evalVersion: number;
  readonly casesPassed: number;
  readonly p50LatencyMs: number | null;
  readonly p95LatencyMs: number | null;
  readonly detail: EvaluationDetail;
  readonly runAt: Date;
}

/** The latest stored row for each model and suite. */
export async function latestEvaluations(): Promise<readonly StoredEvaluation[]> {
  const { rows } = await db().execute<{
    model: string;
    suite: string;
    eval_version: number;
    cases_passed: number;
    p50_latency_ms: number | null;
    p95_latency_ms: number | null;
    detail: EvaluationDetail;
    run_at: string | Date;
  }>(sql`
    select distinct on (model, suite)
           model, suite, eval_version, cases_passed, p50_latency_ms, p95_latency_ms, detail, run_at
      from ${aiModelEvaluations}
     order by model, suite, run_at desc
  `);
  return rows.map((r) => ({
    model: r.model,
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
 * Turn stored rows into measured capability entries. Pure, so the rules are
 * testable without a database.
 *
 * Scores combine exact counts across suites. A score with nothing to measure —
 * schema adherence for a tier measured only on tool suites — is **0**, which
 * fails every gate that needs it: unmeasured is never treated as passing.
 * Latency is the slowest suite's, and the entry is as old as its oldest row.
 */
export function capabilitiesFromEvaluations(
  rows: readonly StoredEvaluation[],
  declared: Readonly<Record<string, ModelCapabilities>> = DECLARED_CAPABILITIES,
): Record<string, ModelCapabilities> {
  const byModel = new Map<string, StoredEvaluation[]>();
  for (const row of rows) byModel.set(row.model, [...(byModel.get(row.model) ?? []), row]);

  const measured: Record<string, ModelCapabilities> = {};
  for (const [model, modelRows] of byModel) {
    const base = declared[model];
    if (!base) continue;
    const required = TIER_SUITES[base.tier];
    if (required.length === 0) continue;

    const current = required.map((suite) =>
      modelRows.find((r) => r.suite === suite && r.evalVersion === MODEL_SUITES[suite].version),
    );
    if (current.some((r) => r === undefined)) continue;
    const used = current as StoredEvaluation[];
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

/** The measured entries from the database. */
export async function measuredCapabilities(): Promise<Record<string, ModelCapabilities>> {
  return capabilitiesFromEvaluations(await latestEvaluations());
}
