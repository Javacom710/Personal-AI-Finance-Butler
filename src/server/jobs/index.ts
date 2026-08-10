import 'server-only';

/**
 * Job handler registration.
 *
 * Importing this module registers every handler, so a caller that runs the queue
 * cannot accidentally run it with an empty registry. Phase 3 ships one handler;
 * prices, FX and net-worth snapshots arrive in Phases 5 and 6.
 */

import { log } from '../log';
import { db } from '../db/client';
import { users } from '../db/schema';
import { createReadCtx, withWriteCtx } from '../services/_ctx';
import { postDueOccurrences, DEFAULT_HORIZON_DAYS } from '../services/recurring';
import { enqueue, registerJobHandler, type JobRecord } from './runner';

export { enqueue, registeredKinds, runDueJobs, type JobRecord } from './runner';

export const RECURRING_POST = 'recurring.post';

/**
 * Materialise occurrences and post the ones their rule marks `auto_post`.
 *
 * Safe to run repeatedly: `UNIQUE (rule_id, due_on)` makes materialising
 * idempotent, and the compare-and-swap claim in `postOccurrence` makes posting
 * idempotent (ADR-15). Running it twice on one day produces exactly one
 * transaction per due date.
 */
registerJobHandler(RECURRING_POST, async (job: JobRecord) => {
  const horizonDays =
    typeof job.payload['horizonDays'] === 'number' ? job.payload['horizonDays'] : DEFAULT_HORIZON_DAYS;

  const userIds =
    typeof job.payload['userId'] === 'string'
      ? [job.payload['userId']]
      : (await db().select({ id: users.id }).from(users)).map((r) => r.id);

  for (const userId of userIds) {
    const ctx = await createReadCtx(userId);
    if (!ctx.ok) {
      log.warn('recurring.post skipped a user with no settings row', { userId });
      continue;
    }

    const result = await withWriteCtx(ctx.value, (write) => postDueOccurrences(write, { horizonDays }));

    if (!result.ok) {
      // Thrown, not returned: the runner treats a throw as a failed attempt and
      // schedules a retry with backoff.
      throw new Error(`recurring.post failed for ${userId}: ${result.error.message}`);
    }

    if (result.value.failed.length > 0) {
      // A closed account or a missing FX rate stops one occurrence, not the run.
      // Its claim was rolled back, so it stays pending and will be retried.
      log.warn('recurring.post could not post some occurrences', {
        userId,
        failedCount: result.value.failed.length,
        reasons: result.value.failed.map((f) => f.error.code),
      });
    }

    log.info('recurring.post complete', {
      userId,
      materialised: result.value.materialised,
      posted: result.value.posted,
    });
  }
});

/** Schedule the next run. Called by whatever owns scheduling — a cron entry today. */
export async function scheduleRecurringPost(at: Date): Promise<string> {
  return enqueue(RECURRING_POST, {}, { runAfter: at });
}
