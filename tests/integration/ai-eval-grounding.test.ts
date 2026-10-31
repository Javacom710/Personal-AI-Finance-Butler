import { promises as fs } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBudget } from '@/server/services';
import { aiCapabilityFor } from '@/server/ai-runtime';
import { dispatchToolCall } from '@/server/ai/tools/dispatch';
import {
  GROUNDING_CALLS,
  GROUNDING_TODAY,
  type GroundingCallKey,
} from '@/server/ai/eval/tasks/grounding-calls';
import { closeHarness, truncateAll } from './harness';
import { makeInstrument, priceIt, recordBuy, recordDividend, recordSell } from './investment-harness';
import {
  categoryId,
  closeMoneyHarness,
  makeAccount,
  must,
  rawSql,
  record,
  setupMoneyFixture,
  transfer,
  write,
  type MoneyFixture,
} from './money-harness';
import { closeNetWorthHarness, makeAsset, makeLiability, recordBalance } from './networth-harness';

/**
 * The `grounding` suite's tool results are the engine's output
 * ([AI-SYSTEM.md §14](../../docs/AI-SYSTEM.md)).
 *
 * The suite scores a model's answer against figures frozen in
 * `src/server/ai/eval/tasks/grounding-results.json`. That only measures
 * grounding if those figures are what production would have sent. So this test
 * builds the fixture through the application services, runs every call the
 * suite replays through the production dispatcher, and requires the result to
 * equal the frozen one exactly.
 *
 * Database ids differ on every run, so each is replaced by a fixed placeholder
 * id chosen from the entity's name. Any id left unnamed fails the test rather
 * than being frozen.
 *
 * To regenerate after a deliberate engine or fixture change:
 * `UPDATE_GROUNDING_RESULTS=1 npx vitest run --project integration tests/integration/ai-eval-grounding.test.ts`,
 * then review the diff and bump `GROUNDING_SUITE_VERSION`.
 */

const RESULTS_PATH = path.resolve('src/server/ai/eval/tasks/grounding-results.json');
const UPDATE = process.env['UPDATE_GROUNDING_RESULTS'] === '1';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

let fixture: MoneyFixture;
const names = new Map<string, string>();

