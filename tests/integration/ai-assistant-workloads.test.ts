import { afterAll, beforeAll, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AssistantAnswer } from '@app/(app)/ai/answer';
import { aiCapabilityFor } from '@/server/ai-runtime';
import { answerReadOnlyQuestion } from '@/server/ai/assistant/question';
import { auditLog, investmentTransactions, transactions } from '@/server/db/schema';
import { fakeQuestionProvider } from '../helpers/fake-question-provider';
import { closeHarness, database, truncateAll } from './harness';
import { categoryId, closeMoneyHarness, makeAccount, must, record, setupMoneyFixture, transfer, type MoneyFixture } from './money-harness';
import { makeInstrument, priceIt, recordBuy } from './investment-harness';

// Scripted calls exercise the real dispatcher/engine/rendering boundary. They
// do not measure a model's intent recognition, arithmetic or prose quality.
const NOW = new Date('2026-08-30T12:00:00Z');
let alice: MoneyFixture;
let bob: MoneyFixture;
const ledgerSnapshot = async () => ({
  money: await database().select().from(transactions).orderBy(transactions.id),
  investments: await database().select().from(investmentTransactions).orderBy(investmentTransactions.id),
  audit: await database().select().from(auditLog).orderBy(auditLog.id),
});
let before: Awaited<ReturnType<typeof ledgerSnapshot>>;
beforeAll(async () => {
  await truncateAll();
  alice = await setupMoneyFixture({ now: NOW });
  bob = await setupMoneyFixture({ now: NOW });
  const bank = await makeAccount(alice.ctx, { name: 'Workload bank', openingBalance: '10000', openingDate: '2026-07-01' });
  const cash = await makeAccount(alice.ctx, { name: 'Workload cash', kind: 'cash', openingDate: '2026-07-01' });
  const broker = await makeAccount(alice.ctx, { name: 'Workload broker', kind: 'brokerage', openingBalance: '2000', openingDate: '2026-07-01' });
  const salary = await categoryId(alice.ctx, 'Salary');
  const groceries = await categoryId(alice.ctx, 'Groceries');
  const rent = await categoryId(alice.ctx, 'Rent');
  for (const [bookedOn, amount] of [['2026-07-01', '5000'], ['2026-08-01', '6000']] as const) {
    await record(alice.ctx, { kind: 'income', accountId: bank, categoryId: salary, amount, bookedOn });
  }
  for (const [bookedOn, amount, category] of [
    ['2026-07-10', '1000.25', groceries], ['2026-07-31', '500.25', groceries],
    ['2026-08-02', '2000', rent], ['2026-08-10', '300', groceries],
    ['2026-08-20', '100', groceries], ['2026-08-24', '50', groceries],
  ] as const) await record(alice.ctx, { kind: 'expense', accountId: bank, categoryId: category, amount, bookedOn });
  await transfer(alice.ctx, { fromAccountId: bank, toAccountId: cash, amount: '999', bookedOn: '2026-08-15' });
  const priced = await makeInstrument(alice.ctx, { symbol: 'WORK', name: 'Priced workload holding' });
  const unpriced = await makeInstrument(alice.ctx, { symbol: 'MISSING', name: 'Unpriced workload holding' });
  must(await recordBuy(alice.ctx, { accountId: broker, instrumentId: priced, on: '2026-08-01', qty: '10', price: '100' }));
  must(await recordBuy(alice.ctx, { accountId: broker, instrumentId: unpriced, on: '2026-08-01', qty: '1', price: '50' }));
  await priceIt(alice.ctx, priced, '110', '2026-08-28T12:00:00Z');
  const privateAccount = await makeAccount(bob.ctx, { name: 'Other owner private workload bank', openingBalance: '88888.88' });
  await record(bob.ctx, { kind: 'expense', accountId: privateAccount, categoryId: await categoryId(bob.ctx, 'Groceries'), amount: '8888.88', bookedOn: '2026-08-10' });
  before = await ledgerSnapshot();
}, 120000);
afterAll(async () => { await closeMoneyHarness(); await closeHarness(); });

