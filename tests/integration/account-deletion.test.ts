import { Secret, TOTP } from 'otpauth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DELETION_PHRASE, deleteAccount } from '@/server/auth/account-deletion';
import { createSession, resolveSession } from '@/server/auth/session-store';
import { askConversation, createConversation, createReadCtx, createRule, createBudget, materialiseOccurrences, EXPORTED_TABLES, type RequestCtx } from '@/server/services';
import { fakeQuestionProvider } from '../helpers/fake-question-provider';
import { NO_CONTEXT, TEST_PASSWORD, closeHarness, createTestUser, truncateAll, type TestUser } from './harness';
import { makeInstrument, recordBuy, storeClose } from './investment-harness';
import { categoryId, closeMoneyHarness, makeAccount, must, rawSql, record, transfer, write } from './money-harness';
import { makeAsset, makeLiability } from './networth-harness';

/**
 * Settings → Data → Delete everything (SECURITY.md §9).
 *
 * The property that matters is the absolute one: after a deletion, **no row in
 * any table belongs to that user**, and nothing belonging to anyone else has
 * moved. The fixture puts a row in as many user-owned tables as the services
 * can reach, including the ones owned through a parent (entries, tags,
 * occurrences, prices, messages), and the audit log, which the application
 * role can never delete from directly.
 */

const NOW = new Date('2026-08-10T12:00:00+05:30');

function totpCode(user: TestUser, at = new Date()): string {
  return new TOTP({ issuer: 'Finance OS', label: user.email, algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(user.totpSecret) })
    .generate({ timestamp: at.getTime() });
}

async function contextFor(user: TestUser): Promise<RequestCtx> {
  const ctx = await createReadCtx(user.userId, { now: NOW });
  if (!ctx.ok) throw new Error('fixture context');
  return ctx.value;
}

/** A user with records across the ledger, investments, net worth, AI and auth. */
async function populate(user: TestUser): Promise<void> {
  const ctx = await contextFor(user);
  const bank = await makeAccount(ctx, { name: 'Bank', openingBalance: '100000' });
  const wallet = await makeAccount(ctx, { name: 'Wallet', kind: 'wallet' });
  const food = await categoryId(ctx, 'Food');
  const housing = await categoryId(ctx, 'Housing');
  await record(ctx, { kind: 'expense', accountId: bank, categoryId: food, amount: '1250', bookedOn: '2026-08-01', tags: ['dinner'] });
  await transfer(ctx, { fromAccountId: bank, toAccountId: wallet, amount: '500', bookedOn: '2026-08-02' });
  must(await write(ctx, (w) => createBudget(w, { categoryId: food, period: 'monthly', amount: '10000', currencyCode: 'INR', startsOn: '2026-01-01' })));
  must(await write(ctx, (w) => createRule(w, {
    name: 'Rent', template: { kind: 'expense', accountId: bank, categoryId: housing, amount: '35000', description: 'Rent' },
    rrule: 'FREQ=MONTHLY;BYMONTHDAY=1', startsOn: '2026-07-01', endsOn: null, autoPost: false,
  })));
  must(await write(ctx, (w) => materialiseOccurrences(w)));

  const demat = await makeAccount(ctx, { name: 'Demat', kind: 'brokerage', openingBalance: '50000' });
  const stock = await makeInstrument(ctx, { symbol: `DEL${user.userId.slice(0, 4)}` });
  must(await recordBuy(ctx, { accountId: demat, instrumentId: stock, on: '2026-02-02', qty: '10', price: '100' }));
  await storeClose(ctx, { instrumentId: stock, on: '2026-08-07', close: '120' });

  await makeAsset(ctx, { name: 'Flat', value: '9000000', valuedOn: '2026-03-31' });
  await makeLiability(ctx, { name: 'Home loan', openingBalance: '4000000', openingBalanceOn: '2026-01-01', startedOn: '2026-01-01' });

  const conversation = must(await createConversation(ctx, 'Review'));
  must(await askConversation(ctx, conversation.id, 'What is a savings rate?', fakeQuestionProvider([{ content: 'An explanation.' }]).orchestrator));

  await createSession(user.userId, NO_CONTEXT);
}

