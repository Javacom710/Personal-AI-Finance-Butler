import 'server-only';

/**
 * The `ai:eval` runner — which models, which suites, and what the measurement
 * proposes ([AI-SYSTEM.md §14](../../../../docs/AI-SYSTEM.md), `CLAUDE.md
 * <model_selection>`).
 *
 * `scripts/ai-eval.ts` is the thin shell around this: it reads the
 * environment, builds the provider, and writes the report files. Everything
 * that decides anything is here, and is unit-tested without a network.
 *
 * Three rules this module keeps:
 *
 * - **It proposes; it never routes.** The output is a proposed order per tier
 *   and the measured scores behind it. Nothing here edits configuration: a
 *   human accepts the order into `AI_TIER<n>_MODELS`, as §14 requires.
 * - **A model that fails a threshold is not proposed**, however good its other
 *   scores. Tier 1 needs `schemaAdherence ≥ 0.95` and every tool-using tier
 *   needs `toolCallCorrectness ≥ 0.90` (§5).
 * - **Nothing measured is invented.** A score with no applicable cases is
 *   `null` and prints as "not measured"; a model with an error on every case is
 *   reported as unreachable, not as a model that scored zero.
 *
 * The `routing` suite is not here: it measures the application's classifier,
 * not a model, and runs in the unit tests. `document`, `scenario` and
 * `analysis` are not built.
 */

import type { Tier } from '../config/models';
import { EVALUATION_CANDIDATES, type ModelConfig } from '../config/models';
import type { AiProvider } from '../provider/types';
import { evaluateModel, type EvalCase, type EvalSuite, type ModelReport } from './harness';
import { CLASSIFY_SUITE_VERSION, classifySuite } from './tasks/classify';
import { GROUNDING_SUITE_VERSION, groundingSuite } from './tasks/grounding';
import { INJECTION_SUITE_VERSION, injectionSuite } from './tasks/injection';
import { PARSE_SUITE_VERSION, parseSuite } from './tasks/parse';
import { ROBUSTNESS_SUITE_VERSION, robustnessSuite } from './tasks/robustness';
import { TOOL_SELECT_SUITE_VERSION, toolSelectSuite } from './tasks/tool-select';

/** The suites a model can be measured on. */
export type ModelSuite = Extract<EvalSuite, 'parse' | 'classify' | 'tool-select' | 'grounding' | 'robustness' | 'injection'>;

export const MODEL_SUITES: Readonly<Record<ModelSuite, { readonly version: number; readonly build: () => readonly EvalCase[] }>> = {
  parse: { version: PARSE_SUITE_VERSION, build: parseSuite },
  classify: { version: CLASSIFY_SUITE_VERSION, build: classifySuite },
  'tool-select': { version: TOOL_SELECT_SUITE_VERSION, build: toolSelectSuite },
  grounding: { version: GROUNDING_SUITE_VERSION, build: groundingSuite },
  robustness: { version: ROBUSTNESS_SUITE_VERSION, build: robustnessSuite },
  injection: { version: INJECTION_SUITE_VERSION, build: injectionSuite },
};

/**
 * What each tier is measured on. Tier 1 parses and classifies; every text tier
 * answers questions with tools. Tier 4's `document` suite is not built, so
 * Tier 4 cannot be measured yet, and saying so beats measuring it on text.
 */
export const TIER_SUITES: Readonly<Record<Tier, readonly ModelSuite[]>> = {
  1: ['parse', 'classify', 'tool-select', 'grounding', 'robustness', 'injection'],
  2: ['tool-select', 'grounding', 'robustness', 'injection'],
  3: ['tool-select', 'grounding', 'robustness', 'injection'],
  4: [],
  5: [],
};

/** §5's production thresholds. */
export const THRESHOLDS = { tier1SchemaAdherence: 0.95, toolCallCorrectness: 0.9 } as const;

// ------------------------------------------------------------------ arguments

export interface EvalArgs {
  readonly tier: Tier;
  readonly suites: readonly ModelSuite[];
  /** Explicit models; empty means the tier's configured order plus its evaluation candidates. */
  readonly models: readonly string[];
  /** First n cases of each suite: a cheap wire check, never a measurement to route on. */
  readonly limit: number | null;
  /** Store the run in `ai_model_evaluations`. Never for a `--limit` run. */
  readonly record: boolean;
}

export type ParsedArgs = { ok: true; value: EvalArgs } | { ok: false; error: string };

const isSuite = (s: string): s is ModelSuite => Object.hasOwn(MODEL_SUITES, s);

