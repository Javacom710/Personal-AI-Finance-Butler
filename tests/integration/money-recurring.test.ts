import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { toDbString } from '@/lib/decimal/money';
import { db } from '@/server/db/client';
import { createReadCtx, withWriteCtx } from '@/server/services';
import {
  createRule,
  deleteRule,
  getAccount,
  listOccurrences,
  listRules,
  listTransactions,
  materialiseOccurrences,
  postDueOccurrences,
  postOccurrence,
  skipOccurrence,
  updateRule,
  upcomingCommitments,
} from '@/server/services';
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
 * Idempotent posting (ADR-15).
 *
 * "Did the rent get posted twice?" is the most damaging routine bug in a
 * personal finance application, so the guarantee is asserted three ways: a
 * repeated job run, a repeated manual post, and two runners racing.
 */

let fixture: MoneyFixture;
let bank: string;
let wallet: string;
let housing: string;

const NOW = new Date('2026-08-10T12:00:00+05:30');

beforeAll(async () => {
  await truncateAll();
  fixture = await setupMoneyFixture({ now: NOW });
  housing = await categoryId(fixture.ctx, 'Housing');
});

beforeEach(async () => {
  await truncateMoney();
  bank = await makeAccount(fixture.ctx, { name: 'Bank', openingBalance: '100000' });
  wallet = await makeAccount(fixture.ctx, { name: 'Wallet', kind: 'wallet' });
});

afterAll(async () => {
  await closeMoneyHarness();
  await closeHarness();
});

async function rentRule(
  overrides: {
    rrule?: string;
    startsOn?: string;
    endsOn?: string | null;
    autoPost?: boolean;
    amount?: string;
  } = {},
): Promise<string> {
  return must(
    await write(fixture.ctx, (w) =>
      createRule(w, {
        name: 'Rent',
        template: {
          kind: 'expense',
          accountId: bank,
          categoryId: housing,
          amount: overrides.amount ?? '35000',
          description: 'Monthly rent',
        },
        rrule: overrides.rrule ?? 'FREQ=MONTHLY;BYMONTHDAY=1',
        startsOn: overrides.startsOn ?? '2026-06-01',
        endsOn: overrides.endsOn ?? null,
        autoPost: overrides.autoPost ?? false,
      }),
    ),
  );
}

describe('materialising occurrences', () => {
  it('creates one pending row per due date, catching up from the start date', async () => {
    await rentRule();
    const result = must(await write(fixture.ctx, (w) => materialiseOccurrences(w)));

    // 1 June through 1 October (today + 60 days) is five occurrences.
    expect(result.created).toBe(5);
    const occurrences = await listOccurrences(fixture.ctx);
    expect(occurrences.map((o) => o.dueOn)).toEqual([
      '2026-06-01',
      '2026-07-01',
      '2026-08-01',
      '2026-09-01',
      '2026-10-01',
    ]);
    expect(occurrences.every((o) => o.status === 'pending')).toBe(true);
  });

  it('is idempotent — a second run creates nothing (edge case 11)', async () => {
    await rentRule();
    const first = must(await write(fixture.ctx, (w) => materialiseOccurrences(w)));
    const second = must(await write(fixture.ctx, (w) => materialiseOccurrences(w)));

    expect(first.created).toBeGreaterThan(0);
    expect(second.created).toBe(0);
    expect(await listOccurrences(fixture.ctx)).toHaveLength(first.created);
  });

  it('puts the 31st on the last day of a short month (edge case 10)', async () => {
    await rentRule({ rrule: 'FREQ=MONTHLY;BYMONTHDAY=31', startsOn: '2026-01-31' });
    must(await write(fixture.ctx, (w) => materialiseOccurrences(w)));

    const dates = (await listOccurrences(fixture.ctx)).map((o) => o.dueOn);
    expect(dates).toContain('2026-01-31');
    expect(dates).toContain('2026-02-28');
    expect(dates).toContain('2026-04-30');
    expect(dates).not.toContain('2026-03-01');
  });

  it('clamps to 29 February in a leap year', async () => {
    await rentRule({ rrule: 'FREQ=MONTHLY;BYMONTHDAY=31', startsOn: '2028-01-31' });
    const ctx = { ...fixture.ctx, today: '2028-03-01' as never };
    must(await write(ctx, (w) => materialiseOccurrences(w, { horizonDays: 60 })));

    const dates = (await listOccurrences(fixture.ctx)).map((o) => o.dueOn);
    expect(dates).toContain('2028-02-29');
  });

  it('stops at the rule’s end date (edge case 12)', async () => {
    await rentRule({ startsOn: '2026-06-01', endsOn: '2026-08-15' });
    must(await write(fixture.ctx, (w) => materialiseOccurrences(w)));

    const dates = (await listOccurrences(fixture.ctx)).map((o) => o.dueOn);
    expect(dates).toEqual(['2026-06-01', '2026-07-01', '2026-08-01']);
  });

  it('creates nothing for an inactive rule', async () => {
    const id = await rentRule();
    must(await write(fixture.ctx, (w) => updateRule(w, id, { isActive: false })));
    const result = must(await write(fixture.ctx, (w) => materialiseOccurrences(w)));
    expect(result.created).toBe(0);
  });
});

