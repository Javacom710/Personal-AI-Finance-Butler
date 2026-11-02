/** Mandatory rolling-window preflight around the existing checkpointed CLI. */
import { spawn } from 'node:child_process';
import { open, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prepareLedger, type QuotaLedger } from './lib/ai-eval-quota-window';

async function main(): Promise<void> {
  const dir = path.resolve('eval/reports');
  const lockPath = path.join(dir, '.groq-measurement.lock');
  const lock = await open(lockPath, 'wx');
  let ledger: QuotaLedger;
  try {
    await lock.writeFile(`${process.pid}\n`);
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const files = (await readdir(dir)).filter(f => /^groq-budget-\d{4}-\d{2}-\d{2}\.json$/.test(f));
    const ledgers = await Promise.all(files.map(async f => {
      const entry = JSON.parse(await readFile(path.join(dir, f), 'utf8')) as QuotaLedger;
      if (f !== `groq-budget-${entry.day}.json`) throw new Error('Quota ledger filename/date mismatch.');
      return entry;
    }));
    if (ledgers.some(l => l.day > day)) throw new Error('Future quota ledger found; check the execution clock.');
    let current = ledgers.find(l => l.day === day);
    if (!current) {
      let baseline = { chatRequestsIncludingReachability: 0, conservativeTokenReserve: 0 };
      try { baseline = JSON.parse(await readFile(path.join(dir, `groq-${day}`, 'daily-usage-summary.json'), 'utf8')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      current = { day, requests: baseline.chatRequestsIncludingReachability, reservedTokens: baseline.conservativeTokenReserve, events: [], nativeBaseline: { at: now.toISOString(), requests: baseline.chatRequestsIncludingReachability, tokens: baseline.conservativeTokenReserve } };
    }
    ledger = prepareLedger(current, ledgers.filter(l => l.day < day), now);
    const ledgerPath = path.join(dir, `groq-budget-${day}.json`);
    await writeFile(`${ledgerPath}.tmp`, `${JSON.stringify(ledger, null, 2)}\n`);
    await rename(`${ledgerPath}.tmp`, ledgerPath);
    console.log(`Quota preflight: ${ledger.requests} requests / ${ledger.reservedTokens} reserved tokens; preceding-day carry ${ledger.carry!.tokens}.`);
  } finally { await lock.close(); await unlink(lockPath); }
  if (process.argv.includes('--check-only')) return;
  if (ledger.requests >= 950 || ledger.reservedTokens >= 190_000) {
    console.log('Quota window exhausted; evaluator not launched.');
    return;
  }
  // A fresh day's ledger has no last-call timestamp for the inner CLI.
  // Imported usage may include a call just before midnight; refill its minute
  // bucket before the first request. Check-only never waits or launches calls.
  if (ledger.carry!.requests > 0 && ledger.events.length === 0) {
    console.log('Waiting 60 seconds for the preceding minute bucket before starting.');
    await new Promise(resolve => setTimeout(resolve, 60_000));
  }
  if (new Date().toISOString().slice(0, 10) !== ledger.day) {
    console.log('Date changed during preflight; evaluator not launched. Run preflight again.');
    return;
  }
  const child = spawn(process.execPath, ['--conditions=react-server', '--import', 'tsx', 'scripts/ai-eval-budgeted.ts', ...process.argv.slice(2)], { stdio: 'inherit' });
  const interrupt = () => child.kill('SIGINT');
  const terminate = () => child.kill('SIGTERM');
  process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
  try {
    process.exitCode = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => resolve(code ?? 1));
    });
  } finally {
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate);
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