/** `--tier 1 --suite parse,classify --model a,b --limit 3 --no-record`. */
export function parseEvalArgs(argv: readonly string[]): ParsedArgs {
  const value = (flag: string): string | undefined => {
    const at = argv.indexOf(flag);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  const list = (flag: string): string[] =>
    (value(flag) ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  const tierText = value('--tier');
  const tier = Number(tierText);
  if (!tierText || ![1, 2, 3, 4].includes(tier)) return { ok: false, error: '--tier must be 1, 2, 3 or 4.' };

  const named = list('--suite');
  const unknown = named.filter((s) => !isSuite(s));
  if (unknown.length > 0) {
    return { ok: false, error: `Unknown suite(s): ${unknown.join(', ')}. Model suites: ${Object.keys(MODEL_SUITES).join(', ')}.` };
  }
  const suites = named.length > 0 ? (named as ModelSuite[]) : TIER_SUITES[tier as Tier];
  if (suites.length === 0) {
    return { ok: false, error: `Tier ${tier} has no built suite to measure it on (the document suite is not built).` };
  }

  const limitText = value('--limit');
  const limit = limitText === undefined ? null : Number(limitText);
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) return { ok: false, error: '--limit must be a positive integer.' };

  return {
    ok: true,
    value: { tier: tier as Tier, suites, models: list('--model'), limit, record: limit === null && !argv.includes('--no-record') },
  };
}

/** The tier's configured order, then its evaluation candidates, without repeats. */
export function modelsFor(tier: Tier, config: ModelConfig, explicit: readonly string[] = []): readonly string[] {
  if (explicit.length > 0) return [...new Set(explicit)];
  const candidates = EVALUATION_CANDIDATES.filter((c) => c.tier === tier).map((c) => c.id);
  return [...new Set([...config.candidates(tier), ...candidates])];
}

// ------------------------------------------------------------------ running

export interface SuiteResult {
  readonly suite: ModelSuite;
  readonly version: number;
  readonly report: ModelReport;
  readonly passed: number;
  readonly total: number;
  readonly failedCases: readonly string[];
  /** Cases that never got an answer, by failure class: a transport error is not a wrong answer. */
  readonly errors: Readonly<Record<string, number>>;
  /** Exact counts over answered cases, so stored results can be combined without rounding. */
  readonly counts: SuiteCounts;
}

export interface SuiteCounts {
  readonly answered: number;
  readonly unanswered: number;
  readonly schemaValid: number;
  readonly schemaApplicable: number;
  readonly toolCallValid: number;
  readonly toolCallApplicable: number;
}

export interface ModelResult {
  readonly modelId: string;
  readonly suites: readonly SuiteResult[];
  readonly schemaAdherence: number | null;
  readonly toolCallCorrectness: number | null;
  readonly retrievalGrounding: number | null;
  readonly injectionResistance: number | null;
  readonly p50LatencyMs: number | null;
  readonly p95LatencyMs: number | null;
  /** Every case failed with an error: the model was not measured, it was not reached. */
  readonly unreachable: boolean;
  /** Cases the provider never answered (transport, timeout …), excluded from every score. */
  readonly unanswered: number;
}

export interface EvalRun {
  readonly tier: Tier;
  readonly startedAt: string;
  readonly limit: number | null;
  readonly suiteVersions: Readonly<Partial<Record<ModelSuite, number>>>;
  readonly models: readonly ModelResult[];
  readonly proposedOrder: readonly string[];
  readonly excluded: readonly { readonly modelId: string; readonly reason: string }[];
}

function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? null;
}

function ratio(values: readonly (boolean | null)[]): number | null {
  const applicable = values.filter((v): v is boolean => v !== null);
  return applicable.length === 0 ? null : applicable.filter(Boolean).length / applicable.length;
}

/**
 * Failures of the path to the model, not of the model: no answer was given, so
 * there is nothing to score. They are reported per suite and kept out of every
 * ratio — counting a 502 as a wrong answer would score the network. A model's
 * own failures (`invalid_output`, `malformed_response`, `content_filter` …)
 * stay in, because those are answers.
 */
const UNANSWERED = new Set(['transport', 'timeout', 'rate_limited', 'unauthorized', 'not_configured']);

function countsOf(report: ModelReport): SuiteCounts {
  const scored = report.cases.filter((c) => c.errorClass === null || !UNANSWERED.has(c.errorClass));
  return {
    answered: scored.length,
    unanswered: report.cases.length - scored.length,
    schemaValid: scored.filter((c) => c.schemaValid === true).length,
    schemaApplicable: scored.filter((c) => c.schemaValid !== null).length,
    toolCallValid: scored.filter((c) => c.toolCallValid === true).length,
    toolCallApplicable: scored.filter((c) => c.toolCallValid !== null).length,
  };
}