describe('posting', () => {
  it('creates a transaction from the template and links it back', async () => {
    await rentRule();
    must(await write(fixture.ctx, (w) => materialiseOccurrences(w)));

    const due = (await listOccurrences(fixture.ctx)).find((o) => o.dueOn === '2026-08-01')!;
    const outcome = must(await write(fixture.ctx, (w) => postOccurrence(w, due.id)));

    expect(outcome.status).toBe('posted');
    if (outcome.status !== 'posted') return;

    const txns = must(await listTransactions(fixture.ctx, { kind: 'expense' }));
    expect(txns.total).toBe(1);
    expect(txns.rows[0]!.description).toBe('Monthly rent');
    expect(txns.rows[0]!.source).toBe('recurring');
    expect(txns.rows[0]!.recurringRuleId).toBeTruthy();
    expect(toDbString(txns.rows[0]!.amount)).toBe('35000.0000');

    const after = (await listOccurrences(fixture.ctx, { status: 'posted' })).find(
      (o) => o.dueOn === '2026-08-01',
    );
    expect(after?.transactionId).toBe(outcome.transactionId);
  });

  it('posting the same occurrence twice creates exactly one transaction', async () => {
    await rentRule();
    must(await write(fixture.ctx, (w) => materialiseOccurrences(w)));
    const due = (await listOccurrences(fixture.ctx)).find((o) => o.dueOn === '2026-08-01')!;

    const first = must(await write(fixture.ctx, (w) => postOccurrence(w, due.id)));
    const second = must(await write(fixture.ctx, (w) => postOccurrence(w, due.id)));

    expect(first.status).toBe('posted');
    expect(second.status).toBe('already_settled');
    expect(must(await listTransactions(fixture.ctx, { kind: 'expense' })).total).toBe(1);
  });

  it('refuses to post an occurrence that is not yet due', async () => {
    await rentRule();
    must(await write(fixture.ctx, (w) => materialiseOccurrences(w)));
    const future = (await listOccurrences(fixture.ctx)).find((o) => o.dueOn === '2026-09-01')!;

    const outcome = must(await write(fixture.ctx, (w) => postOccurrence(w, future.id)));
    expect(outcome.status).toBe('not_due');
    expect(must(await listTransactions(fixture.ctx)).total).toBe(0);
  });

  it('posts a transfer template as a transfer, not as spending', async () => {
    must(
      await write(fixture.ctx, (w) =>
        createRule(w, {
          name: 'Monthly savings sweep',
          template: {
            kind: 'transfer',
            fromAccountId: bank,
            toAccountId: wallet,
            amount: '10000',
            description: 'Sweep to wallet',
          },
          rrule: 'FREQ=MONTHLY;BYMONTHDAY=1',
          startsOn: '2026-08-01',
          endsOn: null,
          autoPost: true,
        }),
      ),
    );

    must(await write(fixture.ctx, (w) => postDueOccurrences(w)));

    const all = must(await listTransactions(fixture.ctx));
    expect(all.rows.map((r) => r.kind)).toEqual(['transfer']);
    expect(toDbString(must(await getAccount(fixture.ctx, wallet)).balance)).toBe('10000.0000');
  });

  it('skips an occurrence without creating anything', async () => {
    await rentRule();
    must(await write(fixture.ctx, (w) => materialiseOccurrences(w)));
    const due = (await listOccurrences(fixture.ctx)).find((o) => o.dueOn === '2026-08-01')!;

    must(await write(fixture.ctx, (w) => skipOccurrence(w, due.id)));

    expect(must(await listTransactions(fixture.ctx)).total).toBe(0);
    expect(await listOccurrences(fixture.ctx, { status: 'skipped' })).toHaveLength(1);
  });

  it('cannot post an occurrence that was skipped', async () => {
    await rentRule();
    must(await write(fixture.ctx, (w) => materialiseOccurrences(w)));
    const due = (await listOccurrences(fixture.ctx)).find((o) => o.dueOn === '2026-08-01')!;

    must(await write(fixture.ctx, (w) => skipOccurrence(w, due.id)));
    const outcome = must(await write(fixture.ctx, (w) => postOccurrence(w, due.id)));
    expect(outcome.status).toBe('already_settled');
  });
});

