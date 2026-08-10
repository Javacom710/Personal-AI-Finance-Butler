/**
 * Drain the job queue once (ADR-14).
 *
 *   npm run jobs:run
 *   npm run jobs:run -- --kind=recurring.post      # enqueue, then run
 *
 * Intended to be driven by cron. The runner is safe to invoke concurrently:
 * `FOR UPDATE SKIP LOCKED` means two processes never claim the same job, and the
 * recurring handler is idempotent regardless (ADR-15).
 */

import { loadDotEnv } from '../src/lib/env';
import { closeDb } from '../src/server/db/client';
import { enqueue, registeredKinds, runDueJobs } from '../src/server/jobs';

async function main(): Promise<void> {
  loadDotEnv();

  const kind = process.argv.find((a) => a.startsWith('--kind='))?.slice('--kind='.length);
  if (kind) {
    if (!registeredKinds().includes(kind)) {
      throw new Error(`Unknown job kind "${kind}". Registered: ${registeredKinds().join(', ')}`);
    }
    const id = await enqueue(kind);
    console.log(`Enqueued ${kind} (${id}).`);
  }

  const result = await runDueJobs({ max: 50 });
  console.log(`Claimed ${result.claimed}, succeeded ${result.succeeded}, failed ${result.failed}.`);

  await closeDb();
  if (result.failed > 0) process.exit(1);
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  await closeDb();
  process.exit(1);
});