function summarise(modelId: string, suites: readonly SuiteResult[]): ModelResult {
  const cases = suites.flatMap((s) => s.report.cases);
  const scored = cases.filter((c) => c.errorClass === null || !UNANSWERED.has(c.errorClass));
  const answered = cases.filter((c) => c.errorClass === null);
  const ofSuite = (suite: ModelSuite) => scored.filter((c) => c.suite === suite);
  return {
    modelId,
    suites,
    schemaAdherence: ratio(scored.map((c) => c.schemaValid)),
    toolCallCorrectness: ratio(scored.map((c) => c.toolCallValid)),
    retrievalGrounding: ratio(ofSuite('grounding').map((c) => c.passed)),
    injectionResistance: ratio(ofSuite('injection').map((c) => c.passed)),
    p50LatencyMs: percentile(answered.map((c) => c.latencyMs), 50),
    p95LatencyMs: percentile(answered.map((c) => c.latencyMs), 95),
    unreachable: cases.length > 0 && scored.length === 0,
    unanswered: cases.length - scored.length,
  };
}

/** Why a model may not be proposed for the tier, or `null` when it may. */
export function disqualification(result: ModelResult, tier: Tier): string | null {
  if (result.unreachable) return 'unreachable: every case ended in a provider error';
  // A partial measurement is not a measurement: the cases that went unanswered
  // might be exactly the ones it fails.
  if (result.unanswered > 0) return `${result.unanswered} case(s) unanswered by the provider: re-run before proposing`;
  if (tier === 1) {
    if (result.schemaAdherence === null) return 'schema adherence not measured (needs parse or classify)';
    if (result.schemaAdherence < THRESHOLDS.tier1SchemaAdherence) {
      return `schema adherence ${result.schemaAdherence.toFixed(2)} < ${THRESHOLDS.tier1SchemaAdherence}`;
    }
  }
  if (result.toolCallCorrectness === null) return 'tool-call correctness not measured (needs a tool suite)';
  if (result.toolCallCorrectness < THRESHOLDS.toolCallCorrectness) {
    return `tool-call correctness ${result.toolCallCorrectness.toFixed(2)} < ${THRESHOLDS.toolCallCorrectness}`;
  }
  return null;
}

/**
 * The proposed order: qualifying models ranked by §14's selection criteria —
 * schema reliability, tool-calling, grounding, injection resistance, then
 * latency. A `null` score ranks below any measured one.
 */
export function proposeOrder(results: readonly ModelResult[], tier: Tier): {
  order: readonly string[];
  excluded: readonly { modelId: string; reason: string }[];
} {
  const excluded: { modelId: string; reason: string }[] = [];
  const qualifying: ModelResult[] = [];
  for (const r of results) {
    const reason = disqualification(r, tier);
    if (reason) excluded.push({ modelId: r.modelId, reason });
    else qualifying.push(r);
  }
  const score = (v: number | null) => v ?? -1;
  qualifying.sort(
    (a, b) =>
      score(b.schemaAdherence) - score(a.schemaAdherence) ||
      score(b.toolCallCorrectness) - score(a.toolCallCorrectness) ||
      score(b.retrievalGrounding) - score(a.retrievalGrounding) ||
      score(b.injectionResistance) - score(a.injectionResistance) ||
      (a.p50LatencyMs ?? Infinity) - (b.p50LatencyMs ?? Infinity),
  );
  return { order: qualifying.map((r) => r.modelId), excluded };
}

/** Why a run cannot propose an order, or `null` when it can. */
export function partialRunReason(args: EvalArgs): string | null {
  if (args.limit !== null) return `partial run (--limit ${args.limit}): a wire check, not a measurement`;
  const missing = TIER_SUITES[args.tier].filter((s) => !args.suites.includes(s));
  if (missing.length > 0) return `not measured on every Tier ${args.tier} suite (missing: ${missing.join(', ')})`;
  return null;
}

export interface RunOptions {
  readonly provider: AiProvider;
  readonly args: EvalArgs;
  readonly models: readonly string[];
  readonly timeoutMs?: number;
  readonly now?: () => Date;
  /** Progress, one line per suite per model. */
  readonly log?: (line: string) => void;
}

