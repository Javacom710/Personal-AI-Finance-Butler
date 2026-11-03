import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { aiCapabilityFor } from '@/server/ai-runtime';
import { getPortfolioSummary } from '@/server/ai-read';
import { analyzeCurrentPortfolio } from '@/server/ai/reviews/portfolio';
import { investmentTransactions, auditLog } from '@/server/db/schema';
import { fakeReviewProvider } from '../helpers/fake-review-provider';
import { closeHarness, database, truncateAll } from './harness';
import { closeMoneyHarness, makeAccount, must, setupMoneyFixture, type MoneyFixture } from './money-harness';
import { makeInstrument, priceIt, recordBuy } from './investment-harness';
let alice: MoneyFixture;
beforeAll(async () => {
  await truncateAll(); alice = await setupMoneyFixture({ now: new Date('2026-08-30T12:00:00Z') });
  const broker = await makeAccount(alice.ctx, { name: 'Review broker', kind: 'brokerage', openingBalance: '100000' });
  const priced = await makeInstrument(alice.ctx, { symbol: 'REVIEW', name: 'Priced review holding' });
  const unpriced = await makeInstrument(alice.ctx, { symbol: 'UNPRICED', name: 'Unpriced review holding' });
  must(await recordBuy(alice.ctx, { accountId: broker, instrumentId: priced, on: '2026-08-01', qty: '10', price: '100' }));
  must(await recordBuy(alice.ctx, { accountId: broker, instrumentId: unpriced, on: '2026-08-01', qty: '1', price: '50' }));
  await priceIt(alice.ctx, priced, '110', '2026-08-28T12:00:00Z');
  const bob = await setupMoneyFixture(); const privateBroker = await makeAccount(bob.ctx, { name: 'Private broker', kind: 'brokerage', openingBalance: '100000' });
  const privateAsset = await makeInstrument(bob.ctx, { symbol: 'SECRET', name: 'Other owner private holding' });
  must(await recordBuy(bob.ctx, { accountId: privateBroker, instrumentId: privateAsset, on: '2026-08-01', qty: '1', price: '8888' }));
}, 120000);
afterAll(async () => { await closeMoneyHarness(); await closeHarness(); });
const prose = { content: 'Interpretation:\nThe valuation covers the priced holdings. Missing prices and historical metrics remain unavailable.\nRecommendations:\nConsider reviewing concentration alongside the valuation coverage.' };
it('retains the real engine totals, missing prices and performance reasons without exposing another owner', async () => {
  const ai = aiCapabilityFor(alice.ctx); const fake = fakeReviewProvider(prose);
  const result = await analyzeCurrentPortfolio(ai, fake.orchestrator); expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.sources[0]?.result).toEqual(await getPortfolioSummary(ai));
  const text = JSON.stringify(result);
  expect(text).toContain('1100.0000'); expect(text).toContain('Unpriced review holding'); expect(text).toContain('"marketValue":null');
  expect(text).toContain('insufficient_price_history'); expect(text).not.toContain('Other owner private holding'); expect(text).not.toContain('8888');
  expect(fake.requests).toHaveLength(2);
});
it('leaves investment transactions and audits unchanged', async () => {
  const count = async () => ({ ledger: await database().select({ n: sql<number>`count(*)::int` }).from(investmentTransactions), audits: await database().select({ n: sql<number>`count(*)::int` }).from(auditLog) });
  const before = await count(); await analyzeCurrentPortfolio(aiCapabilityFor(alice.ctx), fakeReviewProvider(prose).orchestrator);
  expect(await count()).toEqual(before);
});
