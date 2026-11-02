/** One finite queue across the approved Groq workloads; offline status by default. */
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { env, loadDotEnv, aiProviderSettings } from '../src/lib/env';
import { evaluationProviderIdentity } from '../src/server/ai-evaluations';
import { resolveRequestProfiles, requestProfileIdentity } from '../src/server/ai/config/request-profiles';
import { maxTokensFor, renderEvalReport, MODEL_SUITES, type ModelSuite } from '../src/server/ai/eval/runner';
import { assessEntry, checkpointReport, candidateReadiness, executePlan, validatePlan, nextEntry, type Entry, type Progress } from './lib/ai-measurement-workflow';

const root = path.resolve('eval/reports');
const planPath = path.join(root, 'groq-measurement-plan.json');
const planSchema = z.object({ providerIdentity: z.url(), rows: z.array(z.object({ tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]), model: z.string().min(1), suite: z.string(), legacyEvidence: z.string().optional(), evidence: z.string().nullable().optional(), status: z.string().optional() })) });
async function json(file: string): Promise<unknown | undefined> {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
function evidencePath(relative: string): string {
  const file = path.resolve(path.dirname(planPath), relative);
  if (!file.startsWith(`${root}${path.sep}`)) throw new Error('Evidence path escapes report directory.');
  return file;
}
async function main(): Promise<void> {
  if (process.argv.slice(2).some(a => !['--run', '--status', '--finalize'].includes(a))) throw new Error('Use --status (offline default), --finalize (offline report recovery) or --run. Recording and routing changes are not supported.');
  if (process.argv.slice(2).length > 1) throw new Error('Choose exactly one workflow mode.');
  const plan = planSchema.parse(await json(planPath));
  const entries: Entry[] = plan.rows.map(r => ({ tier: r.tier, model: r.model, suite: r.suite as ModelSuite, ...(r.legacyEvidence || (r.status === 'complete' && r.evidence && !r.evidence.includes('checkpoint-')) ? { legacyEvidence: r.legacyEvidence ?? r.evidence! } : {}) }));
  validatePlan(entries);
  // Status needs no account credential or database environment.
  loadDotEnv();
  const configured = process.argv.includes('--run') ? env() : undefined;
  if (configured) {
    const active = aiProviderSettings(configured);
    if (!active.apiKey || evaluationProviderIdentity(active.baseUrl) !== plan.providerIdentity) throw new Error('Configured provider/key does not match the measurement plan.');
  }
  const profiles = resolveRequestProfiles(configured?.AI_REQUEST_PROFILES);
  const files = execFileSync('git', ['ls-files', '-z', 'src/server/ai', 'src/lib/env.ts', 'src/server/ai-evaluations.ts']).toString().split('\0').filter(Boolean).sort();
  files.push('scripts/ai-eval-budgeted.ts', 'scripts/lib/ai-eval-budget.ts');
  const source = createHash('sha256');
  for (const file of files) source.update(file).update(await readFile(file));
  const identity = (e: Entry) => source.copy().update(JSON.stringify({ endpoint: plan.providerIdentity, model: e.model, tier: e.tier, suite: e.suite, version: MODEL_SUITES[e.suite].version, maxTokens: maxTokensFor(e.tier, e.suite), profile: profiles.forModel(e.model) })).digest('hex');
  const load = async (): Promise<Progress[]> => Promise.all(entries.map(async e => {
    const stem = `checkpoint-tier${e.tier}-${e.suite}-${e.model.replace(/[^a-zA-Z0-9-]/g, '-')}`;
    const cp = await json(path.join(root, `${stem}.json`));
    // Only read the report named by the checkpoint's validated start timestamp.
    let report: unknown;
    if (cp !== undefined) {
      assessEntry(e, { providerIdentity: plan.providerIdentity, identity: identity(e), profile: requestProfileIdentity(profiles.forModel(e.model)) }, cp);
      const startedAt = (cp as { startedAt: string }).startedAt;
      report = await json(path.join(root, `${startedAt.slice(0, 19).replace(/:/g, '-')}-tier${e.tier}-${e.suite}.json`));
    } else if (e.legacyEvidence) report = await json(evidencePath(e.legacyEvidence));
    return assessEntry(e, { providerIdentity: plan.providerIdentity, identity: identity(e), profile: requestProfileIdentity(profiles.forModel(e.model)) }, cp, report);
  }));
  const finalize = async (entry: Entry): Promise<void> => {
    const stem = `checkpoint-tier${entry.tier}-${entry.suite}-${entry.model.replace(/[^a-zA-Z0-9-]/g, '-')}`;
    const cp = await json(path.join(root, `${stem}.json`));
    const context = { providerIdentity: plan.providerIdentity, identity: identity(entry), profile: requestProfileIdentity(profiles.forModel(entry.model)) };
    const run = checkpointReport(entry, context, cp, configured?.AI_REQUEST_TIMEOUT_MS ?? 60_000);
    const reportStem = `${run.startedAt.slice(0, 19).replace(/:/g, '-')}-tier${entry.tier}-${entry.suite}`;
    const body = { ...run, models: run.models.map(m => ({ ...m, suites: m.suites.map(({ report, ...rest }) => ({ ...rest, p50LatencyMs: report.p50LatencyMs, p95LatencyMs: report.p95LatencyMs })) })) };
    const file = path.join(root, `${reportStem}.json`);
    await writeFile(`${file}.tmp`, `${JSON.stringify(body, null, 2)}\n`); await rename(`${file}.tmp`, file);
    await writeFile(path.join(root, `${reportStem}.md`), renderEvalReport(run));
    console.log(`Recovered completed report ${reportStem}; no provider request.`);
  };
  const saveProgress = async (rows: Progress[], stop: string): Promise<void> => {
    const snapshot = { asOf: new Date().toISOString(), providerIdentity: plan.providerIdentity, stop, plannedSuites: rows.length, plannedCases: rows.reduce((n, r) => n + r.total, 0), retainedCaseResults: rows.reduce((n, r) => n + r.retained, 0), answeredCaseResults: rows.reduce((n, r) => n + r.answered, 0), unansweredCaseResults: rows.reduce((n, r) => n + r.unanswered, 0), unattemptedCases: rows.reduce((n, r) => n + r.total - r.retained, 0), ownerApprovalRequired: true, workflowRecordsResults: false, workflowChangesRouting: false, coverageComplete: rows.every(r => r.status === 'complete'), next: nextEntry(rows) ?? null, candidates: candidateReadiness(rows), rows: rows.map(({ remainingCaseIds, ...r }) => ({ ...r, ...(r.status === 'partial' ? { remainingCaseIds } : {}) })) };
    const file = path.join(root, 'groq-workflow-progress.json');
    await writeFile(`${file}.tmp`, `${JSON.stringify(snapshot, null, 2)}\n`); await rename(`${file}.tmp`, file);
    const md = ['# Groq measurement workflow', '', `Status: ${stop}. ${snapshot.retainedCaseResults}/${snapshot.plannedCases} results retained; ${snapshot.unattemptedCases} cases unattempted; ${snapshot.unansweredCaseResults} unanswered.`, '', '| Tier | Model | Suite | Results | Passed / answered | Unanswered | Coverage |', '|---|---|---|---|---|---|---|', ...rows.map(r => `| ${r.tier} | ${r.model} | ${r.suite} | ${r.retained}/${r.total} | ${r.passed}/${r.answered} | ${r.unanswered} | ${r.status} |`), '', '## Candidate readiness', '', ...snapshot.candidates.map(c => `- Tier ${c.tier} ${c.modelId}: ${c.gateFailure ?? 'Numeric gates passed; owner approval required'} Declaration notes: ${c.declarationBlockers.join('; ') || 'none'}`), '', 'Coverage is independent of quality: retain failures, apply the existing gates, and bring the completed per-tier proposal to the owner. This workflow never records live results, changes tier orders, retries a case, or merges the PR.', ''];
    await writeFile(path.join(root, 'groq-workflow-progress.md'), md.join('\n'));
    console.log(`${snapshot.retainedCaseResults}/${snapshot.plannedCases} retained; ${stop}.`);
  };
  const lockPath = path.join(root, '.groq-workflow.lock');
  await mkdir(root, { recursive: true });
  const lock = await open(lockPath, 'wx');
  try {
    await lock.writeFile(`${process.pid}\n`);
    if (!process.argv.includes('--run')) {
      if (process.argv.includes('--finalize')) for (const entry of (await load()).filter(r => r.status === 'report_pending')) await finalize(entry);
      await saveProgress(await load(), process.argv.includes('--finalize') ? 'offline reports finalized' : 'offline status'); return;
    }
    const outcome = await executePlan(load, async entry => {
      if (entry.status === 'report_pending') { await finalize(entry); return { code: 0 }; }
      console.log(`Measuring Tier ${entry.tier} ${entry.model} / ${entry.suite}; preserving ${entry.retained} results.`);
      const day = new Date().toISOString().slice(0, 10);
      const ledgerPath = path.join(root, `groq-budget-${day}.json`);
      const before = await json(ledgerPath) as { events: unknown[] } | undefined;
      const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/ai-eval-budgeted-run.ts', '--tier', String(entry.tier), '--model', entry.model, '--suite', entry.suite, '--interval-ms', '3000', '--no-record'], { stdio: 'inherit' });
      const forward = (signal: NodeJS.Signals) => child.kill(signal);
      const interrupt = () => forward('SIGINT'); const terminate = () => forward('SIGTERM');
      process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
      let code: number;
      try { code = await new Promise<number>((resolve, reject) => { child.once('error', reject); child.once('exit', c => resolve(c ?? 1)); }); }
      finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate); }
      const after = await json(ledgerPath) as { events: { status: number }[] } | undefined;
      let stopReason: string | undefined;
      if ((after?.events.length ?? 0) > (before?.events.length ?? 0)) {
        const status = after!.events.at(-1)!.status;
        if ([401, 403, 429].includes(status) || status >= 500) stopReason = `Provider HTTP ${status}; stopped without retry.`;
      }
      // Persist fresh progress after every invocation, not just at the end.
      await saveProgress(await load(), stopReason ?? (code ? `evaluator exited ${code}` : 'suite invocation finished'));
      return { code, stopReason };
    });
    await saveProgress(outcome.rows, outcome.detail ?? outcome.reason);
    if (outcome.reason === 'blocked') process.exitCode = 1;
  } finally { await lock.close(); await unlink(lockPath); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