describe('the posting job', () => {
  it('posts only what auto_post marks, and only what is due', async () => {
    await rentRule({ autoPost: true });
    await rentRule({ autoPost: false }).catch(() => undefined); // name clash is fine to ignore

    const result = must(await write(fixture.ctx, (w) => postDueOccurrences(w)));
    // 1 June, 1 July and 1 August are due on 10 August; 1 September is not.
    expect(result.posted).toBe(3);
    expect(must(await listTransactions(fixture.ctx)).total).toBe(3);
  });

  it('run twice on one day creates exactly one transaction per due date', async () => {
    await rentRule({ autoPost: true });

    const first = must(await write(fixture.ctx, (w) => postDueOccurrences(w)));
    const second = must(await write(fixture.ctx, (w) => postDueOccurrences(w)));

    expect(first.posted).toBe(3);
    expect(second.posted).toBe(0);
    expect(second.materialised).toBe(0);
    expect(must(await listTransactions(fixture.ctx)).total).toBe(3);
  });

  it('two concurrent runners post each occurrence exactly once', async () => {
    await rentRule({ autoPost: true });
    must(await write(fixture.ctx, (w) => materialiseOccurrences(w)));

    // Two independent contexts, two independent database transactions — the
    // compare-and-swap claim is what makes one of them lose.
    const a = must(await createReadCtxOrThrow());
    const b = must(await createReadCtxOrThrow());

    const [first, second] = await Promise.all([
      withWriteCtx(a, (w) => postDueOccurrences(w)),
      withWriteCtx(b, (w) => postDueOccurrences(w)),
    ]);

    const postedA = first.ok ? first.value.posted : 0;
    const postedB = second.ok ? second.value.posted : 0;

    expect(postedA + postedB).toBe(3);
    expect(must(await listTransactions(fixture.ctx)).total).toBe(3);

    const { rows } = await db().execute<{ n: string }>(
      sql`select count(*)::text as n from recurring_occurrences where status = 'posted'`,
    );
    expect(rows[0]!.n).toBe('3');
  });

  it('records a failure without stopping the run or leaving a half-posted state', async () => {
    // A rule pointing at an account that is later closed: the posting fails,
    // its claim rolls back, and the occurrence stays pending.
    const doomed = await makeAccount(fixture.ctx, { name: 'To be closed' });
    must(
      await write(fixture.ctx, (w) =>
        createRule(w, {
          name: 'Doomed',
          template: {
            kind: 'expense',
            accountId: doomed,
            categoryId: housing,
            amount: '100',
            description: 'will fail',
          },
          rrule: 'FREQ=MONTHLY;BYMONTHDAY=1',
          startsOn: '2026-08-01',
          endsOn: null,
          autoPost: true,
        }),
      ),
    );

    const { setAccountActive } = await import('@/server/services');
    must(await write(fixture.ctx, (w) => setAccountActive(w, doomed, false)));

    const result = must(await write(fixture.ctx, (w) => postDueOccurrences(w)));
    expect(result.posted).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(must(await listTransactions(fixture.ctx)).total).toBe(0);

    // Three occurrences were materialised (1 Aug, 1 Sep, 1 Oct); only 1 August
    // was due. The failed claim rolled back with its savepoint, so **none** of
    // them is marked posted — an occurrence marked posted with no transaction
    // behind it would violate I-9 and silently skip a real commitment.
    expect(await listOccurrences(fixture.ctx, { status: 'pending' })).toHaveLength(3);
    expect(await listOccurrences(fixture.ctx, { status: 'posted' })).toHaveLength(0);
  });
});

