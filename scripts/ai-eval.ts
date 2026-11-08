/**
 * `npm run ai:eval` — measure candidate models on the golden suites
 * ([AI-SYSTEM.md §14](../docs/AI-SYSTEM.md), TESTING.md §7a).
 *
 * ```
 * npm run ai:eval -- --tier 1                           # every Tier 1 model, every Tier 1 suite
 * npm run ai:eval -- --tier 2 --suite grounding         # one suite
 * npm run ai:eval -- --tier 1 --model openai/gpt-oss-20b --limit 3   # a wire check
 * ```
 *
 * Online, manual and **never in CI**: it calls the provider, costs credits, and
 * model output is not deterministic. Writes `eval/reports/<timestamp>-tier<n>.md`
 * and a `.json` beside it, and stores a full run in `ai_model_evaluations`
 * (`--no-record` to skip), which the server loads over the declared capability
 * matrix at its next start (ADR-44). It proposes a routing order; it never
 * changes the tier lists.
 *
 * **No real financial data is sent.** Every prompt is from the golden suites:
 * fixed questions over a synthetic fixture.
 *
 * Behind an HTTP proxy, run with `NODE_USE_ENV_PROXY=1` (Node's `fetch`
 * ignores `HTTPS_PROXY` otherwise).
 */

import { isFreeHost, loadInferenceBudget, reserveUnledgeredSpend, takeReserveFlag } from './lib/inference-budget';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { aiProviderSettings, env, loadDotEnv } from '../src/lib/env';
import { resolveModelConfig } from '../src/server/ai/config/models';
import { createNvidiaProvider } from '../src/server/ai/provider/nvidia-build';
import { modelsFor, parseEvalArgs, renderEvalReport, runEvaluation } from '../src/server/ai/eval/runner';
import { assertEvaluationRecordingSupported, evaluationProviderIdentity, recordEvaluationRun } from '../src/server/ai-evaluations';
import { closeDb } from '../src/server/db/client';

async function main(): Promise<void> {
  // ADR-56: `--reserve-usd` is consumed here, never by the evaluation parser.
  const reserve = takeReserveFlag(process.argv.slice(2));
  const parsed = parseEvalArgs(reserve.argv);
  if (!parsed.ok) {
    console.error(parsed.error);
    process.exitCode = 2;
    return;
  }
  const args = parsed.value;

  loadDotEnv();
  const e = env();
  const ai = aiProviderSettings(e);
  if (!ai.apiKey) {
    console.error('AI_API_KEY is not configured. ai:eval measures live models and cannot run without it.');
    process.exitCode = 1;
    return;
  }

  const config = resolveModelConfig({
    tier1: e.AI_TIER1_MODELS,
    tier2: e.AI_TIER2_MODELS,
    tier3: e.AI_TIER3_MODELS,
    tier4: e.AI_TIER4_MODELS,
    requestProfiles: e.AI_REQUEST_PROFILES,
  });
  if (args.record) assertEvaluationRecordingSupported(evaluationProviderIdentity(ai.baseUrl));
  const models = modelsFor(args.tier, config, args.models);
  console.log(`Tier ${args.tier}: ${models.length} model(s) × ${args.suites.join(', ')}${args.limit ? ` (first ${args.limit} case(s) each)` : ''}`);

  // ADR-56: this harness has no per-request cost accounting, so a paid host
  // needs an operator-stated upper bound, reserved against the project cap.
  if (!isFreeHost(ai.baseUrl, await loadInferenceBudget())) {
    if (reserve.reserveUsd === undefined) {
      console.error('This host is paid. Pass --reserve-usd <upper bound in USD> (reserved against the project cap, ADR-56), or use a budgeted runner such as npm run ai:measure:deepinfra.');
      process.exitCode = 1;
      return;
    }
    await reserveUnledgeredSpend(process.cwd(), { script: 'ai:eval', providerIdentity: new URL(ai.baseUrl).origin, reservedUsd: reserve.reserveUsd, note: `Tier ${args.tier}: ${args.suites.join(', ')}` });
  }

  const provider = createNvidiaProvider({
    requestProfiles: config.requestProfiles,
    apiKey: ai.apiKey,
    baseUrl: ai.baseUrl,
    fetch: globalThis.fetch as never,
    defaultTimeoutMs: e.AI_REQUEST_TIMEOUT_MS,
  });

  const measured = await runEvaluation({
    provider,
    args,
    models,
    timeoutMs: e.AI_REQUEST_TIMEOUT_MS,
    log: (line) => console.log(`  ${line}`),
  });

  const run = { ...measured, providerIdentity: evaluationProviderIdentity(ai.baseUrl) };
  const dir = path.resolve('eval/reports');
  await mkdir(dir, { recursive: true });
  // The run's own timestamp, to the second, so a later run on the same day —
  // a targeted re-run above all — never replaces an earlier report.
  const stamp = run.startedAt.slice(0, 19).replace(/:/g, '-');
  const stem = `${stamp}-tier${run.tier}${args.limit ? '-partial' : ''}`;
  const markdown = renderEvalReport(run);
  // 'wx' refuses to overwrite: two runs in the same second fail loudly instead.
  await writeFile(path.join(dir, `${stem}.md`), markdown, { encoding: 'utf8', flag: 'wx' });
  // The JSON keeps scores and failing case ids, never the model's output text.
  const json = {
    ...run,
    models: run.models.map((m) => ({
      ...m,
      suites: m.suites.map(({ report, ...rest }) => ({ ...rest, p50LatencyMs: report.p50LatencyMs, p95LatencyMs: report.p95LatencyMs })),
    })),
  };
  await writeFile(path.join(dir, `${stem}.json`), `${JSON.stringify(json, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });

  console.log(`\n${markdown}`);
  console.log(`Written: eval/reports/${stem}.md and .json. The tier lists were not changed.`);

  if (args.record) {
    try {
      const rows = await recordEvaluationRun(run);
      console.log(`Stored ${rows} row(s) in ai_model_evaluations; the server uses them from its next start.`);
    } catch (error) {
      console.error(`NOT stored in ai_model_evaluations: ${error instanceof Error ? error.message : String(error)}`);
      console.error('The report files are complete. Run the migrations (npm run db:migrate) and re-run to store.');
      process.exitCode = 1;
    } finally {
      await closeDb();
    }
  } else {
    console.log(args.limit ? 'Partial run: not stored.' : 'Not stored (--no-record).');
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
