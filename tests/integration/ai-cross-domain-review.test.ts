import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FinancialReviewResult } from '@app/(app)/ai/reviews/review-result';
import { aiCapabilityFor } from '@/server/ai-runtime';
import { getHoldings, getNetWorth } from '@/server/ai-read';
import { analyzeCrossDomainFinances } from '@/server/ai/reviews/cross-domain';
import { transactions, investmentTransactions, auditLog } from '@/server/db/schema';
import { fakeReviewProvider } from '../helpers/fake-review-provider';
import { closeHarness, database, truncateAll } from './harness';
import { closeMoneyHarness, makeAccount, must, setupMoneyFixture, type MoneyFixture } from './money-harness';
import { makeInstrument, priceIt, recordBuy } from './investment-harness';
import { makeAsset, makeLiability } from './networth-harness';
let alice: MoneyFixture;
const fake = () => fakeReviewProvider({ content: 'Interpretation:\nThe available cash flow and valuation bases describe distinct aspects of the records. Missing metrics remain unavailable.\nRecommendations:\nConsider reviewing valuation coverage and scheduled commitments before making changes.' });
beforeAll(async () => {
  await truncateAll(); alice = await setupMoneyFixture({ now: new Date('2026-08-30T12:00:00Z') });
  await makeAccount(alice.ctx, { name: 'Cross-domain bank', openingBalance: '10000' });
  const broker = await makeAccount(alice.ctx, { name: 'Cross-domain broker', kind: 'brokerage', openingBalance: '100000' });
  const instrument = await makeInstrument(alice.ctx, { symbol: 'CROSS', name: 'Cross-domain holding' });
  must(await recordBuy(alice.ctx, { accountId: broker, instrumentId: instrument, on: '2026-08-01', qty: '10', price: '100' }));
  await priceIt(alice.ctx, instrument, '120', '2026-08-10T12:00:00Z');
  await makeAsset(alice.ctx, { name: 'Cross-domain property', kind: 'property', value: '500000', valuedOn: '2026-08-01', acquiredOn: '2026-01-01' });
  await makeLiability(alice.ctx, { name: 'Cross-domain loan', openingBalance: '5000', openingBalanceOn: '2026-08-01' });
  const bob = await setupMoneyFixture(); await makeAsset(bob.ctx, { name: 'Other owner secret property', value: '888888', valuedOn: '2026-08-01', acquiredOn: '2026-01-01' });
}, 120000);
afterAll(async () => { await closeMoneyHarness(); await closeHarness(); });
it('retains distinct exact cost/market engine results and does not leak another owner across domains', async () => {
  const ai = aiCapabilityFor(alice.ctx); const result = await analyzeCrossDomainFinances(ai, fake().orchestrator); expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.sources[2]?.result).toEqual(await getNetWorth(ai, { asOf: ai.today, basis: 'cost' }));
    expect(result.value.sources[3]?.result).toEqual(await getNetWorth(ai, { asOf: ai.today, basis: 'market' }));
    expect(result.value.sources[2]?.result).not.toEqual(result.value.sources[3]?.result);
  }
  const text = JSON.stringify(result); expect(text).toContain('Cross-domain bank'); expect(text).toContain('605000.0000'); expect(text).toContain('605200.0000'); expect(text).not.toContain('Other owner secret property'); expect(text).not.toContain('"amount":"888888.0000"');
});
it('leaves money/investment ledgers and audit history unchanged', async () => {
  const count = async () => ({ money: await database().select({ n: sql<number>`count(*)::int` }).from(transactions), investments: await database().select({ n: sql<number>`count(*)::int` }).from(investmentTransactions), audits: await database().select({ n: sql<number>`count(*)::int` }).from(auditLog) });
  const before = await count(); await analyzeCrossDomainFinances(aiCapabilityFor(alice.ctx), fake().orchestrator); expect(await count()).toEqual(before);
});

it('carries stale-but-usable prices into the final model context and rendered evidence even with complete coverage', async () => {
  const ai = aiCapabilityFor(alice.ctx); const holdings = await getHoldings(ai);
  expect(holdings).toMatchObject({ ok: true, data: { holdings: [{ priceStatus: 'stale', marketValue: { amount: '1200.0000' } }], coverage: { value: '1.0000000000' } } });
  const provider = fake(); const result = await analyzeCrossDomainFinances(ai, provider.orchestrator); expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.sources.find(s => s.name === 'get_holdings')?.result).toEqual(holdings);
  const messages = provider.requests[1]!.messages.filter(m => m.role === 'tool');
  expect(messages.some(m => m.content.includes('"priceStatus":"stale"'))).toBe(true);
  const html = renderToStaticMarkup(createElement(FinancialReviewResult, { review: result.value }));
  expect(html).toContain('holdings with price status'); expect(html).toContain('stale'); expect(html).toContain('1200.0000');
});
