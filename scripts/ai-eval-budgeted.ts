/** Resumable, never-recording suite measurements. Uses the unchanged harness/scorers. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { requestReserve, resetMs } from './lib/ai-eval-budget';
import { aiProviderSettings, env, loadDotEnv } from '../src/lib/env';
import { evaluationProviderIdentity } from '../src/server/ai-evaluations';
import { resolveModelConfig } from '../src/server/ai/config/models';
import { createNvidiaProvider } from '../src/server/ai/provider/nvidia-build';
import { evaluateModel, reportFromCases, type CaseResult } from '../src/server/ai/eval/harness';
import { countsOf, maxTokensFor, MODEL_SUITES, parseEvalArgs, partialRunReason, renderEvalReport, summarise, type EvalRun, type SuiteResult } from '../src/server/ai/eval/runner';

async function readJson<T>(file: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
async function save(file: string, value: unknown): Promise<void> {
  await writeFile(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  await rename(`${file}.tmp`, file);
}
const delay = async (ms: number): Promise<void> => {
  // Short timer segments allow interruption; this wait is outside the adapter.
  const until = Date.now() + ms;
  while (Date.now() < until) await new Promise(r => setTimeout(r, Math.min(30_000, until - Date.now())));
};
interface Ledger { day: string; requests: number; reservedTokens: number; events: { at: string; model: string; status: number; reportedTokens: number | null; reservedTokens: number; }[]; }
interface Checkpoint { identity: string; providerIdentity: string; model: string; tier: number; suite: string; version: number; maxTokens: number; startedAt: string; cases: CaseResult[]; }

async function main(): Promise<void> {
  const parsed = parseEvalArgs(process.argv.slice(2));
  if (!parsed.ok) throw new Error(parsed.error);
  const args = parsed.value;
  if (args.record || args.limit !== null || args.models.length !== 1 || args.suites.length !== 1) {
    throw new Error('Require --no-record, one explicit --model, one --suite, and no --limit.');
  }
  loadDotEnv();
  const e = env();
  const ai = aiProviderSettings(e);
  if (!ai.apiKey) throw new Error('AI_API_KEY is not configured.');
  const endpoint = evaluationProviderIdentity(ai.baseUrl);
  if (new URL(endpoint).hostname !== 'api.groq.com') throw new Error('This budget ledger is scoped to Groq.');
  const model = args.models[0]!;
  const suite = args.suites[0]!;
  const maxTokens = maxTokensFor(args.tier, suite);
  const cases = MODEL_SUITES[suite].build();
  const config = resolveModelConfig({ requestProfiles: e.AI_REQUEST_PROFILES });
  const dir = path.resolve('eval/reports');
  await mkdir(dir, { recursive: true });
  const lockPath = path.join(dir, '.groq-measurement.lock');
  const lock = await open(lockPath, 'wx');
  try {
    await lock.writeFile(`${process.pid}\n`);
    const day = new Date().toISOString().slice(0, 10);
    const ledgerPath = path.join(dir, `groq-budget-${day}.json`);
    // Bootstrap this session's earlier usage rather than starting at zero.
    const baseline = await readJson<{chatRequestsIncludingReachability: number; conservativeTokenReserve: number}>(path.join(dir, `groq-${day}`, 'daily-usage-summary.json'));
    const ledger = await readJson<Ledger>(ledgerPath) ?? { day, requests: baseline?.chatRequestsIncludingReachability ?? 0, reservedTokens: baseline?.conservativeTokenReserve ?? 0, events: [] };
    if (ledger.day !== day) throw new Error('Wrong ledger date.');
    const files = execFileSync('git', ['ls-files', '-z', 'src/server/ai', 'src/lib/env.ts', 'src/server/ai-evaluations.ts']).toString().split('\0').filter(Boolean).sort();
    files.push('scripts/ai-eval-budgeted.ts', 'scripts/lib/ai-eval-budget.ts');
    const hash = createHash('sha256');
    for (const file of files) hash.update(file).update(await readFile(file));
    hash.update(JSON.stringify({ endpoint, model, tier: args.tier, suite, version: MODEL_SUITES[suite].version, maxTokens, profile: config.requestProfiles.forModel(model) }));
    const identity = hash.digest('hex');
    const stem = `checkpoint-tier${args.tier}-${suite}-${model.replace(/[^a-zA-Z0-9-]/g, '-')}`;
    const checkpointPath = path.join(dir, `${stem}.json`);
    const checkpoint = await readJson<Checkpoint>(checkpointPath) ?? { identity, providerIdentity: endpoint, model, tier: args.tier, suite, version: MODEL_SUITES[suite].version, maxTokens, startedAt: new Date().toISOString(), cases: [] };
    if (checkpoint.identity !== identity || checkpoint.providerIdentity !== endpoint) throw new Error('Checkpoint source/provider/profile provenance differs; do not resume.');
    const ids = new Set(cases.map(c => c.id));
    const finished = new Set(checkpoint.cases.map(c => c.caseId));
    if (finished.size !== checkpoint.cases.length || checkpoint.cases.some(c => !ids.has(c.caseId) || c.modelId !== model || c.suite !== suite)) throw new Error('Invalid checkpoint cases.');
    let reservedForCall = 0;
    let nextAt = ledger.events.length ? Date.parse(ledger.events.at(-1)!.at) + 60_000 : 0;
    let quotaError = false;
    const provider = createNvidiaProvider({ apiKey: ai.apiKey, baseUrl: ai.baseUrl, requestProfiles: config.requestProfiles, defaultTimeoutMs: e.AI_REQUEST_TIMEOUT_MS,
      fetch: async (url, init) => {
        if (new URL(url).hostname !== new URL(endpoint).hostname) throw new Error('Unexpected provider endpoint.');
        const response = await globalThis.fetch(url, init);
        const body = await response.clone().json().catch(() => ({}));
        const used = body.usage?.total_tokens;
        const reported = Number.isSafeInteger(used) && used >= 0 ? used as number : null;
        if (reported !== null) ledger.reservedTokens += reported - reservedForCall;
        ledger.events.push({ at: new Date().toISOString(), model, status: response.status, reportedTokens: reported, reservedTokens: reported ?? reservedForCall });
        // Wait for the minute bucket to refill, OUTSIDE the next provider call.
        nextAt = Date.now() + Math.max(args.intervalMs ?? 3000, resetMs(response.headers.get('x-ratelimit-reset-tokens')) + 1500);
        if (response.status === 429) quotaError = true;
        await save(ledgerPath, ledger);
        return response;
      },
    });
    const profile = provider.requestProfileFor?.(model);
    let stop: string | null = null;
    for (const testCase of cases) {
      if (finished.has(testCase.id)) continue;
      if (new Date().toISOString().slice(0, 10) !== day) { stop = 'Date boundary: resume with the next daily ledger.'; break; }
      // UTF-8 text bytes bound input tokens; image payload bytes are NOT tokens.
      reservedForCall = requestReserve(testCase, maxTokens);
      if (ledger.requests >= 950 || ledger.reservedTokens + reservedForCall > 190_000) { stop = 'Conservative daily reserve reached; no request sent.'; break; }
      if (nextAt > Date.now()) await delay(nextAt - Date.now());
      if (new Date().toISOString().slice(0, 10) !== day) { stop = 'Date boundary reached while pacing; no request sent.'; break; }
      ledger.requests += 1;
      ledger.reservedTokens += reservedForCall;
      await save(ledgerPath, ledger); // Reserve before calling, including crashes/timeouts.
      const result = await evaluateModel(provider, model, [testCase], e.AI_REQUEST_TIMEOUT_MS, maxTokens);
      checkpoint.cases.push(result.cases[0]!);
      await save(checkpointPath, checkpoint);
      console.log(`${suite}: ${checkpoint.cases.length}/${cases.length}; ${testCase.id}: ${result.cases[0]!.errorClass ?? (result.cases[0]!.passed ? 'pass' : 'fail')}; daily reserve ${ledger.reservedTokens}`);
      if (quotaError) { stop = 'HTTP 429: stopped, no retry.'; break; }
    }
    if (checkpoint.cases.length !== cases.length) {
      console.log(`PARTIAL CHECKPOINT: ${stop}. ${checkpoint.cases.length}/${cases.length} retained; no order proposed or recorded.`);
      return;
    }
    const report = reportFromCases(model, cases.map(c => checkpoint.cases.find(r => r.caseId === c.id)!));
    const errors: Record<string, number> = {};
    const finishReasons: Record<string, number> = {};
    for (const c of report.cases) {
      if (c.errorClass) errors[c.errorClass] = (errors[c.errorClass] ?? 0) + 1;
      if (c.finishReason) finishReasons[c.finishReason] = (finishReasons[c.finishReason] ?? 0) + 1;
    }
    const result: SuiteResult = { suite, version: MODEL_SUITES[suite].version, maxTokens, report, counts: countsOf(report), total: cases.length, passed: report.cases.filter(c => c.passed === true).length, failedCases: report.cases.filter(c => c.passed !== true).map(c => c.caseId), errors, finishReasons };
    const run: EvalRun = { providerIdentity: endpoint, tier: args.tier, startedAt: checkpoint.startedAt, limit: null, requestIntervalMs: args.intervalMs, requestTimeoutMs: e.AI_REQUEST_TIMEOUT_MS, suiteVersions: { [suite]: result.version }, models: [{ ...summarise(model, [result]), requestProfile: profile }], proposedOrder: [], excluded: [{ modelId: model, reason: partialRunReason(args) ?? 'Checkpoint report only: combine complete tier evidence before proposing an order.' }] };
    const reportStem = `${checkpoint.startedAt.slice(0, 19).replace(/:/g, '-')}-tier${args.tier}-${suite}`;
    const json = { ...run, models: run.models.map(m => ({ ...m, suites: m.suites.map(({ report: r, ...rest }) => ({ ...rest, p50LatencyMs: r.p50LatencyMs, p95LatencyMs: r.p95LatencyMs })) })) };
    await save(path.join(dir, `${reportStem}.json`), json);
    await writeFile(path.join(dir, `${reportStem}.md`), renderEvalReport(run));
    console.log(`Completed ${result.passed}/${result.total}. Saved ${reportStem}; no recording or routing changes.`);
  } finally { await lock.close(); await unlink(lockPath); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