/** Rows owned by `userId` in every exported table, plus sessions and the user row itself. */
async function ownedRowCounts(userId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of EXPORTED_TABLES) {
    const query =
      table.owner.kind === 'user'
        ? `select count(*)::int as n from "${table.name}" where user_id = $1`
        : `select count(*)::int as n from "${table.name}" t join "${table.owner.parent}" p on p.id = t."${table.owner.fk}" where p.user_id = $1`;
    counts[table.name] = ((await rawSql(query, [userId])) as { rows: { n: number }[] }).rows[0]!.n;
  }
  counts['sessions'] = ((await rawSql('select count(*)::int as n from sessions where user_id = $1', [userId])) as { rows: { n: number }[] }).rows[0]!.n;
  counts['users'] = ((await rawSql('select count(*)::int as n from users where id = $1', [userId])) as { rows: { n: number }[] }).rows[0]!.n;
  return counts;
}

/** Child rows are found through their parents, so orphans are counted separately. */
async function orphanCount(): Promise<number> {
  let total = 0;
  for (const table of EXPORTED_TABLES) {
    if (table.owner.kind !== 'parent') continue;
    const { rows } = (await rawSql(
      `select count(*)::int as n from "${table.name}" t left join "${table.owner.parent}" p on p.id = t."${table.owner.fk}" where p.id is null`,
    )) as { rows: { n: number }[] };
    total += rows[0]!.n;
  }
  return total;
}

let victim: TestUser;
let bystander: TestUser;

beforeAll(async () => {
  await truncateAll();
  victim = await createTestUser('delete-me@example.com');
  bystander = await createTestUser('keep-me@example.com');
  await populate(victim);
  await populate(bystander);
}, 120_000);

afterAll(async () => {
  await closeMoneyHarness();
  await closeHarness();
});

