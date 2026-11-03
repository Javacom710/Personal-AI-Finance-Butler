/** Atomic campaign files; no HTTP, provider construction or automatic lock recovery. */
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { campaignProgress, campaignReports, type CampaignCheckpoint, type CampaignPlan, type CampaignStore } from './ai-openrouter-campaign';
import { renderEvalReport } from '../../src/server/ai/eval/runner';

async function atomic(file: string, value: string) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, value, { mode: 0o600, flag: 'wx' });
  try { await rename(temporary, file); }
  finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
}
export function campaignFiles(dir: string) {
  const checkpointPath = path.join(dir, 'checkpoint.json');
  return {
    checkpointPath,
    async load(): Promise<unknown | undefined> {
      try { return JSON.parse(await readFile(checkpointPath, 'utf8')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
    },
    async locked<T>(fn: (store: CampaignStore) => Promise<T>): Promise<T> {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      let lock;
      const lockPath = path.join(dir, '.measurement.lock');
      try { lock = await open(lockPath, 'wx', 0o600); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Measurement lock exists. Inspect its PID before manually removing a stale lock; no request was sent.'); throw error; }
      try {
        await lock.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
        return await fn({ save: cp => atomic(checkpointPath, `${JSON.stringify(cp, null, 2)}\n`) });
      } finally { await lock.close(); await unlink(lockPath); }
    },
    async reports(plan: CampaignPlan, cp: CampaignCheckpoint, stop: string) {
      const progress = { ...campaignProgress(plan, cp), stop, ownerApprovalRequired: true };
      await atomic(path.join(dir, 'progress.json'), `${JSON.stringify(progress, null, 2)}\n`);
      const runs = campaignReports(plan, cp);
      for (const run of runs) {
        await atomic(path.join(dir, `tier-${run.tier}.json`), `${JSON.stringify(run, null, 2)}\n`);
        await atomic(path.join(dir, `tier-${run.tier}.md`), renderEvalReport(run));
      }
      const lines = ['# OpenRouter measurement campaign', '', `${progress.retainedResults}/${progress.expectedCases} scored results; ${progress.unattemptedCases} unattempted; ${progress.ambiguousAttempts.length} ambiguous reservations retained; ${progress.recoveryAttempts} explicit recovery calls; ${progress.unansweredCases} unanswered cases; ${progress.providerErrorAttempts} provider-error attempts.`, `Stop: ${stop}.`, '', 'No capability records or tier orders were changed. Each case is reserved before HTTP and is never automatically replayed. Coverage and quality are separate; review the per-tier host-qualified reports.', '', ...progress.ambiguousAttempts.map(key => `- Ambiguous, never replayed: ${key}`), ''];
      await atomic(path.join(dir, 'overview.md'), lines.join('\n'));
    },
  };
}