async function buildFixture(): Promise<void> {
  const ctx = fixture.ctx;

  const savings = await makeAccount(ctx, { name: 'HDFC Savings', openingBalance: '150000', openingDate: '2026-01-01' });
  const card = await makeAccount(ctx, {
    name: 'HDFC Credit Card',
    kind: 'credit_card',
    creditLimit: '200000',
    openingBalance: '0',
    openingDate: '2026-01-01',
  });
  const cash = await makeAccount(ctx, { name: 'Cash', kind: 'cash', openingBalance: '3000', openingDate: '2026-01-01' });
  const zerodha = await makeAccount(ctx, {
    name: 'Zerodha',
    kind: 'brokerage',
    openingBalance: '200000',
    openingDate: '2026-01-01',
  });

  const cat = async (name: string) => categoryId(ctx, name);
  const [salary, interest, food, groceries, dining, rent, fuel, cabs, utilities, shopping] = await Promise.all(
    ['Salary', 'Interest', 'Food', 'Groceries', 'Dining', 'Rent', 'Fuel', 'Cabs', 'Utilities', 'Shopping'].map(cat),
  ) as [string, string, string, string, string, string, string, string, string, string];

  type Entry = [kind: 'income' | 'expense', account: string, category: string, amount: string, on: string, description: string, tags?: string[]];
  const entries: Entry[] = [
    // August — the month compare_periods sets September against is not needed,
    // but it gives the net-worth history a month of ordinary activity.
    ['income', savings, salary, '120000', '2026-08-01', 'Salary August'],
    ['expense', savings, rent, '25000', '2026-08-05', 'Rent August'],
    ['expense', card, groceries, '3900', '2026-08-09', 'BigBasket'],
    ['expense', card, dining, '2100', '2026-08-14', 'Dinner'],
    ['expense', card, fuel, '2600', '2026-08-20', 'Petrol'],
    ['expense', savings, utilities, '1850', '2026-08-22', 'Electricity'],

    // September — "last month". Food is a parent with spending of its own
    // (₹800) as well as through Groceries (₹4,230.50) and Dining (₹3,610), so
    // a detail breakdown has three Food rows and the rollup has one.
    ['income', savings, salary, '120000', '2026-09-01', 'Salary September'],
    ['expense', savings, rent, '25000', '2026-09-05', 'Rent September'],
    ['expense', card, groceries, '2980.50', '2026-09-06', 'BigBasket'],
    ['expense', savings, utilities, '1940', '2026-09-10', 'Electricity'],
    ['expense', card, dining, '1250', '2026-09-12', 'Dinner at Toit'],
    ['expense', cash, food, '800', '2026-09-15', 'Office snacks'],
    ['expense', card, fuel, '2500', '2026-09-18', 'Petrol for Goa drive', ['goa-trip']],
    ['expense', cash, groceries, '1250', '2026-09-20', 'Vegetables'],
    ['expense', card, shopping, '6499', '2026-09-22', 'Headphones', ['reimbursable']],
    ['expense', card, cabs, '740', '2026-09-26', 'Cab to Goa airport', ['goa-trip']],
    ['expense', card, dining, '2360', '2026-09-27', 'Client dinner in Goa', ['goa-trip', 'reimbursable']],
    ['income', savings, interest, '812.37', '2026-09-30', 'Savings interest'],

    // October, to the 15th.
    ['income', savings, salary, '120000', '2026-10-01', 'Salary October'],
    ['expense', savings, rent, '25000', '2026-10-05', 'Rent October'],
    ['expense', card, groceries, '1890', '2026-10-08', 'BigBasket'],
    ['expense', card, dining, '3150', '2026-10-11', 'Birthday dinner'],
  ];
  for (const [kind, accountId, categoryIdValue, amount, bookedOn, description, tags] of entries) {
    await record(ctx, { kind, accountId, categoryId: categoryIdValue, amount, bookedOn, description, tags: tags ?? [] });
  }

  // Transfers move money between the user's own accounts: neither spending nor income.
  await transfer(ctx, { fromAccountId: savings, toAccountId: cash, amount: '5000', bookedOn: '2026-09-03', description: 'ATM withdrawal' });
  await transfer(ctx, { fromAccountId: savings, toAccountId: card, amount: '15000', bookedOn: '2026-09-28', description: 'Card bill payment' });

  for (const [category, amount] of [[food, '10000'], [dining, '2500']] as const) {
    must(
      await write(ctx, (w) =>
        createBudget(w, { categoryId: category, period: 'monthly', amount, currencyCode: 'INR', startsOn: '2026-01-01' }),
      ),
    );
  }

  // Net worth outside the ledger.
  await makeAsset(ctx, {
    name: 'Apartment',
    kind: 'property',
    value: '9500000',
    valuedOn: '2026-03-31',
    acquiredOn: '2021-06-15',
    acquisitionCost: '7800000',
  });
  await makeAsset(ctx, {
    name: 'Gold coins',
    kind: 'gold_physical',
    value: '410000',
    valuedOn: '2026-09-30',
    acquiredOn: '2022-11-01',
    acquisitionCost: '285000',
  });
  const homeLoan = await makeLiability(ctx, {
    name: 'Home loan',
    kind: 'home_loan',
    openingBalance: '2450000',
    openingBalanceOn: '2026-01-01',
    interestRate: '0.085',
    emiAmount: '24500',
    startedOn: '2021-06-15',
  });
  await recordBalance(ctx, homeLoan, '2026-09-30', '2412345.67');

  // The portfolio: one priced, one priced a while ago, one never priced.
  const infy = await makeInstrument(ctx, { symbol: 'INFY', name: 'Infosys' });
  const niftybees = await makeInstrument(ctx, { symbol: 'NIFTYBEES', name: 'Nippon India Nifty 50 BeES', assetClass: 'etf' });
  const hdfcbank = await makeInstrument(ctx, { symbol: 'HDFCBANK', name: 'HDFC Bank' });
  must(await recordBuy(ctx, { accountId: zerodha, instrumentId: infy, on: '2026-02-10', qty: '50', price: '1400', fees: '20' }));
  must(await recordBuy(ctx, { accountId: zerodha, instrumentId: niftybees, on: '2026-03-05', qty: '200', price: '260' }));
  must(await recordBuy(ctx, { accountId: zerodha, instrumentId: hdfcbank, on: '2026-04-15', qty: '25', price: '1600' }));
  must(await recordBuy(ctx, { accountId: zerodha, instrumentId: infy, on: '2026-05-12', qty: '30', price: '1500' }));
  must(await recordDividend(ctx, { accountId: zerodha, instrumentId: infy, on: '2026-06-01', gross: '1700' }));
  must(await recordSell(ctx, { accountId: zerodha, instrumentId: infy, on: '2026-07-20', qty: '20', price: '1650' }));
  await priceIt(ctx, infy, '1520', '2026-10-15T04:00:00Z');
  await priceIt(ctx, niftybees, '284.50', '2026-10-01T10:00:00Z');

  for (const [id, name] of [
    [savings, 'account:HDFC Savings'],
    [card, 'account:HDFC Credit Card'],
    [cash, 'account:Cash'],
    [zerodha, 'account:Zerodha'],
    [infy, 'instrument:INFY'],
    [niftybees, 'instrument:NIFTYBEES'],
    [hdfcbank, 'instrument:HDFCBANK'],
  ] as const) {
    names.set(id, name);
  }
}

