import 'server-only';

/**
 * The model-evaluation harness — structure, not results
 * ([AI-SYSTEM.md §14](../../../../docs/AI-SYSTEM.md), `CLAUDE.md <model_selection>`).
 *
 * `CLAUDE.md` requires candidate models to be measured against real workloads
 * before routing is finalised. That measurement needs a credential (**OD-1**) and
 * has **not run**. So this file provides the machinery to run it and record what
 * it finds, and contains **no scores at all** — inventing them would be worse
 * than having none, and would defeat the capability gate that currently keeps an
 * unmeasured model off a score-gated route.
 *
 * Phase 8 supplies the task corpora and executes this. What Phase 7 owes is that
 * the harness exists, is reusable, and records the fields the selection criteria
 * need: schema validity, tool-call correctness, latency, and error class.
 *
 * **Scoring is deterministic wherever a right answer exists.** LLM-as-judge is
 * deliberately not implemented here: it is advisory only, never a gate for
 * production routing, and never scores a numeric claim.
 */

import type { AiProvider, ChatMessage, ToolDefinition } from '../provider/types';
import type { AiFailure } from '../errors';

/** The suites `AI-SYSTEM.md` §14 names. Corpora live in `./tasks/`, one file per suite. */
export type EvalSuite =
  | 'parse'
  | 'classify'
  | 'tool-select'
  | 'routing'
  | 'grounding'
  | 'analysis'
  | 'scenario'
  | 'document'
  | 'injection'
  | 'robustness';

export interface EvalCase {
  readonly id: string;
  readonly suite: EvalSuite;
  readonly messages: readonly ChatMessage[];
  readonly tools?: readonly ToolDefinition[];
  readonly schema?: { readonly name: string; readonly schema: Record<string, unknown> };
  /**
   * Deterministic scorer. Given the raw model output, did it get it right?
   * Absent for suites with no single right answer — those are advisory and are
   * never used to gate routing.
   */
  readonly score?: (output: string | null, toolCalls: readonly { name: string; argumentsJson: string }[]) => boolean;
  /**
   * Does the output satisfy the requested schema, whatever its field values?
   * Kept apart from {@link score} because `schemaAdherence` gates a Tier 1 route
   * and must not be dragged down by a well-formed answer with a wrong date.
   * Absent: a schema case falls back to `score`, which then answers both.
   */
  readonly checkSchema?: (output: string | null) => boolean;
}

export interface CaseResult {
  readonly caseId: string;
  readonly suite: EvalSuite;
  readonly modelId: string;
  readonly passed: boolean | null;
  readonly latencyMs: number;
  /** Did the output satisfy the requested schema? `null` when none was requested. */
  readonly schemaValid: boolean | null;
  /** Did it call the expected tool with valid arguments? `null` when not a tool case. */
  readonly toolCallValid: boolean | null;
  readonly errorClass: AiFailure['kind'] | null;
}

export interface ModelReport {
  readonly modelId: string;
  readonly cases: readonly CaseResult[];
  readonly schemaAdherence: number | null;
  readonly toolCallCorrectness: number | null;
  readonly p50LatencyMs: number | null;
  readonly p95LatencyMs: number | null;
}

function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index] ?? null;
}

/** A ratio over the cases where the question applies. `null` when none did. */
function ratio(values: readonly (boolean | null)[]): number | null {
  const applicable = values.filter((v): v is boolean => v !== null);
  if (applicable.length === 0) return null;
  return applicable.filter(Boolean).length / applicable.length;
}

/**
 * Run one model over a set of cases.
 *
 * Every case is attempted independently — a failure is recorded with its class
 * and the run continues, because a model that fails one suite and passes another
 * is exactly what the matrix is for.
 */
export async function evaluateModel(
  provider: AiProvider,
  modelId: string,
  cases: readonly EvalCase[],
  timeoutMs = 60_000,
): Promise<ModelReport> {
  const results: CaseResult[] = [];

  for (const testCase of cases) {
    const startedAt = Date.now();
    const response = await provider.chat({
      model: modelId,
      messages: testCase.messages,
      maxTokens: 2_048,
      timeoutMs,
      ...(testCase.tools ? { tools: testCase.tools, toolChoice: 'auto' as const } : {}),
      ...(testCase.schema
        ? { responseFormat: { type: 'json_schema' as const, name: testCase.schema.name, schema: testCase.schema.schema } }
        : {}),
    });

    if (!response.ok) {
      results.push({
        caseId: testCase.id,
        suite: testCase.suite,
        modelId,
        passed: false,
        latencyMs: Date.now() - startedAt,
        schemaValid: testCase.schema ? false : null,
        toolCallValid: testCase.tools ? false : null,
        errorClass: response.error.kind,
      });
      continue;
    }

    const passed = testCase.score
      ? testCase.score(response.value.content, response.value.toolCalls)
      : null;

    results.push({
      caseId: testCase.id,
      suite: testCase.suite,
      modelId,
      passed,
      latencyMs: response.value.latencyMs,
      schemaValid: testCase.schema
        ? (testCase.checkSchema ? testCase.checkSchema(response.value.content) : passed)
        : null,
      toolCallValid: testCase.tools ? response.value.toolCalls.length > 0 && passed !== false : null,
      errorClass: null,
    });
  }

  return {
    modelId,
    cases: results,
    schemaAdherence: ratio(results.map((r) => r.schemaValid)),
    toolCallCorrectness: ratio(results.map((r) => r.toolCallValid)),
    p50LatencyMs: percentile(results.map((r) => r.latencyMs), 50),
    p95LatencyMs: percentile(results.map((r) => r.latencyMs), 95),
  };
}

/**
 * Render a report as markdown.
 *
 * A `null` score prints as `not measured`, never as `0` — the distinction
 * between "scored badly" and "was not scored" is the whole point of the
 * declared/measured split in the capability matrix.
 */
export function renderReport(reports: readonly ModelReport[]): string {
  const cell = (value: number | null, digits = 2): string =>
    value === null ? 'not measured' : value.toFixed(digits);

  const lines = [
    '| Model | Cases | Schema adherence | Tool-call correctness | p50 ms | p95 ms |',
    '|---|---|---|---|---|---|',
    ...reports.map(
      (r) =>
        `| ${r.modelId} | ${r.cases.length} | ${cell(r.schemaAdherence)} | ${cell(r.toolCallCorrectness)} | ` +
        `${cell(r.p50LatencyMs, 0)} | ${cell(r.p95LatencyMs, 0)} |`,
    ),
  ];
  return lines.join('\n');
}
