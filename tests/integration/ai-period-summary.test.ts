import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { aiCapabilityFor } from '@/server/ai-runtime';
import { getCashflowSummary } from '@/server/ai-read';
import { summarizeRecordedMonth } from '@/server/ai/reviews/period-summary';
import { transactions, auditLog } from '@/server/db/schema';
import { fakeReviewProvider } from '../helpers/fake-review-provider';
import { closeHarness, database, truncateAll } from './harness';
import { categoryId, closeMoneyHarness, makeAccount, record, setupMoneyFixture, type MoneyFixture } from './money-harness';
let alice: MoneyFixture;
const fake = () => fakeReviewProvider({ content: 'Interpretation:\nThe recorded income and spending describe the selected month. Missing metrics remain unavailable.\nRecommendations:\nNo recommendation is supported by this summary alone.' }, true, {}, 1);
beforeAll(async () => {
  await truncateAll(); alice = await setupMoneyFixture({ now: new Date('2026-08-30T12:00:00Z') });
  const account = await makeAccount(alice.ctx, { name: 'Summary bank' });
  await record(alice.ctx, { kind: 'income', accountId: account, categoryId: await categoryId(alice.ctx, 'Salary'), amount: '10000.0001', bookedOn: '2026-08-01' });
  await record(alice.ctx, { kind: 'expense', accountId: account, categoryId: await categoryId(alice.ctx, 'Groceries'), amount: '1250', bookedOn: '2026-08-10' });
  const bob = await setupMoneyFixture(); const other = await makeAccount(bob.ctx, { name: 'Other owner private summary bank' });
  await record(bob.ctx, { kind: 'income', accountId: other, categoryId: await categoryId(bob.ctx, 'Salary'), amount: '88888', bookedOn: '2026-08-01' });
}, 120000);
afterAll(async () => { await closeMoneyHarness(); await closeHarness(); });
it('uses exact engine figures and owner isolation under the existing Tier 1 route', async () => {
  const ai = aiCapabilityFor(alice.ctx); const provider = fake(); const result = await summarizeRecordedMonth(ai, provider.orchestrator, '2026-08'); expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.sources[0]?.result).toEqual(await getCashflowSummary(ai, { asOf: '2026-08-01' }));
  expect(JSON.stringify(result)).toContain('8750.0001'); expect(JSON.stringify(result)).not.toContain('"amount":"88888.0000"'); expect(provider.requests.every(r => r.maxTokens === 2048)).toBe(true);
});
it('leaves ledger and audit rows unchanged', async () => {
  const count = async () => ({ ledger: await database().select({ n: sql<number>`count(*)::int` }).from(transactions), audit: await database().select({ n: sql<number>`count(*)::int` }).from(auditLog) });
  const before = await count(); await summarizeRecordedMonth(aiCapabilityFor(alice.ctx), fake().orchestrator, '2026-08'); expect(await count()).toEqual(before);
});
