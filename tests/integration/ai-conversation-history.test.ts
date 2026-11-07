import { afterAll, beforeAll, expect, it } from 'vitest';
import { aiConversations } from '@/server/db/schema';
import { listConversationPage, listConversations } from '@/server/services/aiConversations';
import { closeHarness, database, truncateAll } from './harness';
import { closeMoneyHarness, setupMoneyFixture, type MoneyFixture } from './money-harness';

let alice: MoneyFixture;
let bob: MoneyFixture;
let activeIds: string[];
let archivedIds: string[];
beforeAll(async () => {
  await truncateAll();
  alice = await setupMoneyFixture(); bob = await setupMoneyFixture();
  // Equal timestamps exercise the UUID tie-break rather than insertion order.
  const rows = await database().insert(aiConversations).values([
    ...Array.from({ length: 52 }, (_, i) => ({ userId: alice.userId, title: `Active ${i}`, updatedAt: alice.ctx.now })),
    ...Array.from({ length: 51 }, (_, i) => ({ userId: alice.userId, title: `Archived ${i}`, updatedAt: alice.ctx.now, archivedAt: alice.ctx.now })),
    { userId: bob.userId, title: 'Other owner private conversation', updatedAt: alice.ctx.now },
  ]).returning();
  activeIds = rows.filter(r => r.userId === alice.userId && !r.archivedAt).map(r => r.id).sort().reverse();
  archivedIds = rows.filter(r => r.userId === alice.userId && r.archivedAt).map(r => r.id).sort().reverse();
}, 120000);
afterAll(async () => { await closeMoneyHarness(); await closeHarness(); });

it.each([false, true])('pages every owner conversation exactly once, archived=%s', async archived => {
  const first = await listConversationPage(alice.ctx, archived);
  const second = await listConversationPage(alice.ctx, archived, '2');
  const beyond = await listConversationPage(alice.ctx, archived, 3);
  expect(first.ok && second.ok && beyond.ok).toBe(true);
  if (!first.ok || !second.ok || !beyond.ok) return;
  expect(first.value.items).toHaveLength(50); expect(first.value.hasMore).toBe(true);
  expect(second.value.hasMore).toBe(false);
  expect([...first.value.items, ...second.value.items].map(c => c.id)).toEqual(archived ? archivedIds : activeIds);
  expect(beyond.value).toEqual({ items: [], page: 3, hasMore: false });
  expect(await listConversations(alice.ctx, archived)).toEqual(first.value.items);
});
it('keeps another owner isolated on every page', async () => {
  const own = await listConversationPage(bob.ctx);
  expect(own.ok && own.value.items.map(c => c.title)).toEqual(['Other owner private conversation']);
  const second = await listConversationPage(bob.ctx, false, 2);
  const archived = await listConversationPage(bob.ctx, true);
  expect(second.ok && second.value.items).toEqual([]); expect(archived.ok && archived.value.items).toEqual([]);
});
it('refuses malformed, fractional, repeated and unsafe page numbers before accessing the database', async () => {
  const noDatabase = { ...alice.ctx, db: undefined } as unknown as typeof alice.ctx;
  for (const input of [0, -1, 1.1, '', '01', '1e2', '2.0', 'NaN', ['1', '2'], Number.MAX_SAFE_INTEGER]) {
    const result = await listConversationPage(noDatabase, false, input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('validation_failed');
  }
});
