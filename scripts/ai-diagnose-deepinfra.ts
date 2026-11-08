/** Six synthetic probes, output-free diagnostics, no promotion or recording. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { aiProviderSettings, env, loadDotEnv } from '../src/lib/env';
import { evaluationProviderIdentity } from '../src/server/ai-evaluations';
import { DEEPINFRA_MEASUREMENT_MODELS } from '../src/server/ai/config/models';
import { resolveRequestProfiles } from '../src/server/ai/config/request-profiles';
import { createNvidiaProvider } from '../src/server/ai/provider/nvidia-build';
import { evaluateModel } from '../src/server/ai/eval/harness';
import { maxTokensFor, MODEL_SUITES } from '../src/server/ai/eval/runner';
import { diagnoseAnalysis, diagnoseDocument, FailureDiagnosticsSchema, type FailureDiagnostics } from './lib/ai-failure-diagnostics';
import { requestReserve } from './lib/ai-eval-budget';
import { reserveInActiveLedger } from './lib/inference-budget';
import { otherDeepinfraSpend } from './lib/deepinfra-accounting';

const endpoint = 'https://api.deepinfra.com/v1/openai';
const root = path.resolve('eval/reports/deepinfra-2026-11-07');
const directory = path.join(root, 'diagnostics');
const amount = z.number().finite().nonnegative();
interface Event { at: string; caseId: string; model: string; reservedUsd: number; accountedUsd: number; status?: number; promptTokens?: number; completionTokens?: number; }
async function read(file: string): Promise<unknown> { return JSON.parse(await readFile(file, 'utf8')); }
async function save(file: string, body: unknown) {
  await writeFile(`${file}.tmp`, JSON.stringify(body, null, 2) + '\n');
  await rename(`${file}.tmp`, file);
}
async function main() {
  const analysisOnly = process.argv.includes('--analysis-only');
  const argv = process.argv.slice(2).filter(a => a !== '--analysis-only');
  if (process.argv.slice(2).filter(a => a === '--analysis-only').length > 1) throw new Error('Duplicate analysis-only flag.');
  const live = argv.length === 2 && argv.includes('--run') && argv.includes('--no-record');
  if (!live && !(argv.length === 1 && argv[0] === '--plan')) throw new Error('Use --plan or --run --no-record. Recording and arbitrary case/model overrides are unsupported.');
  loadDotEnv();
  const e = env(), ai = aiProviderSettings(e);
  if (evaluationProviderIdentity(ai.baseUrl) !== endpoint || (live && !ai.apiKey)) throw new Error('Require the direct DeepInfra endpoint and its key.');
  const profiles = resolveRequestProfiles(e.AI_REQUEST_PROFILES);
  const plan = [
    ...['analysis-001', 'analysis-006', 'analysis-015'].map(id => ({ tier: 2 as const, suite: 'analysis' as const, id, model: DEEPINFRA_MEASUREMENT_MODELS[2][0]! })),
    ...['doc-001', 'doc-002', 'doc-018'].map(id => ({ tier: 4 as const, suite: 'document' as const, id, model: DEEPINFRA_MEASUREMENT_MODELS[4][0]! })),
  ].filter(r => !analysisOnly || r.suite === 'analysis').map(r => {
    if (/^(google|anthropic)\//i.test(r.model)) throw new Error('Excluded model publisher.');
    const testCase = MODEL_SUITES[r.suite].build().find(c => c.id === r.id);
    if (!testCase) throw new Error('Diagnostic case is missing.');
    return { ...r, testCase, maxTokens: maxTokensFor(r.tier, r.suite) };
  });
  const catalogue = z.object({ providerIdentity: z.literal(endpoint), data: z.array(z.object({ id: z.string(), metadata: z.object({ pricing: z.object({ input_tokens: amount.positive(), output_tokens: amount.positive() }).partial() }) })) }).parse(await read(path.join(root, 'catalogue.json')));
  const price = (model: string) => {
    const p = catalogue.data.find(c => c.id === model)?.metadata.pricing;
    if (!p?.input_tokens || !p.output_tokens) throw new Error('Missing model prices.');
    return { input: p.input_tokens, output: p.output_tokens };
  };
  const reserve = (r: typeof plan[number]) => requestReserve(r.testCase, r.maxTokens) * Math.max(price(r.model).input, price(r.model).output) / 1_000_000;
  console.log(JSON.stringify({ diagnosticOnly: true, providerIdentity: endpoint, cases: plan.map(({ testCase: _testCase, ...r }) => { void _testCase; return r; }), maximumReservedUsd: plan.reduce((n, r) => n + reserve(r), 0) }, null, 2));
  if (!live) return;
  await mkdir(directory, { recursive: true });
  // Shared with the measurement coordinator: no overlapping account spending.
  const lockPath = path.resolve('eval/reports/.deepinfra-account.lock');
  const lock = await open(lockPath, 'wx');
  try {
    await lock.writeFile(`${process.pid}\n`);
    const ledgerPath = path.join(directory, 'usage.json');
    const baseline = await otherDeepinfraSpend(path.resolve('eval/reports'), ledgerPath);
    let prior: unknown;
    try { prior = await read(ledgerPath); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const ledger = prior === undefined ? { providerIdentity: endpoint, events: [] as Event[] } : z.object({ providerIdentity: z.literal(endpoint), events: z.array(z.object({ at: z.iso.datetime(), caseId: z.string(), model: z.string(), reservedUsd: amount, accountedUsd: amount, status: z.number().int().optional(), promptTokens: amount.optional(), completionTokens: amount.optional() })) }).parse(prior);
    const spent = () => ledger.events.reduce((n, event) => n + event.accountedUsd, 0);
    const files = execFileSync('git', ['ls-files', '-z', 'src/server/ai', 'src/lib/env.ts', 'src/server/ai-evaluations.ts']).toString().split('\0').filter(Boolean).sort();
    files.push('scripts/ai-diagnose-deepinfra.ts', 'scripts/lib/ai-failure-diagnostics.ts', 'scripts/lib/ai-eval-budget.ts', 'scripts/lib/deepinfra-accounting.ts', 'scripts/lib/inference-budget.ts');
    const hash = createHash('sha256');
    for (const f of files) hash.update(f).update(await readFile(f));
    const startedAt = new Date().toISOString();
    const report = { diagnosticOnly: true, completeMeasurement: false, recorded: false, productionEligible: false, provider: 'DeepInfra', providerIdentity: endpoint, startedAt, sourceFingerprint: hash.digest('hex'), timeoutMs: e.AI_REQUEST_TIMEOUT_MS, stop: 'running', rows: [] as object[] };
    const file = path.join(directory, `${startedAt.replace(/[:.]/g, '-')}.json`);
    await writeFile(file, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    try {
      for (const r of plan) {
        const reservedUsd = reserve(r);
        const event: Event = { at: new Date().toISOString(), model: r.model, caseId: r.id, reservedUsd, accountedUsd: reservedUsd };
        // ADR-56: refresh the project total, check the cap and persist the
        // reservation under the project-wide lock, before any HTTP request.
        // The campaign and DeepInfra account checks run inside the same critical
        // section, so concurrent workers cannot all pass them before any push.
        await reserveInActiveLedger(process.cwd(), ledgerPath, spent, reservedUsd, async () => {
          if (spent() + reservedUsd > 0.25 || baseline + spent() + reservedUsd > 4.50) throw new Error('Diagnostic or account spend cap reached before request.');
          ledger.events.push(event);
          await save(ledgerPath, ledger);
        });
        const provider = createNvidiaProvider({ apiKey: ai.apiKey, baseUrl: ai.baseUrl, requestProfiles: profiles, defaultTimeoutMs: e.AI_REQUEST_TIMEOUT_MS, fetch: async (url, init) => {
          if (url !== `${endpoint}/chat/completions`) throw new Error('Unexpected endpoint.');
          const response = await fetch(url, init);
          event.status = response.status;
          const body = await response.clone().json().catch(() => ({}));
          const input = body.usage?.prompt_tokens, output = body.usage?.completion_tokens;
          if ([input, output].every(n => Number.isSafeInteger(n) && n >= 0)) {
            event.promptTokens = input; event.completionTokens = output;
            const p = price(r.model);
            event.accountedUsd = (input * p.input + output * p.output) / 1_000_000;
          }
          await save(ledgerPath, ledger);
          return response;
        } });
        let diagnostics: FailureDiagnostics | null = null;
        let shape: { contentCharacters: number; reasoningCharacters: number; toolCalls: number } | null = null;
        const observed = { ...provider, chat: async (...args: Parameters<typeof provider.chat>) => {
          const response = await provider.chat(...args);
          if (response.ok) {
            const { content, toolCalls, reasoning } = response.value;
            shape = { contentCharacters: content?.length ?? 0, reasoningCharacters: reasoning?.length ?? 0, toolCalls: toolCalls.length };
            diagnostics = r.suite === 'analysis' ? diagnoseAnalysis(r.id, content, toolCalls) : diagnoseDocument(r.id, content);
            FailureDiagnosticsSchema.parse(diagnostics);
          }
          return response;
        } };
        const scored = (await evaluateModel(observed, r.model, [r.testCase], e.AI_REQUEST_TIMEOUT_MS, r.maxTokens)).cases[0]!;
        if (diagnostics !== null && (diagnostics as FailureDiagnostics).passed !== scored.passed) throw new Error('Diagnostic/scorer verdict mismatch.');
        const row = { tier: r.tier, model: r.model, suite: r.suite, suiteVersion: MODEL_SUITES[r.suite].version, maxTokens: r.maxTokens, requestProfile: provider.requestProfileFor?.(r.model), result: scored, shape, diagnostics };
        report.rows.push(row);
        await save(file, report);
        console.log(JSON.stringify(row));
        if (event.status !== undefined && event.status >= 400) throw new Error(`Provider HTTP ${event.status}; stopped without retry.`);
      }
      report.stop = 'complete; diagnostics only; no recording or promotion';
    } catch (error) { report.stop = 'stopped; completed diagnostics and unknown-usage reserves retained'; throw error; }
    finally { await save(file, report); }
    console.log(`Diagnostic report: ${file}`);
  } finally { await lock.close(); await unlink(lockPath); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
