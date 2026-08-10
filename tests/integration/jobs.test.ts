import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { enqueue, registeredKinds, runDueJobs, RECURRING_POST } from '@/server/jobs';
import { createRule, listOccurrences, listTransactions } from '@/server/services';
import { closeHarness, truncateAll } from './harness';
import {
  categoryId,
  closeMoneyHarness,
  makeAccount,
  must,
  setupMoneyFixture,
  truncateMoney,
  write,
  type MoneyFixture,
} from './money-harness';

/**
 * The Postgres-backed job queue (ADR-14).
 *
 * The property that matters is not throughput but that "did the rent posting
 * run exactly once?" has an answer: the claim and the write commit together, and
 * `FOR UPDATE SKIP LOCKED` means two runners never take the same row.
 */

let fixture: MoneyFixture;
let bank: string;
let housing: string;

beforeAll(async () => {
  await truncateAll();
  fixture = await setupMoneyFixture({ now: new Date('2026-08-10T12:00:00+05:30') });
  housing = await categoryId(fixture.ctx, 'Housing');
});

beforeEach(async () => {
  await truncateMoney();
  bank = await makeAccount(fixture.ctx, { name: 'Bank', openingBalance: '100000' });
});

afterAll(async () => {
  await closeMoneyHarness();
  await closeHarness();
});

describe('the registry', () => {
  it('registers the recurring handler by importing the module', () => {
    expect(registeredKinds()).toContain(RECURRING_POST);
  });

  it('fails a job whose kind has no handler, rather than losing it silently', async () => {
    await enqueue('nothing.handles.this');
    const result = await runDueJobs();

    expect(result.claimed).toBe(1);
    expect(result.failed).toBe(1);

    const { rows } = await db().execute<{ status: string; last_error: string }>(
      sql`select status, last_error from jobs order by created_at desc limit 1`,
    );
    expect(rows[0]!.status).toBe('failed');
    expect(rows[0]!.last_error).toContain('No handler registered');
  });
});

describe('claiming', () => {
  it('leaves a job scheduled for the future alone', async () => {
    await enqueue(RECURRING_POST, {}, { runAfter: new Date(Date.now() + 3_600_000) });
    const result = await runDueJobs();
    expect(result.claimed).toBe(0);
  });

  it('marks a successful job done', async () => {
    await enqueue(RECURRING_POST, { userId: fixture.userId });
    const result = await runDueJobs();

    expect(result.succeeded).toBe(1);
    const { rows } = await db().execute<{ status: string; attempts: number }>(
      sql`select status, attempts from jobs order by created_at desc limit 1`,
    );
    expect(rows[0]!.status).toBe('done');
    expect(rows[0]!.attempts).toBe(1);
  });

  it('two concurrent runners execute each job exactly once', async () => {
    for (let i = 0; i < 6; i += 1) {
      await enqueue(RECURRING_POST, { userId: fixture.userId });
    }

    const [a, b] = await Promise.all([runDueJobs({ max: 10 }), runDueJobs({ max: 10 })]);

    // SKIP LOCKED means the second runner steps past a locked row rather than
    // waiting for it, so the two together claim each job once and only once.
    expect(a.claimed + b.claimed).toBe(6);

    const { rows } = await db().execute<{ n: string }>(
      sql`select count(*)::text as n from jobs where status = 'done'`,
    );
    expect(rows[0]!.n).toBe('6');
  });
});

describe('recurring.post as a job', () => {
  beforeEach(async () => {
    must(
      await write(fixture.ctx, (w) =>
        createRule(w, {
          name: 'Rent',
          template: {
            kind: 'expense',
            accountId: bank,
            categoryId: housing,
            amount: '35000',
            description: 'Monthly rent',
          },
          rrule: 'FREQ=MONTHLY;BYMONTHDAY=1',
          startsOn: '2026-07-01',
          endsOn: null,
          autoPost: true,
        }),
      ),
    );
  });

  it('materialises and posts what is due', async () => {
    await enqueue(RECURRING_POST, { userId: fixture.userId });
    await runDueJobs();

    // 1 July and 1 August are due on 10 August; 1 September and 1 October are not.
    expect(must(await listTransactions(fixture.ctx)).total).toBe(2);
    expect(await listOccurrences(fixture.ctx, { status: 'posted' })).toHaveLength(2);
    expect(await listOccurrences(fixture.ctx, { status: 'pending' })).toHaveLength(2);
  });

  it('running the job twice on one day still creates exactly one transaction per date', async () => {
    await enqueue(RECURRING_POST, { userId: fixture.userId });
    await runDueJobs();
    await enqueue(RECURRING_POST, { userId: fixture.userId });
    await runDueJobs();

    expect(must(await listTransactions(fixture.ctx)).total).toBe(2);
  });

  it('two concurrent job runs still create exactly one transaction per date', async () => {
    await enqueue(RECURRING_POST, { userId: fixture.userId });
    await enqueue(RECURRING_POST, { userId: fixture.userId });

    await Promise.all([runDueJobs({ max: 5 }), runDueJobs({ max: 5 })]);

    expect(must(await listTransactions(fixture.ctx)).total).toBe(2);
    expect(await listOccurrences(fixture.ctx, { status: 'posted' })).toHaveLength(2);
  });
});