describe('rules', () => {
  it('reports the next due date and a readable schedule', async () => {
    await rentRule();
    const [rule] = await listRules(fixture.ctx);
    expect(rule!.nextDueOn).toBe('2026-09-01');
    expect(rule!.rruleDescription).toBe('Monthly on day 1');
  });

  it('drops pending occurrences when the schedule changes, keeping posted ones', async () => {
    const id = await rentRule({ autoPost: true });
    must(await write(fixture.ctx, (w) => postDueOccurrences(w)));

    const postedBefore = await listOccurrences(fixture.ctx, { status: 'posted' });
    expect(postedBefore).toHaveLength(3);

    must(await write(fixture.ctx, (w) => updateRule(w, id, { rrule: 'FREQ=MONTHLY;BYMONTHDAY=15' })));

    expect(await listOccurrences(fixture.ctx, { status: 'pending' })).toHaveLength(0);
    expect(await listOccurrences(fixture.ctx, { status: 'posted' })).toHaveLength(3);
  });

  it('keeps posted transactions when the rule is deleted', async () => {
    const id = await rentRule({ autoPost: true });
    must(await write(fixture.ctx, (w) => postDueOccurrences(w)));
    must(await write(fixture.ctx, (w) => deleteRule(w, id)));

    const txns = must(await listTransactions(fixture.ctx));
    expect(txns.total).toBe(3);
    // The link is cleared, but the money movement is real and stays.
    expect(txns.rows[0]!.recurringRuleId).toBeNull();
  });

  it('rejects an unparseable schedule at the boundary', async () => {
    const result = await write(fixture.ctx, (w) =>
      createRule(w, {
        name: 'Nonsense',
        template: { kind: 'expense', accountId: bank, categoryId: housing, amount: '1', description: 'x' },
        rrule: 'FREQ=FORTNIGHTLY',
        startsOn: '2026-08-01',
        endsOn: null,
        autoPost: false,
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects an investment template before the investment ledger exists', async () => {
    const result = await write(fixture.ctx, (w) =>
      createRule(w, {
        name: 'SIP',
        template: { kind: 'investment', accountId: bank, amount: '5000', description: 'SIP' } as never,
        rrule: 'FREQ=MONTHLY',
        startsOn: '2026-08-01',
        endsOn: null,
        autoPost: false,
      }),
    );
    expect(result.ok).toBe(false);
  });
});

describe('upcoming commitments', () => {
  it('lists pending occurrences inside the horizon only', async () => {
    await rentRule({ rrule: 'FREQ=MONTHLY;BYMONTHDAY=15', startsOn: '2026-08-01' });
    must(await write(fixture.ctx, (w) => materialiseOccurrences(w)));

    const soon = await upcomingCommitments(fixture.ctx, 14);
    expect(soon.map((o) => o.dueOn)).toEqual(['2026-08-15']);
  });
});

async function createReadCtxOrThrow() {
  return createReadCtx(fixture.userId, { now: NOW });
}
