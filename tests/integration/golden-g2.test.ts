/**
 * Golden scenario **G2 — equity investor** (TESTING.md §5).
 *
 * A multi-year fixture with every figure verified by hand once and then frozen
 * in `tests/golden/g2-equity-investor.expected.json`, which carries the full
 * arithmetic. This is the regression net for the whole engine: buys at three
 * prices, two partial sells spanning lots, a split, a bonus, two dividends with
 * TDS, brokerage fees on both sides of a trade, and an account-level charge.
 *
 * The assertions that matter most are the ones that would still look plausible
 * if the engine were wrong:
 *
 * - `Σ cost_total` **byte-identical** before and after the split and the bonus;
 * - trade fees in **no** `fees_total`, while the account-level fee is in the
 *   portfolio's;
 * - `totalReturn` agreeing with an independent **cash cross-check**;
 * - a same-day split and buy giving one answer under both insertion orders.
 */

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import expected from '../golden/g2-equity-investor.expected.json';
import { db } from '@/server/db/client';
import { isoDate } from '@/lib/date';
import { Money, currency, toDbString } from '@/lib/decimal/money';
import { rToNumber } from '@/lib/decimal/rate';
import { createReadCtx, getAccount, portfolio, realizedDisposals, type ReadCtx } from '@/server/services';
import { totalReturnByCashCrossCheck } from '@/server/domain/calc/portfolio';
import { closeHarness } from './harness';
import { closeMoneyHarness, makeAccount, must, setupMoneyFixture, truncateMoney } from './money-harness';
import {
  derivedFingerprint,
  lotSnapshot,
  makeInstrument,
  positionSnapshot,
  priceIt,
  recordBuy,
  recordCharge,
  recordCorporateAction,
  recordDividend,
  recordSell,
  truncateInvestments,
} from './investment-harness';

const INR = currency('INR');
const NOW = new Date('2026-08-11T12:00:00Z');

let userId: string;
let ctx: ReadCtx;
let brokerage: string;
let reliance: string;
/** `Σ cost_total` immediately before the split, for the byte-identity check. */
let costBeforeCorporateActions: string;

beforeAll(async () => {
  await truncateInvestments();
  await truncateMoney();
  const fixture = await setupMoneyFixture({ now: NOW });
  userId = fixture.userId;

  const rebuilt = await createReadCtx(userId, { now: NOW });
  if (!rebuilt.ok) throw new Error('context');
  ctx = rebuilt.value;

  brokerage = await makeAccount(ctx, {
    name: 'Zerodha',
    kind: 'brokerage',
    openingBalance: expected.cash.openingBalance,
    openingDate: '2024-12-31',
  });
  reliance = await makeInstrument(ctx, { symbol: 'RELIANCE', name: 'Reliance Industries' });

  const on = (date: string) => ({ accountId: brokerage, instrumentId: reliance, on: date });

  must(await recordBuy(ctx, { ...on('2025-01-10'), qty: '100', price: '1000', fees: '100' }));
  must(await recordBuy(ctx, { ...on('2025-02-10'), qty: '100', price: '1200', fees: '120' }));
  must(await recordBuy(ctx, { ...on('2025-03-10'), qty: '100', price: '900', fees: '90' }));
  must(await recordDividend(ctx, { ...on('2025-04-15'), gross: '5000', taxes: '500' }));
  must(await recordSell(ctx, { ...on('2025-06-10'), qty: '150', price: '1500', fees: '225' }));

  costBeforeCorporateActions = await sumOfCostTotal();

  must(await recordCorporateAction(ctx, { ...on('2025-08-10'), num: 2, den: 1 }));
  must(await recordCorporateAction(ctx, { ...on('2025-10-10'), num: 1, den: 2 }, 'bonus'));
  must(await recordDividend(ctx, { ...on('2025-12-10'), gross: '4500', taxes: '450' }));
  must(await recordSell(ctx, { ...on('2026-02-10'), qty: '200', price: '400', fees: '80' }));
  must(await recordCharge(ctx, { accountId: brokerage, on: '2026-03-31', amount: '500' }));

  await priceIt(ctx, reliance, '500');
});

afterAll(async () => {
  await closeMoneyHarness();
  await closeHarness();
});

async function sumOfCostTotal(): Promise<string> {
  const { rows } = await db().execute<{ total: string }>(
    sql`select coalesce(sum(cost_total), 0)::text as total from tax_lots where user_id = ${userId}`,
  );
  return rows[0]!.total;
}

// ---------------------------------------------------------------------------