/** Every other id the results can carry, named from the database. */
async function nameRemainingIds(): Promise<void> {
  const queries: [string, string][] = [
    ['category', `select c.id, coalesce(p.name || ' > ', '') || c.name as name from categories c left join categories p on p.id = c.parent_id where c.user_id = $1`],
    ['tag', 'select id, name from tags where user_id = $1'],
    ['asset', 'select id, name from manual_assets where user_id = $1'],
    ['liability', 'select id, name from liabilities where user_id = $1'],
    ['budget', `select b.id, c.name from budgets b join categories c on c.id = b.category_id where b.user_id = $1`],
  ];
  for (const [kind, text] of queries) {
    const { rows } = await rawSql(text, [fixture.userId]);
    for (const row of rows as { id: string; name: string }[]) names.set(row.id, `${kind}:${row.name}`);
  }
}

/**
 * Replace each database id with a fixed one. The placeholder is derived from the
 * sorted list of every named entity, so it is the same on every run.
 */
function placeholders(): Map<string, string> {
  const labels = [...new Set(names.values())].sort();
  const byLabel = new Map(labels.map((label, i) => [label, `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`]));
  return new Map([...names].map(([id, label]) => [id, byLabel.get(label)!]));
}

function normalise(result: unknown, ids: Map<string, string>): unknown {
  const text = JSON.stringify(result).replace(UUID, (id) => {
    const replacement = ids.get(id);
    if (!replacement) throw new Error(`A result carries an id the fixture did not name: ${id}`);
    return replacement;
  });
  return JSON.parse(text);
}

let actual: Record<GroundingCallKey, unknown>;

beforeAll(async () => {
  await truncateAll();
  fixture = await setupMoneyFixture({ now: new Date(`${GROUNDING_TODAY}T12:00:00+05:30`) });
  await buildFixture();
  await nameRemainingIds();

  const ai = aiCapabilityFor(fixture.ctx);
  const ids = placeholders();
  const entries: [GroundingCallKey, unknown][] = [];
  for (const [key, call] of Object.entries(GROUNDING_CALLS) as [GroundingCallKey, (typeof GROUNDING_CALLS)[GroundingCallKey]][]) {
    const outcome = await dispatchToolCall(ai, { id: key, name: call.tool, argumentsJson: JSON.stringify(call.args) });
    if (outcome.failed) throw new Error(`${key} failed: ${JSON.stringify(outcome.result)}`);
    entries.push([key, normalise(outcome.result, ids)]);
  }
  actual = Object.fromEntries(entries) as Record<GroundingCallKey, unknown>;

  if (UPDATE) await fs.writeFile(RESULTS_PATH, `${JSON.stringify(actual, null, 2)}\n`, 'utf8');
}, 180_000);

afterAll(async () => {
  await closeNetWorthHarness();
  await closeMoneyHarness();
  await closeHarness();
});

describe('grounding fixture — the frozen tool results are the engine output', () => {
  it('has a frozen result for every call, and nothing else', async () => {
    const frozen = JSON.parse(await fs.readFile(RESULTS_PATH, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(frozen).sort()).toEqual(Object.keys(GROUNDING_CALLS).sort());
  });

  it.each(Object.keys(GROUNDING_CALLS) as GroundingCallKey[])('%s matches the production handler exactly', async (key) => {
    const frozen = JSON.parse(await fs.readFile(RESULTS_PATH, 'utf8')) as Record<string, unknown>;
    expect(actual[key]).toEqual(frozen[key]);
  });
});
