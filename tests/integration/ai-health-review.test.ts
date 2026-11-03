import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { aiCapabilityFor } from '@/server/ai-runtime';
import { getAccounts, getLiabilities } from '@/server/ai-read';
import { analyzeFinancialHealth } from '@/server/ai/reviews/health';
import { transactions, liabilityBalances, auditLog } from '@/server/db/schema';
import { fakeReviewProvider } from '../helpers/fake-review-provider';
import { closeHarness, database, truncateAll } from './harness';
import { closeMoneyHarness, makeAccount, setupMoneyFixture, type MoneyFixture } from './money-harness';
import { makeLiability } from './networth-harness';
let alice: MoneyFixture;
beforeAll(async () => {
  await truncateAll(); alice = await setupMoneyFixture({ now: new Date('2026-08-30T12:00:00Z') });
  await makeAccount(alice.ctx, { name: 'Health bank', openingBalance: '10000' });
  const card = await makeAccount(alice.ctx, { name: 'Health card', kind: 'credit_card', openingBalance: '-3000', creditLimit: '20000' });
  await makeLiability(alice.ctx, { name: 'Linked card', kind: 'credit_card', linkedAccountId: card });
  await makeLiability(alice.ctx, { name: 'Scheduled health loan', kind: 'personal_loan', openingBalance: '5000', openingBalanceOn: '2026-08-01', emiAmount: '500' });
  const bob = await setupMoneyFixture(); await makeAccount(bob.ctx, { name: 'Other owner secret bank', openingBalance: '88888' });
}, 120000);
afterAll(async () => { await closeMoneyHarness(); await closeHarness(); });
it('preserves engine balances, linked-liability nulls and missing savings metrics with owner isolation', async () => {
  const ai = aiCapabilityFor(alice.ctx); const result = await analyzeFinancialHealth(ai, fakeReviewProvider().orchestrator); expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.sources[1]?.result).toEqual(await getAccounts(ai, { asOf: ai.today }));
    expect(result.value.sources[3]?.result).toEqual(await getLiabilities(ai));
  }
  const text = JSON.stringify(result); expect(text).toContain('"outstanding":null'); expect(text).toContain('divide_by_zero'); expect(text).toContain('-3000.0000');
  expect(text).not.toContain('Other owner secret bank'); expect(text).not.toContain('88888');
});
it('does not change transactions, scheduled balances or audit history', async () => {
  const count = async () => ({ transactions: await database().select({ n: sql<number>`count(*)::int` }).from(transactions), balances: await database().select({ n: sql<number>`count(*)::int` }).from(liabilityBalances), audit: await database().select({ n: sql<number>`count(*)::int` }).from(auditLog) });
  const before = await count(); await analyzeFinancialHealth(aiCapabilityFor(alice.ctx), fakeReviewProvider().orchestrator); expect(await count()).toEqual(before);
});
