import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FinancialReviewResult } from '@app/(app)/ai/reviews/review-result';
import { aiCapabilityFor } from '@/server/ai-runtime';
import { monthlyFinancialReview } from '@/server/ai/reviews/monthly';
import { getCashflowSummary } from '@/server/ai-read';
import { transactions, auditLog } from '@/server/db/schema';
import { fakeReviewProvider } from '../helpers/fake-review-provider';
import { closeHarness, database, truncateAll } from './harness';
import { categoryId, closeMoneyHarness, makeAccount, record, setupMoneyFixture, transfer, type MoneyFixture } from './money-harness';
let alice: MoneyFixture; let bob: MoneyFixture;
beforeAll(async () => {
  await truncateAll(); alice = await setupMoneyFixture({ now: new Date('2026-08-30T12:00:00Z') }); bob = await setupMoneyFixture({ now: new Date('2026-08-30T12:00:00Z') });
  const bank = await makeAccount(alice.ctx, { name: 'Monthly bank' }); const cash = await makeAccount(alice.ctx, { name: 'Monthly cash', kind: 'cash' });
  await record(alice.ctx, { kind: 'income', accountId: bank, categoryId: await categoryId(alice.ctx, 'Salary'), amount: '5000', bookedOn: '2026-08-01' });
  await record(alice.ctx, { kind: 'expense', accountId: bank, categoryId: await categoryId(alice.ctx, 'Groceries'), amount: '1250.50', bookedOn: '2026-08-10' });
  await transfer(alice.ctx, { fromAccountId: bank, toAccountId: cash, amount: '999', bookedOn: '2026-08-15' });
  const other = await makeAccount(bob.ctx, { name: 'Private other bank' });
  await record(bob.ctx, { kind: 'income', accountId: other, categoryId: await categoryId(bob.ctx, 'Salary'), amount: '88888.88', bookedOn: '2026-08-01' });
}, 120000);
afterAll(async () => { await closeMoneyHarness(); await closeHarness(); });
it('uses exactly the engine projection, excludes transfers from spending, and isolates owners', async () => {
  const ai = aiCapabilityFor(alice.ctx); const fake = fakeReviewProvider();
  const result = await monthlyFinancialReview(ai, fake.orchestrator, '2026-08');
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.sources[0]?.result).toEqual(await getCashflowSummary(ai, { asOf: '2026-08-01' }));
    const html = renderToStaticMarkup(createElement(FinancialReviewResult, { review: result.value }));
    for (const label of ['Facts', 'Deterministic calculations', 'Interpretation', 'Recommendation', '3749.5000']) expect(html).toContain(label);
  }
  const sources = JSON.stringify(result);
  expect(sources).toContain('1250.5000'); expect(sources).toContain('3749.5000');
  expect(sources).not.toContain('"amount":"88888.8800"'); expect(JSON.stringify(fake.requests)).not.toContain(bob.userId);
});
it('preserves a missing savings rate as unavailable for an empty month', async () => {
  const result = await monthlyFinancialReview(aiCapabilityFor(alice.ctx), fakeReviewProvider().orchestrator, '2026-06');
  expect(result.ok).toBe(true); expect(JSON.stringify(result)).toContain('divide_by_zero');
});
it('does not mutate transactions or audit history', async () => {
  const count = async () => ({ transactions: await database().select({ n: sql<number>`count(*)::int` }).from(transactions), audits: await database().select({ n: sql<number>`count(*)::int` }).from(auditLog) });
  const before = await count();
  await monthlyFinancialReview(aiCapabilityFor(alice.ctx), fakeReviewProvider().orchestrator, '2026-08');
  expect(await count()).toEqual(before);
});