interface Workload {
  question: string;
  tool: string;
  args: Record<string, unknown>;
  expected: object;
  visible: readonly string[];
  partial?: boolean;
}
const cases: readonly Workload[] = [
  { question: 'How much did I spend last month?', tool: 'get_expense_summary', args: { asOf: '2026-07-31' },
    expected: { data: { total: { amount: '1500.5000' }, additivity: 'partition' }, meta: { from: '2026-07-01', to: '2026-07-31' } }, visible: ['1500.5000', '2026-07-31'] },
  { question: 'Where did most of my money go this month?', tool: 'get_expense_summary', args: { asOf: '2026-08-30', groupBy: 'category' },
    expected: { data: { total: { amount: '2450.0000' }, additivity: 'partition', rows: expect.arrayContaining([expect.objectContaining({ label: 'Housing', amount: { kind: 'money', amount: '2000.0000', currency: 'INR', scale: 4 } })]) } }, visible: ['2450.0000', '2000.0000'] },
  { question: 'What were my three biggest expenses?', tool: 'get_transactions', args: { from: '2026-08-01', to: '2026-08-30', limit: 3 },
    expected: { data: { transactions: [{ amount: { amount: '50.0000' } }, { amount: { amount: '100.0000' } }, { amount: { amount: '999.0000' } }] }, meta: { rowCount: 3, totalMatching: 6, truncated: true } }, visible: ['partial results', 'Some rows were omitted', 'rankings based on these rows may be incomplete'], partial: true },
  { question: 'Compare my spending with last month.', tool: 'compare_periods', args: { asOf: '2026-08-30' },
    expected: { data: { current: { expenses: { amount: '2450.0000' } }, previous: { expenses: { amount: '1500.5000' } }, expenseDelta: { amount: '949.5000' } } }, visible: ['949.5000', '1500.5000'] },
  { question: 'What is my savings rate?', tool: 'get_cashflow_summary', args: { asOf: '2026-08-30' },
    expected: { data: { income: { amount: '6000.0000' }, expenses: { amount: '2450.0000' }, savings: { amount: '3550.0000' }, savingsRate: { value: { value: '0.5916666667' }, unavailableReason: null } } }, visible: ['3550.0000', '0.5916666667'] },
  { question: 'What was my savings rate before I had any recorded income?', tool: 'get_cashflow_summary', args: { asOf: '2026-06-30' },
    expected: { data: { income: { amount: '0.0000' }, savingsRate: { value: null, unavailableReason: 'divide_by_zero' } } }, visible: ['Unavailable: divide by zero', '0.0000'] },
  { question: 'What cash do I have?', tool: 'get_accounts', args: { asOf: '2026-08-30' },
    expected: { data: { accounts: expect.arrayContaining([expect.objectContaining({ name: 'Workload cash', balance: { kind: 'money', amount: '999.0000', currency: 'INR', scale: 4 } })]) } }, visible: ['Workload bank', '999.0000', '16050.5000'] },
  { question: 'What is my current net worth at cost?', tool: 'get_net_worth', args: { asOf: '2026-08-30', basis: 'cost' },
    expected: { data: { basis: 'cost', netWorth: { amount: '19049.5000' } } }, visible: ['cost', '19049.5000'] },
  { question: 'How has my net worth grown since July?', tool: 'get_net_worth_history', args: { dates: ['2026-07-31', '2026-08-30'] },
    expected: { data: { points: [{ asOf: '2026-07-31', netWorth: { amount: '15499.5000' }, basis: 'cost' }, { asOf: '2026-08-30', netWorth: { amount: '19049.5000' }, basis: 'cost' }] } }, visible: ['15499.5000', '19049.5000'] },
  { question: 'How is my portfolio performing?', tool: 'get_portfolio_summary', args: {},
    expected: { data: { investedCapital: { amount: '1050.0000' }, marketValue: { amount: '1100.0000' }, twr: { value: null, unavailableReason: 'insufficient_price_history' } } }, visible: ['1050.0000', '1100.0000', 'Unavailable: insufficient price history'] },
  { question: 'What are my largest holdings?', tool: 'get_holdings', args: {},
    expected: { data: { unpricedCount: 1, holdings: expect.arrayContaining([expect.objectContaining({ name: 'Unpriced workload holding', marketValue: null })]) } }, visible: ['Priced workload holding', 'Unpriced workload holding', 'Unavailable', '1100.0000'] },
  { question: 'How concentrated is my portfolio?', tool: 'get_asset_allocation', args: { dimension: 'instrument' },
    expected: { data: { dimension: 'instrument', total: { amount: '1100.0000' }, additivity: 'partition', unpricedCount: 1 } }, visible: ['1100.0000', 'partition', 'unpriced Count'] },
];

it.each(cases)('preserves real financial evidence for "$question"', async workload => {
  const call = { id: 'workload-read', name: workload.tool, argumentsJson: JSON.stringify(workload.args) };
  const fake = fakeQuestionProvider([{ toolCalls: [call], finishReason: 'tool_calls' }, { content: 'Check the financial source results. Missing information remains unavailable.' }]);
  const result = await answerReadOnlyQuestion(aiCapabilityFor(alice.ctx), fake.orchestrator, workload.question);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.sources).toHaveLength(1);
  const source = result.value.sources[0]!;
  expect(source.failed).toBe(false);
  expect(source.result).toMatchObject({ ok: true, ...workload.expected });
  expect(fake.requests).toHaveLength(2);
  expect(fake.requests[1]?.messages.at(-1)).toEqual({ role: 'tool', toolCallId: call.id, content: JSON.stringify(source.result) });
  const html = renderToStaticMarkup(createElement(AssistantAnswer, { answer: result.value }));
  for (const text of workload.visible) expect(html).toContain(text);
  if (workload.partial) expect(html).not.toContain('2000.0000'); // The largest expense is outside these three recent rows.
  else expect(html).not.toContain('— partial results');
  const exposed = JSON.stringify({ answer: result.value, requests: fake.requests }) + html;
  expect(exposed).not.toContain('Other owner private workload bank');
  expect(exposed).not.toContain('88888.8800');
  expect(exposed).not.toContain('8888.8800');
  expect(exposed).not.toContain(bob.userId);
});
it('leaves the complete financial ledgers and audit history unchanged across the workload corpus', async () => {
  expect(await ledgerSnapshot()).toEqual(before);
});
