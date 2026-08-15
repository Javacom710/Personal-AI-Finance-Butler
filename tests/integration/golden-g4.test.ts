import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/date';
import { toDbString } from '@/lib/decimal/money';
import {
  netWorthAsOf,
  netWorthChange,
  netWorthReconciliation,
  setAccountActive,
} from '@/server/services';
import { bridgeCloses } from '@/server/domain/networth/bridge';
import { closeHarness, truncateAll } from './harness';
import {
  categoryId,
  closeMoneyHarness,
  makeAccount,
  must,
  record,
  refreshCtx,
  setupMoneyFixture,
  transfer,
  truncateMoney,
  write,
  type MoneyFixture,
} from './money-harness';
import {
  closeIt,
  closeNetWorthHarness,
  makeAsset,
  makeLiability,
  recordBalance,
  revalue,
  truncateNetWorth,
} from './networth-harness';

/**
 * **Golden scenario G4 — Debt and liabilities** (TESTING.md §5).
 *
 * A home loan with EMIs, a credit card carrying a balance, and a car loan closed
 * mid-period. Every figure below was computed by hand once and frozen in
 * `tests/golden/g4-debt-and-liabilities.expected.json`.
 *
 * The assertion that earns the scenario its place is `unexplained === 0`,
 * **exactly**: this is single-currency data, so every FX term is identically
 * zero and a tolerance would only hide a real residual (I-30). The specific
 * error it is built to catch is the credit card being counted twice — once as
 * spending through its account and once as debt through its `liabilities` row.
 */

const EXPECTED = JSON.parse(
  readFileSync(join(__dirname, '..', 'golden', 'g4-debt-and-liabilities.expected.json'), 'utf8'),
) as {
  opening: Record<string, string>;
  afterSetup: Record<string, string>;
  aprilEnd: Record<string, string>;
  juneEnd: Record<string, string>;
  bridgeJanToJun: Record<string, string>;
};

const D = (s: string) => isoDate(s);

let fixture: MoneyFixture;
let bank: string;
let card: string;
let homeLoan: string;
let carLoan: string;
let flat: string;

beforeAll(async () => {
  await truncateAll();
  fixture = await setupMoneyFixture({ now: new Date('2026-08-10T12:00:00Z') });
  await truncateNetWorth();
  await truncateMoney();

  const salary = await categoryId(fixture.ctx, 'Salary');
  const food = await categoryId(fixture.ctx, 'Food');
  const fees = await categoryId(fixture.ctx, 'Fees & Charges');

  // ---- setup, all dated 2026-01-01
  bank = await makeAccount(fixture.ctx, {
    name: 'Salary account',
    openingBalance: '1200000',
    openingDate: '2026-01-01',
  });
  card = await makeAccount(fixture.ctx, {
    name: 'HDFC card',
    kind: 'credit_card',
    creditLimit: '200000',
    openingBalance: '0',
    openingDate: '2026-01-01',
  });
  flat = await makeAsset(fixture.ctx, {
    name: 'Flat',
    kind: 'property',
    value: '8000000',
    valuedOn: '2026-01-01',
    acquiredOn: '2026-01-01',
  });
  homeLoan = await makeLiability(fixture.ctx, {
    name: 'Home loan',
    kind: 'home_loan',
    openingBalance: '2500000',
    openingBalanceOn: '2026-01-01',
    interestRate: '0.0850',
    emiAmount: '52000',
    startedOn: '2026-01-01',
  });
  carLoan = await makeLiability(fixture.ctx, {
    name: 'Car loan',
    kind: 'auto_loan',
    openingBalance: '600000',
    openingBalanceOn: '2026-01-01',
    emiAmount: '18000',
  });
  // The card is TRANSACTED: linked to its account, carrying no balance of its
  // own. This is the row that must contribute nothing (I-8).
  await makeLiability(fixture.ctx, {
    name: 'HDFC card debt',
    kind: 'credit_card',
    linkedAccountId: card,
  });

  // ---- January to June
  const months = ['01', '02', '03', '04', '05', '06'];
  let homeOutstanding = 2_500_000;
  let carOutstanding = 600_000;

  for (const month of months) {
    await record(fixture.ctx, {
      kind: 'income',
      accountId: bank,
      categoryId: salary,
      amount: '150000',
      bookedOn: `2026-${month}-05`,
    });
    await record(fixture.ctx, {
      kind: 'expense',
      accountId: bank,
      categoryId: food,
      amount: '60000',
      bookedOn: `2026-${month}-10`,
    });

    // Home-loan EMI: 52,000 leaves the bank, 40,000 of it is principal.
    await record(fixture.ctx, {
      kind: 'expense',
      accountId: bank,
      categoryId: fees,
      amount: '52000',
      bookedOn: `2026-${month}-15`,
    });
    homeOutstanding -= 40_000;
    await recordBalance(fixture.ctx, homeLoan, `2026-${month}-15`, String(homeOutstanding));

    // Car-loan EMI, February to April only.
    if (['02', '03', '04'].includes(month)) {
      await record(fixture.ctx, {
        kind: 'expense',
        accountId: bank,
        categoryId: fees,
        amount: '18000',
        bookedOn: `2026-${month}-20`,
      });
      carOutstanding -= 15_000;
      await recordBalance(fixture.ctx, carLoan, `2026-${month}-20`, String(carOutstanding));
    }
  }

  // April: 45,000 spent on the card.
  await record(fixture.ctx, {
    kind: 'expense',
    accountId: card,
    categoryId: food,
    amount: '45000',
    bookedOn: '2026-04-12',
  });

  // 15 May: the car loan is settled in full and closed. `closeLiability` writes
  // the terminal zero balance row — without it a date-driven rule would keep
  // 555,000 in force forever (I-28).
  await record(fixture.ctx, {
    kind: 'expense',
    accountId: bank,
    categoryId: fees,
    amount: '555000',
    bookedOn: '2026-05-15',
  });
  await closeIt(fixture.ctx, carLoan, '2026-05-15');

  // 1 June: the flat is revalued.
  await revalue(fixture.ctx, flat, '2026-06-01', '8600000');

  // 20 June: the card is repaid in full — a transfer, not an expense.
  await transfer(fixture.ctx, {
    fromAccountId: bank,
    toAccountId: card,
    amount: '45000',
    bookedOn: '2026-06-20',
  });
});

