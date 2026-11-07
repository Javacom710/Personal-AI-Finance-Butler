import { afterAll, beforeAll, expect, it } from 'vitest';
import { aiCapabilityFor } from '@/server/ai-runtime';
import { answerReadOnlyQuestion } from '@/server/ai/assistant/question';
import { transactions, auditLog } from '@/server/db/schema';
import { sql } from 'drizzle-orm';
import { fakeQuestionProvider } from '../helpers/fake-question-provider';
import { closeHarness, database, truncateAll } from './harness';
import { categoryId, closeMoneyHarness, makeAccount, record, setupMoneyFixture, type MoneyFixture } from './money-harness';
let alice: MoneyFixture;
let bob: MoneyFixture;
beforeAll(async () => {
  await truncateAll();
  alice = await setupMoneyFixture({ now: new Date('2026-08-30T12:00:00Z') });
  bob = await setupMoneyFixture({ now: new Date('2026-08-30T12:00:00Z') });
  const accountId = await makeAccount(alice.ctx, { name: 'Alice bank', openingBalance: '10000', openingDate: '2026-08-01' });
  await makeAccount(bob.ctx, { name: 'Bob private bank', openingBalance: '90000', openingDate: '2026-08-01' });
  await record(alice.ctx, { kind: 'expense', accountId, categoryId: await categoryId(alice.ctx, 'Groceries'), amount: '1250.50', bookedOn: '2026-08-10', description: 'Alice groceries' });
}, 120000);
afterAll(async () => { await closeMoneyHarness(); await closeHarness(); });
const call = (name: string, argumentsJson = '{}') => ({ id: 'one', name, argumentsJson });
it('runs the real owner-bound tool dispatcher through a fake-provider question without leaking another owner', async () => {
  const fake = fakeQuestionProvider([{ toolCalls: [call('get_accounts')], finishReason: 'tool_calls' }, { content: 'The account source shows your accounts.' }]);
  const result = await answerReadOnlyQuestion(aiCapabilityFor(alice.ctx), fake.orchestrator, 'My accounts?');
  expect(result.ok).toBe(true);
  const serialized = JSON.stringify(result);
  expect(serialized).toContain('Alice bank'); expect(serialized).not.toContain('Bob private bank');
  expect(JSON.stringify(fake.requests)).not.toContain(bob.userId);
});
it('returns the same exact expense total as the financial service projection', async () => {
  const fake = fakeQuestionProvider([{ toolCalls: [call('get_expense_summary')], finishReason: 'tool_calls' }, { content: 'The total in your source is INR 1250.5000.' }]);
  const result = await answerReadOnlyQuestion(aiCapabilityFor(alice.ctx), fake.orchestrator, 'My spending?');
  expect(result.ok).toBe(true); expect(JSON.stringify(result)).toContain('1250.5000');
  expect(fake.requests.at(-1)?.messages.at(-1)?.role).toBe('tool');
});
it('an attempted write cannot change financial records or audit history', async () => {
  const count = async () => ({ transactions: await database().select({ n: sql<number>`count(*)::int` }).from(transactions), audits: await database().select({ n: sql<number>`count(*)::int` }).from(auditLog) });
  const before = await count();
  const fake = fakeQuestionProvider([{ toolCalls: [call('create_transaction', '{"amount":"9999"}')], finishReason: 'tool_calls' }, { content: 'I cannot write records.' }]);
  const result = await answerReadOnlyQuestion(aiCapabilityFor(alice.ctx), fake.orchestrator, 'Record an expense');
  expect(result.ok && result.value.sources[0]?.failed).toBe(true); expect(await count()).toEqual(before);
});
