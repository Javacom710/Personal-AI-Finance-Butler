import 'server-only';

/**
 * Job handler registration.
 *
 * Importing this module registers every handler, so a caller that runs the queue
 * cannot accidentally run it with an empty registry. Phase 3 ships one handler;
 * prices, FX and net-worth snapshots arrive in Phases 5 and 6.
 */

import { addDays } from '../../lib/date';
import { log } from '../log';
import { db } from '../db/client';
import type { DbTransaction } from '../db/client';
import { users } from '../db/schema';
import { defaultRegistry } from '../market-data';
import type { CorporateActionObservation } from '../market-data';
import { createReadCtx, withWriteCtx } from '../services/_ctx';
import {
  heldInstrumentRefs,
  pinnedProviderFor,
  recordCorporateActionDetections,
  refreshFxRates,
  refreshPrices,
} from '../services/market-data';
import { postDueOccurrences, DEFAULT_HORIZON_DAYS } from '../services/recurring';
import { enqueue, registerJobHandler, type JobDeps, type JobRecord } from './runner';

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
registerJobHandler(RECURRING_POST, async (job: JobRecord, _tx: DbTransaction, { now }: JobDeps) => {
  const horizonDays =
    typeof job.payload['horizonDays'] === 'number' ? job.payload['horizonDays'] : DEFAULT_HORIZON_DAYS;

  const userIds =
    typeof job.payload['userId'] === 'string'
      ? [job.payload['userId']]
      : (await db().select({ id: users.id }).from(users)).map((r) => r.id);

  for (const userId of userIds) {
    // The run's clock, not this line's. Which occurrences are due is a function
    // of `ctx.today`, so a handler reading `new Date()` here would make the
    // outcome depend on the wall clock at the moment the job happened to run —
    // untestable, and different for two jobs claimed by the same run.
    const ctx = await createReadCtx(userId, { now });
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

// ------------------------------------------------------------- market data
//
// Three handlers, all idempotent, none of which may touch the ledger.
//
// `prices.refresh` and `fx.refresh` run **daily after the close**, not hourly:
// every figure this application shows is a daily figure, the Indian equity tier
// is end-of-day regardless, and a personal portfolio refreshed once a day is
// ~900 requests a month — three orders of magnitude inside every provider quota
// we evaluated. Nothing here needs a rate limiter.
//
// A failure never blanks a page. The previous quote stays, ages into `stale`,
// and says so ([ADR-28](../../../docs/DECISIONS.md#adr-28--staleness-is-measured-in-trading-sessions-not-wall-clock-hours)).

export const PRICES_REFRESH = 'prices.refresh';
export const FX_REFRESH = 'fx.refresh';
export const CORPORATE_ACTIONS_REFRESH = 'corporate_actions.refresh';

/**
 * Run a market-data handler for one user or all of them.
 *
 * Each user gets its own write transaction, so one user's provider failure
 * cannot roll back another's stored rates.
 */
async function forEachUser(
  job: JobRecord,
  run: (userId: string) => Promise<void>,
): Promise<void> {
  const userIds =
    typeof job.payload['userId'] === 'string'
      ? [job.payload['userId']]
      : (await db().select({ id: users.id }).from(users)).map((r) => r.id);

  for (const userId of userIds) {
    await run(userId);
  }
}

registerJobHandler(FX_REFRESH, async (job: JobRecord) => {
  await forEachUser(job, async (userId) => {
    const ctx = await createReadCtx(userId);
    if (!ctx.ok) {
      log.warn('fx.refresh skipped a user with no settings row', { userId });
      return;
    }
    const registry = defaultRegistry();
    const outcome = await withWriteCtx(ctx.value, (write) => refreshFxRates(write, registry));
    log.info('fx.refresh complete', {
      userId,
      requested: outcome.requested,
      stored: outcome.stored,
      failedCount: outcome.failed.length,
    });
  });
});

registerJobHandler(PRICES_REFRESH, async (job: JobRecord) => {
  await forEachUser(job, async (userId) => {
    const ctx = await createReadCtx(userId);
    if (!ctx.ok) {
      log.warn('prices.refresh skipped a user with no settings row', { userId });
      return;
    }
    const registry = defaultRegistry();
    const outcome = await withWriteCtx(ctx.value, (write) => refreshPrices(write, registry));
    log.info('prices.refresh complete', {
      userId,
      requested: outcome.requested,
      stored: outcome.stored,
      quotesAdvanced: outcome.quotesAdvanced,
      failedCount: outcome.failed.length,
      // A rejection is a data problem, not a network one, and is worth seeing.
      rejected: outcome.rejected.map((r) => r.reason),
    });
  });
});

registerJobHandler(CORPORATE_ACTIONS_REFRESH, async (job: JobRecord) => {
  await forEachUser(job, async (userId) => {
    const ctx = await createReadCtx(userId);
    if (!ctx.ok) {
      log.warn('corporate_actions.refresh skipped a user with no settings row', { userId });
      return;
    }
    const registry = defaultRegistry();
    const refs = await heldInstrumentRefs(ctx.value);
    const observations: CorporateActionObservation[] = [];

    for (const ref of refs) {
      const pinned = await pinnedProviderFor(ctx.value, ref.instrumentId);
      // A window wide enough to catch anything the user has not yet recorded,
      // and narrow enough that a re-run is cheap. Re-detection is idempotent.
      const from = addDays(ctx.value.today, -400);
      const found = await registry.corporateActions(ref, pinned, from, ctx.value.today);
      // No adapter in this phase supplies corporate actions, so this is
      // ordinarily an `unsupported` refusal — recorded, not retried.
      if (found.ok) observations.push(...found.value);
    }

    if (observations.length === 0) {
      log.info('corporate_actions.refresh found nothing', { userId, instruments: refs.length });
      return;
    }

    const detected = await withWriteCtx(ctx.value, (write) =>
      recordCorporateActionDetections(write, observations),
    );
    log.info('corporate_actions.refresh complete', { userId, detected });
  });
});

export async function scheduleMarketDataRefresh(at: Date): Promise<readonly string[]> {
  return Promise.all([
    enqueue(FX_REFRESH, {}, { runAfter: at }),
    enqueue(PRICES_REFRESH, {}, { runAfter: at }),
  ]);
}