/** Run every model over every suite, one case at a time, and propose an order. */
export async function runEvaluation(options: RunOptions): Promise<EvalRun> {
  const { provider, args } = options;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => undefined);
  const startedAt = now().toISOString();

  const built = args.suites.map((suite) => {
    const all = MODEL_SUITES[suite].build();
    return { suite, cases: args.limit === null ? all : all.slice(0, args.limit) };
  });

  const models: ModelResult[] = [];
  for (const modelId of options.models) {
    const suites: SuiteResult[] = [];
    for (const { suite, cases } of built) {
      const report = await evaluateModel(provider, modelId, cases, options.timeoutMs);
      const passed = report.cases.filter((c) => c.passed === true).length;
      const errors: Record<string, number> = {};
      for (const c of report.cases) if (c.errorClass) errors[c.errorClass] = (errors[c.errorClass] ?? 0) + 1;
      suites.push({
        suite,
        version: MODEL_SUITES[suite].version,
        report,
        passed,
        total: report.cases.length,
        failedCases: report.cases.filter((c) => c.passed !== true).map((c) => c.caseId),
        errors,
        counts: countsOf(report),
      });
      const errorText = Object.keys(errors).length > 0 ? ` (errors: ${JSON.stringify(errors)})` : '';
      log(`${modelId}  ${suite}: ${passed}/${report.cases.length}${errorText}`);
    }
    models.push(summarise(modelId, suites));
  }

  // A wire check or a subset of the tier's suites is not a measurement of the
  // tier: its scores are reported, and nothing is proposed from them.
  const partial = partialRunReason(args);
  const { order, excluded } = partial
    ? { order: [], excluded: models.map((m) => ({ modelId: m.modelId, reason: partial })) }
    : proposeOrder(models, args.tier);
  return {
    tier: args.tier,
    startedAt,
    limit: args.limit,
    suiteVersions: Object.fromEntries(args.suites.map((s) => [s, MODEL_SUITES[s].version])),
    models,
    proposedOrder: order,
    excluded,
  };
}

// ------------------------------------------------------------------ report

const cell = (v: number | null, digits = 2): string => (v === null ? 'not measured' : v.toFixed(digits));

/** The report a human reads before accepting an order. */
export function renderEvalReport(run: EvalRun): string {
  const suites = Object.keys(run.suiteVersions) as ModelSuite[];
  const lines: string[] = [
    `# Model evaluation — Tier ${run.tier}`,
    '',
    `Run ${run.startedAt}. Suites: ${suites.map((s) => `${s} v${run.suiteVersions[s]}`).join(', ')}.`,
  ];
  if (run.limit !== null) {
    lines.push(
      '',
      `> **Partial run: the first ${run.limit} case(s) of each suite.** A wire check, not a measurement. Do not route on it.`,
    );
  }

  lines.push(
    '',
    '## Scores',
    '',
    'Scores count only the cases the provider answered; unanswered cases (transport, timeout …) are listed, not scored.',
    '',
    '| Model | Schema adherence | Tool-call correctness | Retrieval grounding | Injection resistance | p50 ms | p95 ms | Unanswered |',
    '|---|---|---|---|---|---|---|---|',
    ...run.models.map(
      (m) =>
        `| ${m.modelId}${m.unreachable ? ' (unreachable)' : ''} | ${cell(m.schemaAdherence)} | ${cell(m.toolCallCorrectness)} | ` +
        `${cell(m.retrievalGrounding)} | ${cell(m.injectionResistance)} | ${cell(m.p50LatencyMs, 0)} | ${cell(m.p95LatencyMs, 0)} | ${m.unanswered} |`,
    ),
    '',
    '## Pass rate by suite',
    '',
    `| Model | ${suites.join(' | ')} |`,
    `|---|${suites.map(() => '---').join('|')}|`,
    ...run.models.map(
      (m) =>
        `| ${m.modelId} | ${suites
          .map((s) => {
            const r = m.suites.find((x) => x.suite === s);
            return r ? `${r.passed}/${r.total}` : '—';
          })
          .join(' | ')} |`,
    ),
    '',
    '## Proposed order',
    '',
    run.proposedOrder.length > 0
      ? `\`AI_TIER${run.tier}_MODELS=${run.proposedOrder.join(',')}\``
      : '**Nothing is proposed.** The tier keeps its current configuration; see "Not proposed" for why.',
    '',
    'Proposed only. A human accepts it into the environment; this run changed no configuration.',
  );

  if (run.excluded.length > 0) {
    lines.push('', '### Not proposed', '', ...run.excluded.map((e) => `- \`${e.modelId}\`: ${e.reason}`));
  }

  lines.push('', '## Failures', '');
  for (const m of run.models) {
    for (const s of m.suites) {
      if (s.failedCases.length === 0) continue;
      const errors = Object.entries(s.errors).map(([k, n]) => `${k} ×${n}`).join(', ');
      lines.push(`- \`${m.modelId}\` ${s.suite}: ${s.failedCases.join(', ')}${errors ? ` — provider errors: ${errors}` : ''}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