afterAll(async () => {
  await closeNetWorthHarness();
  await closeMoneyHarness();
  await closeHarness();
});

async function at(asOf: string) {
  const ctx = await refreshCtx(fixture);
  return must(await netWorthAsOf(ctx, { asOf: D(asOf) }));
}

function contribution(result: Awaited<ReturnType<typeof at>>, label: string) {
  return result.contributions.find((c) => c.label === label);
}

describe('G4 — Debt and liabilities', () => {
  it('is zero before anything exists — N2, the opening-balance gate', async () => {
    const result = await at('2025-12-31');
    expect(toDbString(result.assets)).toBe(EXPECTED.opening['assets']);
    expect(toDbString(result.liabilities)).toBe(EXPECTED.opening['liabilities']);
    expect(toDbString(result.netWorth)).toBe(EXPECTED.opening['netWorth']);
    // Absent, not present at zero.
    expect(result.contributions).toHaveLength(0);
  });

  it('matches the hand-computed figure on the day everything opens', async () => {
    const result = await at('2026-01-01');
    expect(toDbString(result.assets)).toBe(EXPECTED.afterSetup['assets']);
    expect(toDbString(result.liabilities)).toBe(EXPECTED.afterSetup['liabilities']);
    expect(toDbString(result.netWorth)).toBe(EXPECTED.afterSetup['netWorth']);
  });

  it('matches the hand-computed figure at April month-end', async () => {
    const result = await at('2026-04-30');
    expect(toDbString(contribution(result, 'Salary account')!.base)).toBe(EXPECTED.aprilEnd['cash']);
    expect(toDbString(contribution(result, 'HDFC card')!.base)).toBe(
      `-${EXPECTED.aprilEnd['cardDebt']}`,
    );
    expect(toDbString(contribution(result, 'Home loan')!.base)).toBe(
      `-${EXPECTED.aprilEnd['homeLoanOutstanding']}`,
    );
    expect(toDbString(contribution(result, 'Car loan')!.base)).toBe(
      `-${EXPECTED.aprilEnd['carLoanOutstanding']}`,
    );
    expect(toDbString(contribution(result, 'Flat')!.base)).toBe(EXPECTED.aprilEnd['flat']);

    expect(toDbString(result.assets)).toBe(EXPECTED.aprilEnd['assets']);
    expect(toDbString(result.liabilities)).toBe(EXPECTED.aprilEnd['liabilities']);
    expect(toDbString(result.netWorth)).toBe(EXPECTED.aprilEnd['netWorth']);
  });

  it('matches the hand-computed figure at June month-end', async () => {
    const result = await at('2026-06-30');
    expect(toDbString(contribution(result, 'Salary account')!.base)).toBe(EXPECTED.juneEnd['cash']);
    expect(toDbString(contribution(result, 'Flat')!.base)).toBe(EXPECTED.juneEnd['flat']);
    expect(toDbString(contribution(result, 'Home loan')!.base)).toBe(
      `-${EXPECTED.juneEnd['homeLoanOutstanding']}`,
    );

    expect(toDbString(result.assets)).toBe(EXPECTED.juneEnd['assets']);
    expect(toDbString(result.liabilities)).toBe(EXPECTED.juneEnd['liabilities']);
    expect(toDbString(result.netWorth)).toBe(EXPECTED.juneEnd['netWorth']);
  });

  it('counts the credit card exactly once — I-8', async () => {
    const result = await at('2026-04-30');

    // The account carries the debt.
    const account = contribution(result, 'HDFC card')!;
    expect(account.side).toBe('liability');
    expect(toDbString(account.base)).toBe('-45000.0000');

    // The liabilities row carries none of it, and is absent from the breakdown.
    expect(contribution(result, 'HDFC card debt')).toBeUndefined();
    expect(result.contributions.filter((c) => c.key.t === 'liability')).toHaveLength(2);
  });

  it('stops counting the car loan from its terminal zero row — I-28', async () => {
    const before = await at('2026-05-14');
    expect(toDbString(contribution(before, 'Car loan')!.base)).toBe('-555000.0000');

    const after = await at('2026-05-15');
    expect(contribution(after, 'Car loan')!.side).toBe('none');
    expect(toDbString(contribution(after, 'Car loan')!.base)).toBe('0.0000');
  });

  it('treats a settled card as contributing to neither side — I-31', async () => {
    const result = await at('2026-06-30');
    expect(contribution(result, 'HDFC card')!.side).toBe('none');
  });

  it('keeps a closed account in every historical figure — I-26', async () => {
    // Closing the card today must not change what April looked like.
    const aprilBefore = await at('2026-04-30');
    must(await write(fixture.ctx, (w) => setAccountActive(w, card, false)));
    const aprilAfter = await at('2026-04-30');

    expect(toDbString(aprilAfter.netWorth)).toBe(toDbString(aprilBefore.netWorth));

    // Restore, so the remaining assertions see the fixture as built.
    must(await write(fixture.ctx, (w) => setAccountActive(w, card, true)));
  });

  it('reconciles by an independent path at every date — I-22', async () => {
    const ctx = await refreshCtx(fixture);
    for (const date of ['2026-01-01', '2026-04-30', '2026-05-15', '2026-06-30']) {
      const { reconciliation } = must(await netWorthReconciliation(ctx, { asOf: D(date) }));
      expect(reconciliation.balances, `reconciliation failed at ${date}`).toBe(true);
      expect(toDbString(reconciliation.residual)).toBe('0.0000');
    }
  });

  it('closes the change bridge with EXACTLY zero unexplained — I-30', async () => {
    const ctx = await refreshCtx(fixture);
    const b = must(await netWorthChange(ctx, D('2026-01-01'), D('2026-06-30')));

    expect(toDbString(b.delta)).toBe(EXPECTED.bridgeJanToJun['delta']);
    expect(toDbString(b.lines.find((l) => l.key === 'savings')!.amount)).toBe(
      EXPECTED.bridgeJanToJun['savings'],
    );
    expect(toDbString(b.lines.find((l) => l.key === 'asset_revaluation')!.amount)).toBe(
      EXPECTED.bridgeJanToJun['assetRevaluation'],
    );
    expect(toDbString(b.lines.find((l) => l.key === 'liability_change')!.amount)).toBe(
      EXPECTED.bridgeJanToJun['liabilityChange'],
    );

    expect(b.singleCurrency).toBe(true);
    expect(toDbString(b.unexplained)).toBe(EXPECTED.bridgeJanToJun['unexplained']);
    expect(bridgeCloses(b)).toBe(true);
  });

  it('reports the unrealised gain as not measured, never as zero', async () => {
    const ctx = await refreshCtx(fixture);
    const b = must(await netWorthChange(ctx, D('2026-01-01'), D('2026-06-30')));
    const line = b.lines.find((l) => l.key === 'unrealized_gain')!;
    expect(line.notMeasured).toBe(true);
    expect(toDbString(line.amount)).toBe(EXPECTED.bridgeJanToJun['unrealizedGain']);
  });
});
