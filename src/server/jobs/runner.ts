import 'server-only';

/**
 * The background job runner (ADR-14).
 *
 * A Postgres table plus `SELECT … FOR UPDATE SKIP LOCKED`. Job volume is a
 * handful a day, and `CLAUDE.md` excludes Redis and message queues without a
 * concrete requirement — but the property that actually matters is that the
 * queue is **transactional with the data it mutates**. "Did the rent posting run
 * exactly once?" is answerable because the claim and the write commit together.
 *
 * `SKIP LOCKED` means two runners never take the same row: the second skips it
 * rather than blocking, so N processes are N workers with no code change.
 */

import { sql } from 'drizzle-orm';

import { log } from '../log';
import { db } from '../db/client';
import type { DbTransaction } from '../db/client';

export interface JobRecord {
  readonly id: string;
  readonly kind: string;
  readonly payload: Record<string, unknown>;
  readonly attempts: number;
  readonly maxAttempts: number;
}

/**
 * What the runner supplies to a handler beyond the job row itself.
 *
 * `now` is the instant the *run* began — resolved once in {@link runDueJobs} and
 * shared by every job that run claims, so two jobs in one batch cannot disagree
 * about what day it is. It exists because a handler that calls `new Date()`
 * itself is unreachable from a test: the caller can pin every other clock in the
 * request and still not pin that one. This is the same injection the rest of the
 * codebase already relies on (`createReadCtx`'s `now`, the AI circuit breaker's
 * `now`), extended to the one path that still read the clock behind its caller.
 */
export interface JobDeps {
  readonly now: Date;
}

export type JobHandler = (job: JobRecord, tx: DbTransaction, deps: JobDeps) => Promise<void>;

const handlers = new Map<string, JobHandler>();

export function registerJobHandler(kind: string, handler: JobHandler): void {
  handlers.set(kind, handler);
}

export function registeredKinds(): string[] {
  return [...handlers.keys()].sort();
}

export async function enqueue(
  kind: string,
  payload: Record<string, unknown> = {},
  options: { readonly runAfter?: Date; readonly maxAttempts?: number } = {},
): Promise<string> {
  const [row] = (
    await db().execute<{ id: string }>(sql`
      insert into jobs (kind, payload, run_after, max_attempts)
      values (${kind}, ${JSON.stringify(payload)}::jsonb,
              ${options.runAfter ?? new Date()}, ${options.maxAttempts ?? 5})
      returning id
    `)
  ).rows;

  if (!row) throw new Error(`Failed to enqueue job ${kind}.`);
  return row.id;
}

export interface RunResult {
  readonly claimed: number;
  readonly succeeded: number;
  readonly failed: number;
}

/**
 * Claim and run up to `max` due jobs.
 *
 * Each job runs in **its own** transaction: the claim, the handler's writes and
 * the completion update commit together, so a crash mid-handler leaves the row
 * `pending` with its attempt count unchanged rather than half-done.
 */
export async function runDueJobs(
  options: { readonly max?: number; readonly workerId?: string; readonly now?: Date } = {},
): Promise<RunResult> {
  const max = Math.min(Math.max(options.max ?? 10, 1), 100);
  const workerId = options.workerId ?? `worker-${process.pid}`;
  // Resolved once, deliberately: every job this run claims shares one instant.
  // Production passes nothing and gets the wall clock, exactly as before.
  const now = options.now ?? new Date();

  let claimed = 0;
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < max; i += 1) {
    const ran = await runOne(workerId, now);
    if (ran === null) break;
    claimed += 1;
    if (ran) succeeded += 1;
    else failed += 1;
  }

  return { claimed, succeeded, failed };
}

/** `null` when there was nothing to claim; `true`/`false` for success/failure. */
async function runOne(workerId: string, now: Date): Promise<boolean | null> {
  return db().transaction(async (tx) => {
    const { rows } = await tx.execute<{
      id: string;
      kind: string;
      payload: Record<string, unknown>;
      attempts: number;
      max_attempts: number;
    }>(sql`
      select id, kind, payload, attempts, max_attempts
        from jobs
       where status = 'pending' and run_after <= now()
       order by run_after
         for update skip locked
       limit 1
    `);

    const row = rows[0];
    if (!row) return null;

    const job: JobRecord = {
      id: row.id,
      kind: row.kind,
      payload: row.payload,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
    };

    const handler = handlers.get(job.kind);
    if (!handler) {
      await tx.execute(sql`
        update jobs
           set status = 'failed',
               attempts = attempts + 1,
               last_error = ${`No handler registered for "${job.kind}".`},
               completed_at = now()
         where id = ${job.id}
      `);
      log.error('job has no handler', { kind: job.kind, jobId: job.id });
      return false;
    }

    try {
      await tx.execute(sql`
        update jobs set status = 'running', locked_at = now(), locked_by = ${workerId},
                        attempts = attempts + 1
         where id = ${job.id}
      `);

      await handler(job, tx, { now });

      await tx.execute(sql`
        update jobs set status = 'done', completed_at = now(), locked_at = null, locked_by = null
         where id = ${job.id}
      `);

      log.info('job done', { kind: job.kind, jobId: job.id });
      return true;
    } catch (error) {
      // Rethrown so the surrounding transaction rolls the handler's writes back.
      // The retry bookkeeping is then applied on a clean connection below.
      throw new JobFailure(job, error);
    }
  }).catch(async (error: unknown) => {
    if (!(error instanceof JobFailure)) throw error;

    const message = error.cause instanceof Error ? error.cause.message : String(error.cause);
    const exhausted = error.job.attempts + 1 >= error.job.maxAttempts;

    await db().execute(sql`
      update jobs
         set status = ${exhausted ? 'failed' : 'pending'},
             attempts = ${error.job.attempts + 1},
             last_error = ${message.slice(0, 2000)},
             locked_at = null,
             locked_by = null,
             run_after = now() + (interval '1 minute' * ${Math.min(2 ** error.job.attempts, 60)}),
             completed_at = ${exhausted ? sql`now()` : sql`null`}
       where id = ${error.job.id}
    `);

    log.error('job failed', { kind: error.job.kind, jobId: error.job.id, exhausted });
    return false;
  });
}

class JobFailure extends Error {
  constructor(
    readonly job: JobRecord,
    override readonly cause: unknown,
  ) {
    super(`Job ${job.kind} failed`);
    this.name = 'JobFailure';
  }
}