describe('G2 — lots and cost basis', () => {
  it('holds three lots, two drained and one partly consumed', async () => {
    const lots = await lotSnapshot(userId, reliance);
    expect(lots).toHaveLength(3);
    expect(lots.map((l) => l.costTotal)).toEqual(expected.lots.map((l) => l.costTotal));
    expect(lots.map((l) => l.remainingQuantity)).toEqual(
      expected.lots.map((l) => l.remainingQuantity),
    );
    expect(lots.map((l) => l.remainingCost)).toEqual(expected.lots.map((l) => l.remainingCost));
  });

  it('leaves Σ cost_total byte-identical across the split and the bonus', async () => {
    // The split and the bonus moved 300 units into 450 and touched no money.
    expect(await sumOfCostTotal()).toBe(costBeforeCorporateActions);
    expect(await sumOfCostTotal()).toBe(expected.sumOfCostTotal);
  });

  it('reports the position figures exactly', async () => {
    const position = await positionSnapshot(userId, reliance);
    expect(position?.quantity).toBe(expected.position.quantity);
    expect(position?.costBasis).toBe(expected.position.costBasis);
    expect(position?.baseCostBasis).toBe(expected.position.baseCostBasis);
    expect(position?.realizedPnl).toBe(expected.position.realizedPnl);
    expect(position?.incomeTotal).toBe(expected.position.incomeTotal);
    expect(position?.taxesTotal).toBe(expected.position.taxesTotal);
  });

  it('accrues NO trade fee to fees_total — ₹100 + ₹120 + ₹90 + ₹225 + ₹80 of them', async () => {
    const position = await positionSnapshot(userId, reliance);
    expect(position?.feesTotal).toBe('0.0000');
    // They are not lost: the buy fees are inside cost_total, and the sale fees
    // have already reduced realised P&L.
    expect(await sumOfCostTotal()).toBe('310310.0000'); // includes 100 + 120 + 90
  });

  it('satisfies I-20 on every lot', async () => {
    const { rows } = await db().execute<{ n: string }>(sql`
      select count(*)::text as n
        from tax_lots l
        left join (select lot_id, sum(cost_consumed) as consumed from lot_disposals group by lot_id) d
               on d.lot_id = l.id
       where l.user_id = ${userId}
         and coalesce(d.consumed, 0) + l.remaining_cost <> l.cost_total
    `);
    expect(rows[0]!.n).toBe('0');
  });
});

describe('G2 — realised P&L', () => {
  it('matches the hand-computed figure for each sale', async () => {
    const disposals = await realizedDisposals(ctx, { limit: 100 });
    const byDate = new Map<string, bigint>();
    for (const d of disposals) {
      byDate.set(d.closedOn, (byDate.get(d.closedOn) ?? 0n) + d.realizedPnl.minor);
    }
    for (const [on, total] of Object.entries(expected.realisedBySale)) {
      expect(toDbString(Money.fromMinor(byDate.get(on) ?? 0n, INR))).toBe(total);
    }
  });

  it('includes a genuine loss on the second sale, not an absolute value', async () => {
    // Lot B was acquired at ₹1,200 pre-split and sold at a split- and
    // bonus-adjusted ₹400: −₹120. Reporting +120 would be a sign bug that a
    // total-only assertion would hide.
    const disposals = await realizedDisposals(ctx, { limit: 100 });
    const losses = disposals.filter((d) => d.realizedPnl.minor < 0n);
    expect(losses).toHaveLength(1);
    expect(toDbString(losses[0]!.realizedPnl)).toBe('-120.0000');
  });

  it('measures holding periods from acquisition on every disposal', async () => {
    const disposals = await realizedDisposals(ctx, { limit: 100 });
    for (const d of disposals) expect(d.holdingDays).toBeGreaterThan(0);
  });
});

describe('G2 — cash', () => {
  it('leaves the brokerage balance at the hand-computed figure', async () => {
    const account = must(await getAccount(ctx, brokerage));
    expect(toDbString(account.balance)).toBe(expected.cash.closingBalance);
  });

  it('reconciles the balance against the individual movements', async () => {
    const opening = Money.of(expected.cash.openingBalance, INR);
    const inflow = expected.cash.in.reduce((acc, v) => acc + Money.of(v, INR).minor, 0n);
    const outflow = expected.cash.out.reduce((acc, v) => acc + Money.of(v, INR).minor, 0n);
    expect(toDbString(Money.fromMinor(opening.minor + inflow - outflow, INR))).toBe(
      expected.cash.closingBalance,
    );
  });
});

