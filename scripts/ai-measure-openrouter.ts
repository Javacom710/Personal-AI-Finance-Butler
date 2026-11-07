/** One finite OpenRouter campaign. Offline status by default; never records or changes routing. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { env, loadDotEnv } from '../src/lib/env';
import { resolveRequestProfiles } from '../src/server/ai/config/request-profiles';
import { openRouterPolicy } from '../src/server/ai/provider/openrouter-policy';
import { createNvidiaProvider } from '../src/server/ai/provider/nvidia-build';
import { err } from '../src/lib/result';
import { timeout } from '../src/server/ai/errors';
import { buildCampaignPlan, campaignProgress, emptyCampaign, measureCampaign, recoverCampaignCase, validateCampaignCheckpoint, type CampaignCheckpoint } from './lib/ai-openrouter-campaign';
import { campaignFiles } from './lib/ai-openrouter-files';
import { openRouterWorkloads } from './lib/ai-openrouter-plan';

type CampaignMode = 'status' | 'run' | 'finalize' | 'recover';
function argsOf(args: readonly string[]): { mode: CampaignMode; vision?: string; recover?: string } {
  let mode: CampaignMode = 'status'; let chosen = false; let vision: string | undefined; let recover: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--status', '--run', '--finalize'].includes(arg!)) { if (chosen) throw new Error('Choose one campaign mode.'); mode = arg === '--run' ? 'run' : arg === '--finalize' ? 'finalize' : 'status'; chosen = true; }
    else if (arg === '--recover-case') {
      if (chosen || !args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error('Choose one explicit recovery key and one workflow mode.');
      recover = args[++i]; mode = 'recover'; chosen = true;
    }
    else if (arg === '--vision-model') {
      if (vision || !args[i + 1] || !/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i.test(args[i + 1]!)) throw new Error('Supply one verified Qwen vision catalogue ID.');
      vision = args[++i];
      if (!vision!.toLowerCase().startsWith('qwen/')) throw new Error('The owner authorized a Qwen vision candidate.');
    } else throw new Error('Use --status (default), --finalize, --run or one --recover-case KEY with --vision-model. Recording, automatic retries and routing flags are not supported.');
  }
  return { mode, vision, recover };
}
const sourcePaths = ['src/server/ai', 'src/lib', 'scripts/ai-measure-openrouter.ts', 'scripts/lib/ai-openrouter-campaign.ts', 'scripts/lib/ai-openrouter-files.ts', 'scripts/lib/ai-openrouter-plan.ts', 'package.json', 'package-lock.json', 'tsconfig.json'];
function cleanMeasurementInputs() {
  const changes = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', ...sourcePaths]).toString().split('\n').filter(Boolean).filter(line => !line.slice(3).startsWith('src/server/ai/assistant/') && line.slice(3) !== 'src/server/ai/proposals/transaction-entry.ts');
  if (changes.length) throw new Error('Commit measurement-input changes before live inference. No request was sent.');
}
async function sourceFingerprint(): Promise<string> {
  const tracked = execFileSync('git', ['ls-files', '-z', ...sourcePaths]).toString().split('\0');
  const names = [...new Set([...tracked, ...sourcePaths.filter(p => !['src/server/ai', 'src/lib'].includes(p))])].filter(Boolean).filter(p => !p.startsWith('src/server/ai/assistant/') && p !== 'src/server/ai/proposals/transaction-entry.ts').sort();
  const hash = createHash('sha256');
  for (const file of names) hash.update(file).update('\0').update(await readFile(file)).update('\0');
  return hash.digest('hex');
}
async function main() {
  const args = argsOf(process.argv.slice(2));
  if (!args.vision) {
    if (args.mode !== 'status') throw new Error('Select the verified Qwen vision catalogue ID before running/finalizing.');
    console.log('Offline status: no campaign selected. Use --vision-model QWEN_ID. No key, network, database or inference request is needed for status.'); return;
  }
  loadDotEnv();
  // Only live mode requires a configured account. Never substitute a legacy key.
  const live = args.mode === 'run' || args.mode === 'recover' ? env() : undefined;
  if (live && (!live.AI_API_KEY || !live.AI_BASE_URL || !openRouterPolicy(live.AI_BASE_URL))) throw new Error('OpenRouter key/endpoint readiness is missing. Configure AI_API_KEY and the canonical AI_BASE_URL after funding and ZDR-only account settings are confirmed.');
  if (live) cleanMeasurementInputs();
  const revision = execFileSync('git', ['rev-parse', 'HEAD']).toString().trim();
  const profiles = resolveRequestProfiles(process.env.AI_REQUEST_PROFILES ?? '');
  const timeoutMs = Number(process.env.AI_REQUEST_TIMEOUT_MS ?? 60000);
  const workloads = openRouterWorkloads(args.vision, profiles);
  const plan = buildCampaignPlan(workloads, await sourceFingerprint(), 3000, timeoutMs);
  const dir = path.resolve('eval/reports/openrouter', plan.identity);
  const files = campaignFiles(dir);
  const initial = await files.load();
  if (args.mode === 'status') {
    const cp = initial === undefined ? emptyCampaign(plan, new Date(), revision) : validateCampaignCheckpoint(plan, initial);
    console.log(JSON.stringify({ ...campaignProgress(plan, cp), checkpoint: files.checkpointPath }, null, 2)); return;
  }
  if ((args.mode === 'finalize' || args.mode === 'recover') && initial === undefined) throw new Error('No checkpoint exists to finalize/recover. No request was sent.');
  await files.locked(async store => {
    const loaded = await files.load();
    let cp: CampaignCheckpoint = loaded === undefined ? emptyCampaign(plan, new Date(), revision) : validateCampaignCheckpoint(plan, loaded);
    if (args.mode === 'finalize') { await files.reports(plan, cp, 'offline report recovery'); console.log('Recovered reports from retained scores; no HTTP or rescoring.'); return; }
    const controller = new AbortController(); const interrupt = () => controller.abort();
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    try {
      const adapter = createNvidiaProvider({ apiKey: live!.AI_API_KEY, baseUrl: live!.AI_BASE_URL!, requestProfiles: profiles, fetch: globalThis.fetch as never, defaultTimeoutMs: timeoutMs });
      const provider = { ...adapter, chat: (request: Parameters<typeof adapter.chat>[0]) => controller.signal.aborted ? Promise.resolve(err(timeout(timeoutMs))) : adapter.chat({ ...request, signal: controller.signal }) };
      const execute = (options: Parameters<typeof measureCampaign>[4]) => args.mode === 'recover' ? recoverCampaignCase(plan, cp, args.recover!, provider, store, options) : measureCampaign(plan, cp, provider, store, options);
      const outcome = await execute({
        interrupted: () => controller.signal.aborted,
        sleep: ms => new Promise(resolve => { const finish = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', finish); resolve(); }; const timer = setTimeout(finish, ms); controller.signal.addEventListener('abort', finish, { once: true }); if (controller.signal.aborted) finish(); }),
        progress: async current => { cp = current; const p = campaignProgress(plan, cp); console.log(`${p.retainedResults}/${p.expectedCases} scored; ${p.unattemptedCases} unattempted; ${p.ambiguousAttempts.length} ambiguous. No recording.`); },
      });
      cp = outcome.checkpoint;
      await files.reports(plan, cp, outcome.stop);
      console.log(`Stopped: ${outcome.stop}. Reports: ${dir}. No tier order or capability records changed.`);
      if (!['all_cases_attempted', 'recovered_case'].includes(outcome.stop)) process.exitCode = controller.signal.aborted ? 130 : 2;
    } finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); }
  });
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
