import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isOverviewEmpty } from '@app/(app)/_overview';
import { listAccounts, listInstruments, netWorthReconciliation } from '@/server/services';
import { closeHarness, truncateAll } from './harness';
import { closeMoneyHarness, must, refreshCtx, setupMoneyFixture, type MoneyFixture } from './money-harness';
import { makeAsset, makeLiability } from './networth-harness';

/**
 * The Overview's empty state must not hide records that reach net worth without
 * an active account or instrument (found in review of PR #68).
 */
let fixture: MoneyFixture;

async function empty(): Promise<boolean> {
  const ctx = await refreshCtx(fixture);
  const { result } = must(await netWorthReconciliation(ctx));
  return isOverviewEmpty(result.contributions.length, result.excluded.length);
}

beforeAll(async () => {
  await truncateAll();
  fixture = await setupMoneyFixture({ now: new Date('2026-11-11T12:00:00+05:30') });
});

afterAll(async () => {
  await closeMoneyHarness();
  await closeHarness();
});

describe('Overview — empty state against real net-worth sources', () => {
  it('is empty for a user with nothing recorded', async () => {
    expect(await empty()).toBe(true);
  });

  it('is not empty with only a liability, though no account or instrument exists', async () => {
    await makeLiability(fixture.ctx, { name: 'Home loan', openingBalance: '2500000', openingBalanceOn: '2026-11-01' });
    const ctx = await refreshCtx(fixture);
    expect(await listAccounts(ctx)).toHaveLength(0);
    expect(await listInstruments(ctx)).toHaveLength(0);
    expect(await empty()).toBe(false);
  });

  it('is not empty with only a manual asset', async () => {
    await truncateAll();
    fixture = await setupMoneyFixture({ now: new Date('2026-11-11T12:00:00+05:30') });
    await makeAsset(fixture.ctx, { name: 'Flat', kind: 'property', value: '9000000', valuedOn: '2026-11-01' });
    expect(await empty()).toBe(false);
  });
});
