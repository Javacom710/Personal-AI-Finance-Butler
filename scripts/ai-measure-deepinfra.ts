/** Finite, resumable DeepInfra-only Phase 8 run. Never records or edits routing. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { aiProviderSettings, env, loadDotEnv } from '../src/lib/env';
import { evaluationProviderIdentity } from '../src/server/ai-evaluations';
import { DEEPINFRA_MEASUREMENT_MODELS, resolveModelConfig, type Tier } from '../src/server/ai/config/models';
import { requestProfileIdentity, resolveRequestProfiles } from '../src/server/ai/config/request-profiles';
import { createNvidiaProvider } from '../src/server/ai/provider/nvidia-build';
import { evaluateModel, reportFromCases, type CaseResult } from '../src/server/ai/eval/harness';
import { countsOf, maxTokensFor, MODEL_SUITES, proposeOrder, renderEvalReport, summarise, TIER_SUITES, type EvalRun, type SuiteResult } from '../src/server/ai/eval/runner';
import { assessEntry, candidateReadiness, validatePlan, type Entry, type Progress } from './lib/ai-measurement-workflow';
import { requestReserve } from './lib/ai-eval-budget';
import { otherDeepinfraSpend } from './lib/deepinfra-accounting';
import { reserveInActiveLedger } from './lib/inference-budget';
import { diagnoseAnalysis, diagnoseDocument, FailureDiagnosticsSchema, summariseDiagnostics, type FailureDiagnostics } from './lib/ai-failure-diagnostics';

const endpoint = 'https://api.deepinfra.com/v1/openai';
const originalDirectory = path.resolve('eval/reports/deepinfra-2026-11-07');
// Leave room for catalogue/reachability probes and unknown provider overhead.
const budgetUsd = 4.75;
interface Checkpoint { identity: string; providerIdentity: string; model: string; tier: Tier; suite: string; version: number; maxTokens: number; startedAt: string; cases: CaseResult[]; diagnostics?: Record<string, FailureDiagnostics>; }
interface Usage { at: string; model: string; tier: Tier; suite: string; caseId: string; reservedUsd: number; accountedUsd: number; status?: number; promptTokens?: number; completionTokens?: number; }
async function read<T>(file: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
let writes = Promise.resolve();
function save(file: string, body: unknown) {
  const text = JSON.stringify(body, null, 2) + '\n';
  writes = writes.then(async () => {
    await writeFile(`${file}.tmp`, text);
    await rename(`${file}.tmp`, file);
  });
  return writes;
}
async function main() {
  const argv = process.argv.slice(2);
  let campaign: string | undefined;
  const campaignIndex = argv.indexOf('--campaign');
  if (campaignIndex !== -1) {
    campaign = argv[campaignIndex + 1];
    if (!campaign || campaign.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(campaign)) throw new Error('Invalid campaign name.');
    argv.splice(campaignIndex, 2);
  }
  const selectedTier1 = argv.includes('--selected-tier1');
  if (selectedTier1) {
    argv.splice(argv.indexOf('--selected-tier1'), 1);
    if (!campaign) throw new Error('--selected-tier1 requires a fresh named --campaign.');
  }
  const plan = selectedTier1 ? 'selected-tier1' : 'qwen-candidates';
  // The selected plan follows the reviewed application default (ADR-55),
  // never an environment override or a request-supplied model identifier.
  const measurementModels: Readonly<Partial<Record<Tier, readonly string[]>>> = selectedTier1
    ? { 1: resolveModelConfig().candidates(1) }
    : DEEPINFRA_MEASUREMENT_MODELS;
  const directory = campaign ? `${originalDirectory}-${campaign}` : originalDirectory;
  const live = argv.includes('--run');
  if (argv.some(a => !['--run', '--no-record', '--status'].includes(a)) ||
      (live ? !argv.includes('--no-record') || argv.length !== 2 : argv.length !== 1 || argv[0] !== '--status')) {
    throw new Error('Use --status (offline) or --run --no-record, optionally --campaign <name> and --selected-tier1. Recording is unsupported.');
  }
  loadDotEnv();
  const e = env();
  const ai = aiProviderSettings(e);
  if (evaluationProviderIdentity(ai.baseUrl) !== endpoint || (live && !ai.apiKey)) throw new Error('Require the direct DeepInfra endpoint and its configured key.');
  const profiles = resolveRequestProfiles(e.AI_REQUEST_PROFILES);
  const entries: Entry[] = ([1, 2, 3, 4] as const).flatMap(tier => (measurementModels[tier] ?? []).flatMap(model => TIER_SUITES[tier].map(suite => ({ tier, model, suite }))));
  validatePlan(entries);
  if (entries.some(r => /^(google|anthropic)\//i.test(r.model))) throw new Error('Google/Anthropic models are excluded from this run.');
  const catalogue = await read<{ providerIdentity: string; data: { id: string; metadata: { pricing: { input_tokens: number; output_tokens: number } } }[] }>(path.join(originalDirectory, 'catalogue.json'));
  if (catalogue?.providerIdentity !== endpoint) throw new Error('Missing matching DeepInfra catalogue.');
  const prices = new Map(catalogue.data.map(m => [m.id, m.metadata.pricing]));
  for (const entry of entries) {
    const p = prices.get(entry.model);
    if (!p || ![p.input_tokens, p.output_tokens].every(n => Number.isFinite(n) && n > 0)) throw new Error('Missing valid catalogue pricing.');
  }
  const files = execFileSync('git', ['ls-files', '-z', 'src/server/ai', 'src/lib/env.ts', 'src/server/ai-evaluations.ts']).toString().split('\0').filter(Boolean).sort();
  files.push('scripts/ai-measure-deepinfra.ts', 'scripts/lib/ai-eval-budget.ts', 'scripts/lib/ai-measurement-workflow.ts', 'scripts/lib/deepinfra-accounting.ts', 'scripts/lib/ai-failure-diagnostics.ts', 'scripts/lib/inference-budget.ts');
  const source = createHash('sha256');
  for (const file of files) source.update(file).update(await readFile(file));
  // Switching plans must not overwrite or resume another plan's campaign,
  // even when both plans share a model and checkpoint filenames.
  source.update(JSON.stringify({ plan, entries }));
  const sourceFingerprint = source.digest('hex');
  const context = (r: Entry) => ({ providerIdentity: endpoint, identity: createHash('sha256').update(sourceFingerprint).update(JSON.stringify({ endpoint, ...r, version: MODEL_SUITES[r.suite].version, maxTokens: maxTokensFor(r.tier, r.suite), profile: profiles.forModel(r.model) })).digest('hex'), profile: requestProfileIdentity(profiles.forModel(r.model)) });
  const cpPath = (r: Entry) => path.join(directory, `checkpoint-tier${r.tier}-${r.suite}-${r.model.replace(/[^a-zA-Z0-9-]/g, '-')}.json`);
  const ledgerPath = path.join(directory, 'usage.json');
  let ledger: { providerIdentity: string; budgetUsd: number; events: Usage[] };
  let otherAccountedUsd = 0;
  const spent = () => ledger.events.reduce((sum, event) => sum + event.accountedUsd, 0);
  const upperUsd = (r: Entry, reserve: number) => reserve * Math.max(prices.get(r.model)!.input_tokens, prices.get(r.model)!.output_tokens) / 1_000_000;
  const upper = entries.reduce((sum, r) => sum + MODEL_SUITES[r.suite].build().reduce((n, c) => n + upperUsd(r, requestReserve(c, maxTokensFor(r.tier, r.suite))), 0), 0);
  console.log(`DeepInfra: ${entries.length} suites / ${entries.reduce((n, r) => n + MODEL_SUITES[r.suite].build().length, 0)} cases; conservative fresh-run estimate $${upper.toFixed(3)}; cap $${budgetUsd}.`);
  const checkpoints = new Map<string, Checkpoint>();
  const rows: Progress[] = [];
  const updateReports = async (stop: string) => {
    for (const tier of [1, 2, 3, 4] as const) {
      const tierEntries = entries.filter(r => r.tier === tier);
      if (!tierEntries.length) continue;
      if (tierEntries.some(r => !checkpoints.has(cpPath(r)) || checkpoints.get(cpPath(r))!.cases.length !== MODEL_SUITES[r.suite].build().length)) continue;
      const models = measurementModels[tier]!.map(model => {
        const suites: SuiteResult[] = tierEntries.filter(r => r.model === model).map(r => {
          const cp = checkpoints.get(cpPath(r))!;
          const report = reportFromCases(model, cp.cases);
          const errors: Record<string, number> = {}, finishReasons: Record<string, number> = {};
          for (const c of cp.cases) {
            if (c.errorClass) errors[c.errorClass] = (errors[c.errorClass] ?? 0) + 1;
            if (c.finishReason) finishReasons[c.finishReason] = (finishReasons[c.finishReason] ?? 0) + 1;
          }
          return { suite: r.suite, version: cp.version, maxTokens: cp.maxTokens, report, counts: countsOf(report), total: cp.cases.length, passed: cp.cases.filter(c => c.passed === true).length, failedCases: cp.cases.filter(c => c.passed !== true).map(c => c.caseId), errors, finishReasons };
        });
        return { ...summarise(model, suites), requestProfile: requestProfileIdentity(profiles.forModel(model)) };
      });
      const proposal = proposeOrder(models, tier);
      const run: EvalRun = { tier, providerIdentity: endpoint, startedAt: checkpoints.get(cpPath(tierEntries[0]!))!.startedAt, limit: null, requestIntervalMs: 0, requestTimeoutMs: e.AI_REQUEST_TIMEOUT_MS, suiteVersions: Object.fromEntries(TIER_SUITES[tier].map(s => [s, MODEL_SUITES[s].version])), models, proposedOrder: proposal.order, excluded: proposal.excluded, caveats: proposal.caveats };
      await save(path.join(directory, `tier${tier}.json`), { ...run, provider: 'DeepInfra', sourceFingerprint, ownerApprovalRequired: true, recorded: false, models: models.map(m => ({ ...m, suites: m.suites.map(({ report, ...s }) => ({ ...s, p50LatencyMs: report.p50LatencyMs, p95LatencyMs: report.p95LatencyMs,
        ...(['analysis', 'document'].includes(s.suite) ? { diagnostics: summariseDiagnostics(checkpoints.get(cpPath({ tier, model: m.modelId, suite: s.suite }))?.diagnostics ?? {}) } : {}) })) })) });
      await writeFile(path.join(directory, `tier${tier}.md`), renderEvalReport(run));
      for (const row of rows.filter(r => r.tier === tier)) row.status = 'complete';
    }
    await save(path.join(directory, 'progress.json'), { provider: 'DeepInfra', providerIdentity: endpoint, sourceFingerprint, plan, campaign: campaign ?? 'original', asOf: new Date().toISOString(), stop, ownerApprovalRequired: true, recorded: false, coverageComplete: rows.length === entries.length && rows.every(r => r.remainingCaseIds.length === 0), accountedUsd: spent(), otherAccountedUsd, accountCapUsd: 4.50, budgetUsd, candidates: candidateReadiness(rows), rows });
  };
  await mkdir(directory, { recursive: true });
  const lockPath = path.resolve('eval/reports/.deepinfra-account.lock');
  const lock = await open(lockPath, 'wx');
  try {
    await lock.writeFile(`${process.pid}\n`);
    const previous = await read<{ sourceFingerprint?: string }>(path.join(directory, 'progress.json'));
    // A changed candidate plan can have no checkpoint filenames in common.
    // Protect the campaign itself before emitting any report into that folder.
    if (previous && previous.sourceFingerprint !== sourceFingerprint) throw new Error('Campaign source differs; choose a fresh --campaign name.');
    ledger = await read<typeof ledger>(ledgerPath) ?? { providerIdentity: endpoint, budgetUsd, events: [] };
    if (ledger.providerIdentity !== endpoint || ledger.budgetUsd !== budgetUsd || ledger.events.some(event => !Number.isFinite(event.accountedUsd) || event.accountedUsd < 0)) throw new Error('Usage provenance/budget mismatch.');
    otherAccountedUsd = await otherDeepinfraSpend(path.resolve('eval/reports'), ledgerPath);
    for (const r of entries) {
      const cp = await read<Checkpoint>(cpPath(r));
      rows.push(assessEntry(r, context(r), cp));
      if (cp) checkpoints.set(cpPath(r), cp);
    }
    await updateReports(live ? 'running' : 'offline status');
    if (!live) return;
    let halted = false;
    const measure = async (r: Entry, index: number) => {
      const maxTokens = maxTokensFor(r.tier, r.suite);
      const cp = checkpoints.get(cpPath(r)) ?? { identity: context(r).identity, providerIdentity: endpoint, model: r.model, tier: r.tier, suite: r.suite, version: MODEL_SUITES[r.suite].version, maxTokens, startedAt: new Date().toISOString(), cases: [] };
      checkpoints.set(cpPath(r), cp);
      const finished = new Set(cp.cases.map(c => c.caseId));
      for (const c of MODEL_SUITES[r.suite].build()) {
        if (halted) return;
        if (finished.has(c.id)) continue;
        const reservedUsd = upperUsd(r, requestReserve(c, maxTokens));
        const event: Usage = { at: new Date().toISOString(), model: r.model, tier: r.tier, suite: r.suite, caseId: c.id, reservedUsd, accountedUsd: reservedUsd };
        // ADR-56: refresh the project total, check the cap and persist the
        // reservation under the project-wide lock, before any HTTP request.
        // The campaign and DeepInfra account checks run inside the same critical
        // section, so concurrent workers cannot all pass them before any push.
        await reserveInActiveLedger(process.cwd(), ledgerPath, spent, reservedUsd, async () => {
          if (spent() + reservedUsd > budgetUsd || otherAccountedUsd + spent() + reservedUsd > 4.50) throw new Error('Spend cap reached before request; checkpoint retained.');
          ledger.events.push(event);
          await save(ledgerPath, ledger);
        });
        let fatalStatus: number | undefined;
        const provider = createNvidiaProvider({ apiKey: ai.apiKey, baseUrl: ai.baseUrl, requestProfiles: profiles, defaultTimeoutMs: e.AI_REQUEST_TIMEOUT_MS, fetch: async (url, init) => {
          if (url !== `${endpoint}/chat/completions`) throw new Error('Unexpected measurement endpoint.');
          const response = await globalThis.fetch(url, init);
          event.status = response.status;
          const body = await response.clone().json().catch(() => ({}));
          const input = body.usage?.prompt_tokens, output = body.usage?.completion_tokens;
          if ([input, output].every(n => Number.isSafeInteger(n) && n >= 0)) {
            event.promptTokens = input; event.completionTokens = output;
            const p = prices.get(r.model)!;
            event.accountedUsd = (input * p.input_tokens + output * p.output_tokens) / 1_000_000;
          }
          if (!response.ok) fatalStatus = response.status;
          await save(ledgerPath, ledger);
          return response;
        } });
        let diagnostic: FailureDiagnostics | undefined;
        const observed = { ...provider, chat: async (...args: Parameters<typeof provider.chat>) => {
          const response = await provider.chat(...args);
          if (response.ok && (r.suite === 'analysis' || r.suite === 'document')) {
            const { content, toolCalls } = response.value;
            diagnostic = r.suite === 'analysis' ? diagnoseAnalysis(c.id, content, toolCalls) : diagnoseDocument(c.id, content);
          }
          return response;
        } };
        const report = await evaluateModel(observed, r.model, [c], e.AI_REQUEST_TIMEOUT_MS, maxTokens);
        const result = report.cases[0]!;
        if (diagnostic) {
          FailureDiagnosticsSchema.parse(diagnostic);
          if (diagnostic.passed !== result.passed) throw new Error('Diagnostic/scorer verdict mismatch.');
          (cp.diagnostics ??= {})[c.id] = diagnostic;
        }
        cp.cases.push(result);
        await save(cpPath(r), cp);
        rows[index] = assessEntry(r, context(r), cp);
        console.log(`Tier ${r.tier} ${r.model} ${r.suite} ${cp.cases.length}/${MODEL_SUITES[r.suite].build().length}: ${report.cases[0]!.errorClass ?? (report.cases[0]!.passed ? 'pass' : 'fail')}; accounted $${spent().toFixed(4)}`);
        if (fatalStatus) throw new Error(`Provider HTTP ${fatalStatus}; no retry.`);
      }
      await updateReports('running');
    };
    const pending = [...entries.entries()];
    // Six independent requests; every individual suite remains serial. No
    // pacing delay enters provider latency, and reservations precede egress.
    const outcomes = await Promise.allSettled(Array.from({ length: 6 }, async () => {
      try {
        for (let item = pending.shift(); item && !halted; item = pending.shift()) await measure(item[1], item[0]);
      } catch (error) { halted = true; throw error; }
    }));
    const failure = outcomes.find(r => r.status === 'rejected');
    if (failure?.status === 'rejected') {
      await updateReports('stopped; in-flight results retained; no retry');
      throw failure.reason;
    }
    await updateReports('complete; owner approval required; nothing recorded');
  } finally { await lock.close(); await unlink(lockPath); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
