import { afterAll, beforeAll, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { aiConversations, aiMessages, auditLog, transactions, users } from '@/server/db/schema';
import { archiveConversation, askConversation, conversationMessages, createConversation, deleteConversation, exportConversation, getConversation, listConversations, renameConversation } from '@/server/services/aiConversations';
import type { Orchestrator } from '@/server/ai/orchestrator';
import { fakeQuestionProvider } from '../helpers/fake-question-provider';
import { closeHarness, database, truncateAll } from './harness';
import { closeMoneyHarness, setupMoneyFixture, type MoneyFixture } from './money-harness';
let alice: MoneyFixture;
let bob: MoneyFixture;
const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
beforeAll(async () => { await truncateAll(); alice = await setupMoneyFixture(); bob = await setupMoneyFixture(); }, 120000);
afterAll(async () => { await admin.end(); await closeMoneyHarness(); await closeHarness(); });
async function create(title = 'Spending review') {
  const result = await createConversation(alice.ctx, title);
  if (!result.ok) throw new Error('Conversation fixture failed');
  return result.value;
}
const answer = () => fakeQuestionProvider([{ content: 'A financial concept explanation.' }]);
async function countFinancial() {
  return { transactions: await database().select({ n: sql<number>`count(*)::int` }).from(transactions), audit: await database().select({ n: sql<number>`count(*)::int` }).from(auditLog) };
}
it('stores one atomic ordered exchange, usage metadata and no invented cost or financial writes', async () => {
  const c = await create(); const before = await countFinancial(); const fake = answer();
  expect((await askConversation(alice.ctx, c.id, 'What is savings rate?', fake.orchestrator)).ok).toBe(true);
  const messages = await conversationMessages(alice.ctx, c.id);
  expect(messages.ok).toBe(true);
  if (messages.ok) {
    expect(messages.value.map(m => [m.position, m.role])).toEqual([[0, 'user'], [1, 'assistant']]);
    expect(messages.value[0]?.content).toEqual({ text: 'What is savings rate?' });
    expect(messages.value[1]).toMatchObject({ task: 'answerFinanceQuestion', promptTokens: 1, completionTokens: 1, latencyMs: 1, costMicros: null, tier: 1 });
  }
  expect(await countFinancial()).toEqual(before);
});
it('passes saved context into a follow-up with unchanged routing and no replay of source payloads', async () => {
  const c = await create(); await askConversation(alice.ctx, c.id, 'First question', answer().orchestrator);
  const fake = answer(); await askConversation(alice.ctx, c.id, 'Explain that', fake.orchestrator);
  expect(fake.requests[0]?.messages.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
  expect(fake.requests[0]?.messages.at(-1)?.content).toBe('Explain that');
  const rows = await conversationMessages(alice.ctx, c.id); expect(rows.ok && rows.value.map(m => m.position)).toEqual([0, 1, 2, 3]);
});
it('isolates history, rename, archive, delete and export from other owners before any provider call', async () => {
  const c = await create(); const fake = answer();
  for (const result of [await getConversation(bob.ctx, c.id), await conversationMessages(bob.ctx, c.id), await exportConversation(bob.ctx, c.id), await renameConversation(bob.ctx, c.id, 'Stolen'), await archiveConversation(bob.ctx, c.id, true), await deleteConversation(bob.ctx, c.id, true), await askConversation(bob.ctx, c.id, 'Read it', fake.orchestrator)]) expect(result.ok).toBe(false);
  expect(fake.requests).toHaveLength(0); expect((await listConversations(bob.ctx)).some(x => x.id === c.id)).toBe(false);
});
it('archives without deleting, refuses new questions, and restores history', async () => {
  const c = await create(); await askConversation(alice.ctx, c.id, 'Concept?', answer().orchestrator);
  expect((await archiveConversation(alice.ctx, c.id, true)).ok).toBe(true);
  const fake = answer(); expect((await askConversation(alice.ctx, c.id, 'Continue', fake.orchestrator)).ok).toBe(false); expect(fake.requests).toHaveLength(0);
  expect((await listConversations(alice.ctx, true)).some(x => x.id === c.id)).toBe(true);
  expect((await archiveConversation(alice.ctx, c.id, false)).ok).toBe(true);
  expect((await askConversation(alice.ctx, c.id, 'Continue', answer().orchestrator)).ok).toBe(true);
});
it('requires explicit deletion and cascades both messages without changing financial records', async () => {
  const c = await create(); await askConversation(alice.ctx, c.id, 'Concept?', answer().orchestrator);
  const before = await countFinancial(); expect((await deleteConversation(alice.ctx, c.id, false)).ok).toBe(false);
  expect((await conversationMessages(alice.ctx, c.id)).ok).toBe(true);
  expect((await deleteConversation(alice.ctx, c.id, true)).ok).toBe(true);
  expect(await database().select().from(aiMessages).where(eq(aiMessages.conversationId, c.id))).toEqual([]);
  expect((await exportConversation(alice.ctx, c.id)).ok).toBe(false); expect(await countFinancial()).toEqual(before);
});
it('does not save a partial exchange after gate or output failure', async () => {
  const c = await create(); const fake = fakeQuestionProvider([{ content: 'Unreachable' }], false);
  expect((await askConversation(alice.ctx, c.id, 'Question?', fake.orchestrator)).ok).toBe(false); expect(fake.requests).toHaveLength(0);
  expect((await askConversation(alice.ctx, c.id, 'Question?', fakeQuestionProvider([{ content: '' }]).orchestrator)).ok).toBe(false);
  const rows = await conversationMessages(alice.ctx, c.id); expect(rows.ok && rows.value).toEqual([]);
  const current = await getConversation(alice.ctx, c.id); expect(current.ok && current.value.revision).toBe(0);
});
it('serializes competing complete exchanges without holding a lock across model calls or retrying', async () => {
  const c = await create(); let arrived = 0; let release!: () => void;
  const ready = new Promise<void>(r => { release = r; }); const fake = answer();
  const orchestrator: Orchestrator = { ...fake.orchestrator, run: async input => { if (++arrived === 2) release(); await ready; return fake.orchestrator.run(input); } };
  const results = await Promise.all([askConversation(alice.ctx, c.id, 'One', orchestrator), askConversation(alice.ctx, c.id, 'Two', orchestrator)]);
  expect(results.filter(r => r.ok)).toHaveLength(1); expect(fake.requests).toHaveLength(2);
  const rows = await conversationMessages(alice.ctx, c.id); expect(rows.ok && rows.value.length).toBe(2);
});
it.each(['archive', 'delete'])('refuses to append after %s during a model call', async operation => {
  const c = await create(); const fake = answer();
  const orchestrator: Orchestrator = { ...fake.orchestrator, run: async input => {
    if (operation === 'archive') await archiveConversation(alice.ctx, c.id, true); else await deleteConversation(alice.ctx, c.id, true);
    return fake.orchestrator.run(input);
  } };
  expect((await askConversation(alice.ctx, c.id, 'Question?', orchestrator)).ok).toBe(false);
  expect(await database().select().from(aiMessages).where(eq(aiMessages.conversationId, c.id))).toHaveLength(0);
});
it('rolls back revision and both messages if the final insert fails', async () => {
  const c = await create();
  await admin.query(`CREATE FUNCTION test_conversation_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.role = 'assistant' THEN RAISE EXCEPTION 'forced conversation failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_conversation_failure BEFORE INSERT ON ai_messages FOR EACH ROW EXECUTE FUNCTION test_conversation_failure()`);
  try { await expect(askConversation(alice.ctx, c.id, 'Concept?', answer().orchestrator)).rejects.toThrow(); }
  finally { await admin.query('DROP TRIGGER test_conversation_failure ON ai_messages; DROP FUNCTION test_conversation_failure()'); }
  const current = await getConversation(alice.ctx, c.id); expect(current.ok && current.value.revision).toBe(0);
  expect(await database().select().from(aiMessages).where(eq(aiMessages.conversationId, c.id))).toHaveLength(0);
});
it('keeps at most eight complete exchanges and a bounded character count in follow-up context', async () => {
  const c = await create();
  for (let i = 0; i < 10; i++) await askConversation(alice.ctx, c.id, `Question ${i}`, fakeQuestionProvider([{ content: 'x'.repeat(7000) }]).orchestrator);
  const fake = answer(); expect((await askConversation(alice.ctx, c.id, 'Latest question', fake.orchestrator)).ok).toBe(true);
  const history = fake.requests[0]!.messages.slice(1, -1);
  expect(history.length).toBeLessThanOrEqual(16); expect(history.length % 2).toBe(0); expect(history.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(16000);
  expect(history[0]?.role).toBe('user'); expect(history.at(-1)?.role).toBe('assistant');
});
it('exports every message in order and preserves exact projected amounts', async () => {
  const c = await create();
  const fake = fakeQuestionProvider([{ toolCalls: [{ id: 'source', name: 'get_cashflow_summary', argumentsJson: '{}' }], finishReason: 'tool_calls' }, { content: 'See the source for exact totals.' }]);
  expect((await askConversation(alice.ctx, c.id, 'Cash flow?', fake.orchestrator)).ok).toBe(true);
  const exported = await exportConversation(alice.ctx, c.id);
  expect(exported.ok && exported.value.messages.map(m => m.position)).toEqual([0, 1]);
  expect(JSON.stringify(exported)).toContain('0.0000'); expect(JSON.stringify(exported)).toContain('financeos-conversation-v1');
});
it('caps conversation length and rejects malformed identifiers and titles before a model call', async () => {
  const c = await create(); await database().update(aiConversations).set({ revision: 100 }).where(eq(aiConversations.id, c.id));
  const fake = answer(); expect((await askConversation(alice.ctx, c.id, 'More?', fake.orchestrator)).ok).toBe(false); expect(fake.requests).toHaveLength(0);
  expect((await createConversation(alice.ctx, '')).ok).toBe(false); expect((await renameConversation(alice.ctx, c.id, 'x'.repeat(121))).ok).toBe(false);
  expect((await exportConversation(alice.ctx, 'invalid')).ok).toBe(false);
});
it('deleting a user cascades only that user’s conversations and messages', async () => {
  const owned = await create(); await askConversation(alice.ctx, owned.id, 'Concept?', answer().orchestrator);
  const other = await createConversation(bob.ctx, 'Bob history'); if (!other.ok) throw new Error('Fixture');
  await askConversation(bob.ctx, other.value.id, 'Concept?', answer().orchestrator);
  await database().delete(users).where(eq(users.id, bob.userId));
  expect(await database().select().from(aiMessages).where(eq(aiMessages.conversationId, other.value.id))).toHaveLength(0);
  expect(await database().select().from(aiConversations).where(and(eq(aiConversations.userId, alice.userId), eq(aiConversations.id, owned.id)))).toHaveLength(1);
});