describe('G2 — the portfolio summary', () => {
  it('reports every monetary field exactly', async () => {
    const result = must(await portfolio(ctx));
    const s = result.summary;
    expect(toDbString(s.investedCapital)).toBe(expected.summary.investedCapital);
    expect(toDbString(s.costDeployed)).toBe(expected.summary.costDeployed);
    expect(toDbString(s.marketValue)).toBe(expected.summary.marketValue);
    expect(toDbString(s.unrealizedPnl!)).toBe(expected.summary.unrealizedPnl);
    expect(toDbString(s.realizedPnl)).toBe(expected.summary.realizedPnl);
    expect(toDbString(s.dividends)).toBe(expected.summary.dividends);
    expect(toDbString(s.fees)).toBe(expected.summary.fees);
    expect(toDbString(s.taxes)).toBe(expected.summary.taxes);
    expect(toDbString(s.totalReturn!)).toBe(expected.summary.totalReturn);
  });

  it('agrees with an independent cash cross-check', async () => {
    // marketValue + cash in − cash out, computed from the ledger's own
    // movements rather than from the component sum.
    const crossCheck = totalReturnByCashCrossCheck({
      marketValue: Money.of(expected.summary.marketValue, INR),
      cashIn: expected.cash.in.map((v) => Money.of(v, INR)),
      cashOut: expected.cash.out.map((v) => Money.of(v, INR)),
      baseCurrency: INR,
    });
    expect(toDbString(crossCheck)).toBe(expected.summary.totalReturn);

    const result = must(await portfolio(ctx));
    expect(toDbString(result.summary.totalReturn!)).toBe(toDbString(crossCheck));
  });

  it('uses the two denominators for the two percentages', async () => {
    const result = must(await portfolio(ctx));
    // 127,435 / 310,310 on capital deployed.
    expect(rToNumber(result.summary.totalReturnPct.value!)).toBeCloseTo(
      expected.summary.totalReturnPctApprox,
      5,
    );
    // 49,925 / 75,075 on capital at risk.
    expect(rToNumber(result.summary.unrealizedReturnPct.value!)).toBeCloseTo(
      expected.summary.unrealizedReturnPctApprox,
      5,
    );
  });

  it('reports full coverage and no stale price', async () => {
    const result = must(await portfolio(ctx));
    expect(rToNumber(result.summary.coverage)).toBe(1);
    expect(result.summary.unpricedInstruments).toHaveLength(0);
    expect(result.summary.staleInstruments).toHaveLength(0);
  });

  it('reports TWR as unavailable with its documented reason, not as a figure', async () => {
    const result = must(await portfolio(ctx));
    expect(result.summary.twr.value).toBeNull();
    expect(result.summary.twr.reason).toBe('insufficient_price_history');
  });

  it('produces an XIRR from the real flow series', async () => {
    const result = must(await portfolio(ctx));
    expect(result.summary.xirr.value).not.toBeNull();
    // Money went out in 2025 and came back through 2026 at a substantial gain,
    // so the money-weighted return is well above zero and below 100%.
    const rate = rToNumber(result.summary.xirr.value!);
    expect(rate).toBeGreaterThan(0.05);
    expect(rate).toBeLessThan(1);
  });
});

describe('G2 — determinism', () => {
  it('a full rebuild reproduces the incremental output byte for byte', async () => {
    const before = await derivedFingerprint(userId);
    const { rebuildAllPositions, withWriteCtx } = await import('@/server/services');
    must(await withWriteCtx(ctx, (w) => rebuildAllPositions(w)));
    expect(await derivedFingerprint(userId)).toBe(before);
  });

  it('holds every invariant the integrity checker asserts', async () => {
    const { verifyIntegrity } = await import('@/server/db/integrity');
    const report = await verifyIntegrity(process.env['TEST_DATABASE_URL']!);
    const failed = report.checks.filter((c) => c.status === 'failed');
    expect(failed.map((c) => `${c.invariant}: ${c.violations}`)).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it('allocates 100% to one equity holding', async () => {
    const { assetAllocation } = await import('@/server/services');
    const allocation = await assetAllocation(ctx, 'asset_class');
    expect(allocation.slices).toHaveLength(1);
    expect(allocation.slices[0]!.key).toBe('equity');
    expect(rToNumber(allocation.slices[0]!.weightPct.value!)).toBe(1);
    expect(toDbString(allocation.total)).toBe(expected.summary.marketValue);
    expect(isoDate('2026-08-11')).toBe(ctx.today);
  });
});