describe('deleteAccount', () => {
  it('refuses a wrong phrase before checking anything else, and records nothing', async () => {
    const before = await ownedRowCounts(victim.userId);
    const result = await deleteAccount(victim.userId, { password: TEST_PASSWORD, code: totpCode(victim), confirmation: 'delete everything' }, NO_CONTEXT);
    expect(result.status).toBe('confirmation_mismatch');
    expect(await ownedRowCounts(victim.userId)).toEqual(before);
  });

  it('refuses a wrong password and a wrong code, each counted as a failed attempt', async () => {
    const wrongPassword = await deleteAccount(victim.userId, { password: 'not-the-password-at-all', code: totpCode(victim), confirmation: DELETION_PHRASE }, NO_CONTEXT);
    expect(wrongPassword.status).toBe('invalid_password');
    const wrongCode = await deleteAccount(victim.userId, { password: TEST_PASSWORD, code: '000000', confirmation: DELETION_PHRASE }, NO_CONTEXT);
    expect(wrongCode.status).toBe('invalid_code');

    const { rows } = (await rawSql(
      `select kind::text as kind from auth_events where user_id = $1 and kind in ('login_failure', 'totp_failure') order by created_at`,
      [victim.userId],
    )) as { rows: { kind: string }[] };
    expect(rows.map((r) => r.kind)).toEqual(['login_failure', 'totp_failure']);
    expect((await ownedRowCounts(victim.userId))['users']).toBe(1);
  });

  it('does not accept a recovery code in place of a TOTP code', async () => {
    const result = await deleteAccount(victim.userId, { password: TEST_PASSWORD, code: victim.recoveryCodes[0]!, confirmation: DELETION_PHRASE }, NO_CONTEXT);
    expect(result.status).toBe('invalid_code');
    // Clear the failures so the next test is not rate limited by this one.
    await rawSql(`delete from auth_events where user_id = $1`, [victim.userId]);
    await rawSql(`update users set failed_attempts = 0, locked_until = null where id = $1`, [victim.userId]);
  });

  it('is all or nothing: a failure at the last step leaves every row in place', async () => {
    const before = await ownedRowCounts(victim.userId);
    await rawSql(`create function test_block_user_delete() returns trigger language plpgsql as $$
                  begin raise exception 'forced deletion failure'; end $$`);
    await rawSql(`create trigger test_block_user_delete before delete on users
                  for each row execute function test_block_user_delete()`);
    const code = totpCode(victim, new Date(Date.now() - 30_000));
    try {
      await expect(
        deleteAccount(victim.userId, { password: TEST_PASSWORD, code, confirmation: DELETION_PHRASE }, NO_CONTEXT),
      ).rejects.toThrow();
    } finally {
      await rawSql('drop trigger test_block_user_delete on users');
      await rawSql('drop function test_block_user_delete()');
    }
    // Transactions, investment transactions, liabilities and categories were
    // deleted before the failure — and are all back.
    expect(await ownedRowCounts(victim.userId)).toEqual(before);

    // The code was consumed even though the deletion failed: it cannot be replayed.
    const replay = await deleteAccount(victim.userId, { password: TEST_PASSWORD, code, confirmation: DELETION_PHRASE }, NO_CONTEXT);
    expect(replay.status).toBe('invalid_code');
    await rawSql(`delete from auth_events where user_id = $1`, [victim.userId]);
    await rawSql(`update users set failed_attempts = 0, locked_until = null where id = $1`, [victim.userId]);
  });

  it('refuses a code that a sign-in consumes while the password is being checked', async () => {
    const at = new Date();
    const step = BigInt(Math.floor(at.getTime() / 30_000));
    const pending = deleteAccount(victim.userId, { password: TEST_PASSWORD, code: totpCode(victim, at), confirmation: DELETION_PHRASE }, NO_CONTEXT);
    // Argon2 takes ~300 ms; a sign-in with the same code lands inside it.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await rawSql('update users set last_totp_step = $2 where id = $1', [victim.userId, step.toString()]);

    expect((await pending).status).toBe('invalid_code');
    expect((await ownedRowCounts(victim.userId))['users']).toBe(1);
    await rawSql(`delete from auth_events where user_id = $1`, [victim.userId]);
    await rawSql(`update users set failed_attempts = 0, locked_until = null where id = $1`, [victim.userId]);
  });

  it('deletes every row the user owns, in every table, and nothing of anyone else’s', async () => {
    const before = await ownedRowCounts(victim.userId);
    // The fixture really did reach these tables, or the test below proves nothing.
    for (const table of ['transactions', 'transaction_entries', 'transaction_tags', 'recurring_occurrences', 'investment_transactions',
      'tax_lots', 'positions', 'instrument_prices', 'manual_assets', 'liabilities', 'ai_conversations', 'ai_messages', 'audit_log', 'sessions']) {
      expect(before[table], table).toBeGreaterThan(0);
    }
    const bystanderBefore = await ownedRowCounts(bystander.userId);

    // One step ahead: the current step was consumed by the race test above.
    const result = await deleteAccount(victim.userId, { password: TEST_PASSWORD, code: totpCode(victim, new Date(Date.now() + 30_000)), confirmation: ` ${DELETION_PHRASE} ` }, NO_CONTEXT);
    expect(result.status).toBe('deleted');

    const after = await ownedRowCounts(victim.userId);
    expect(Object.entries(after).filter(([, n]) => n > 0)).toEqual([]);
    expect(await orphanCount()).toBe(0);
    expect(await ownedRowCounts(bystander.userId)).toEqual(bystanderBefore);
  });

  it('leaves no session that still authenticates', async () => {
    const { rows } = (await rawSql('select count(*)::int as n from sessions')) as { rows: { n: number }[] };
    // Only the bystander's session remains.
    expect(rows[0]!.n).toBe(1);
    expect(await resolveSession('any-token-at-all')).toBeNull();
  });
});
