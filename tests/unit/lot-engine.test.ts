/**
 * The cost-basis engine — every case in
 * [INVESTMENT-DOMAIN.md §12](../../docs/INVESTMENT-DOMAIN.md#12-edge-cases-that-must-be-covered-by-tests)
 * that the engine can answer without a database or a price.
 *
 * Every expected figure below was computed by hand from the transaction list
 * above it, not read off the implementation. Where a number could plausibly be
 * something else, the wrong number is stated too — a test that asserts only the
 * right answer does not show that it could tell the difference.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/date';
import { Money, sum, toDbString } from '@/lib/decimal/money';
import { Quantity, qToDbString } from '@/lib/decimal/quantity';
import { Rate } from '@/lib/decimal/rate';
import { perUnit, pToDbString } from '@/lib/decimal/price';
import { replay, type ReplayResult, type ReplayTxn } from '@/server/domain/lots/engine';
import {
  FIFO_INR,
  FIFO_USD_IN_INR,
  INR,
  USD,
  bonus,
  buy,
  dividend,
  feeRow,
  interest,
  money,
  resetSequence,
  sell,
  split,
  taxRow,
  transferIn,
  transferOut,
} from './_lot-fixtures';

beforeEach(resetSequence);

/** Unwrap a successful replay; a failure prints the error rather than `undefined`. */
function run(txns: readonly ReplayTxn[], options = FIFO_INR): ReplayResult {
  const result = replay(txns, options);
  if (!result.ok) throw new Error(`expected a successful replay, got ${JSON.stringify(result.error)}`);
  return result.value;
}

const avgCost = (r: ReplayResult): string =>
  pToDbString(perUnit(r.totals.costBasis, r.totals.quantity, 'half_up'));

// ---------------------------------------------------------------------------
// L0 — the reference case that fails against a stored average cost
// ---------------------------------------------------------------------------

describe('L0 — average cost is derived from surviving lots, never carried forward', () => {
  const txns = [
    buy({ on: '2026-01-05', qty: '100', price: '100' }),
    buy({ on: '2026-02-05', qty: '100', price: '150' }),
  ];

  it('holds two lots at their own costs', () => {
    const r = run(txns);
    expect(qToDbString(r.totals.quantity)).toBe('200.00000000');
    expect(money(r.totals.costBasis)).toBe('25000.0000');
    expect(avgCost(r)).toBe('125.00000000');
  });

  it('after selling the first lot entirely, the derived average JUMPS to ₹150', () => {
    const r = run([...txns, sell({ on: '2026-03-05', qty: '100', price: '200' })]);

    // FIFO closes the ₹100 lot entirely: cost consumed ₹10,000, proceeds
    // ₹20,000, realised ₹10,000. A stored average of ₹125 would report ₹7,500 —
    // wrong by ₹2,500 on a taxable gain.
    expect(money(r.totals.realizedPnl)).toBe('10000.0000');
    expect(money(r.totals.realizedPnl)).not.toBe('7500.0000');

    expect(money(r.totals.costBasis)).toBe('15000.0000');
    expect(qToDbString(r.totals.quantity)).toBe('100.00000000');
    // Nothing was purchased, and the average moved. That is correct.
    expect(avgCost(r)).toBe('150.00000000');
  });
});

// ---------------------------------------------------------------------------
// 1, 1a — FIFO order and partial disposal
// ---------------------------------------------------------------------------

describe('case 1 — multiple purchases at different prices, then a partial sell', () => {
  it('consumes the oldest lot first and leaves the newer basis intact', () => {
    const r = run([
      buy({ on: '2026-01-01', qty: '100', price: '100' }),
      buy({ on: '2026-02-01', qty: '100', price: '150' }),
      buy({ on: '2026-03-01', qty: '100', price: '200' }),
      sell({ on: '2026-04-01', qty: '150', price: '250' }),
    ]);

    // Lot A (100 @ ₹100) drains: cost ₹10,000. Lot B gives 50 of 100:
    // mulQtyRatio(15,000, 50, 100) = ₹7,500. Proceeds ₹37,500 allocate 2:1 →
    // ₹25,000 and ₹12,500. Realised 15,000 + 5,000 = ₹20,000.
    expect(r.disposals).toHaveLength(2);
    expect(money(r.disposals[0]!.costConsumed)).toBe('10000.0000');
    expect(money(r.disposals[0]!.proceeds)).toBe('25000.0000');
    expect(money(r.disposals[0]!.realizedPnl)).toBe('15000.0000');
    expect(money(r.disposals[1]!.costConsumed)).toBe('7500.0000');
    expect(money(r.disposals[1]!.proceeds)).toBe('12500.0000');
    expect(money(r.disposals[1]!.realizedPnl)).toBe('5000.0000');

    expect(money(r.totals.realizedPnl)).toBe('20000.0000');
    expect(qToDbString(r.totals.quantity)).toBe('150.00000000');
    expect(money(r.totals.costBasis)).toBe('27500.0000');
  });
});

describe('case 1a — partial sell of a single lot', () => {
  const r = () =>
    run([
      buy({ on: '2026-01-01', qty: '100', price: '100' }),
      sell({ on: '2026-06-01', qty: '40', price: '150' }),
    ]);

  it('leaves the lot alive with 60 units', () => {
    const lot = r().lots[0]!;
    expect(qToDbString(lot.remainingQuantity)).toBe('60.00000000');
    expect(qToDbString(lot.originalQuantity)).toBe('100.00000000');
  });

  it('reduces cost basis by the COST of the units sold, not by the proceeds', () => {
    // 40 × ₹100 = ₹4,000 of cost leaves. ₹6,000 remains.
    // Subtracting the ₹6,000 of *proceeds* instead would leave ₹4,000 — the
    // single most common cost-basis bug.
    expect(money(r().totals.costBasis)).toBe('6000.0000');
    expect(money(r().totals.costBasis)).not.toBe('4000.0000');
  });

  it('leaves the derived average price at ₹100', () => {
    expect(avgCost(r())).toBe('100.00000000');
  });

  it('realises ₹2,000 and does not fold it into cost basis', () => {
    expect(money(r().totals.realizedPnl)).toBe('2000.0000');
    expect(money(r().totals.costBasis)).toBe('6000.0000');
  });

  it('reports position quantity 60', () => {
    expect(qToDbString(r().totals.quantity)).toBe('60.00000000');
  });
});

// ---------------------------------------------------------------------------
// 2, 22 — multi-lot disposal
// ---------------------------------------------------------------------------

describe('case 2 — a sell spanning three lots, exactly and partially', () => {
  const threeLots = [
    buy({ on: '2026-01-01', qty: '100', price: '100' }),
    buy({ on: '2026-02-01', qty: '100', price: '150' }),
    buy({ on: '2026-03-01', qty: '100', price: '200' }),
  ];

  it('spans all three exactly', () => {
    const r = run([...threeLots, sell({ on: '2026-04-01', qty: '300', price: '250' })]);
    expect(r.disposals).toHaveLength(3);
    expect(money(r.totals.realizedPnl)).toBe('30000.0000'); // 75,000 − 45,000
    expect(money(r.totals.costBasis)).toBe('0.0000');
    expect(qToDbString(r.totals.quantity)).toBe('0.00000000');
  });

  it('spans them partially, stopping mid-lot', () => {
    const r = run([...threeLots, sell({ on: '2026-04-01', qty: '250', price: '250' })]);
    expect(r.disposals).toHaveLength(3);
    // 100 + 100 + 50; the third lot keeps 50 units of its ₹20,000 basis → ₹10,000.
    expect(money(r.totals.costBasis)).toBe('10000.0000');
    expect(qToDbString(r.totals.quantity)).toBe('50.00000000');
  });
});

describe('case 22 — a multi-lot disposal loses nothing to rounding', () => {
  // Three lots of 10 units; a sale whose net proceeds do not divide by three.
  // Gross 30 × ₹333.34 = ₹10,000.20, fee ₹0.1999 → net ₹10,000.0001.
  const txns = [
    buy({ on: '2026-01-01', qty: '10', price: '100' }),
    buy({ on: '2026-01-02', qty: '10', price: '150' }),
    buy({ on: '2026-01-03', qty: '10', price: '200' }),
    sell({ on: '2026-02-01', qty: '30', price: '333.34', fees: '0.1999' }),
  ];

  it('allocates the proceeds so they sum back EXACTLY', () => {
    const r = run(txns);
    const proceeds = r.disposals.map((d) => d.proceeds);
    // allocate hands the remainder out largest-first, ties by index:
    // 3333.3334 / 3333.3334 / 3333.3333.
    expect(proceeds.map(money)).toEqual(['3333.3334', '3333.3334', '3333.3333']);
    expect(money(sum(proceeds, INR))).toBe('10000.0001');
  });

  it('satisfies Σ realized = netProceeds − Σ cost_consumed to the minor unit', () => {
    const r = run(txns);
    const costConsumed = sum(
      r.disposals.map((d) => d.costConsumed),
      INR,
    );
    expect(money(costConsumed)).toBe('4500.0000');
    // 10,000.0001 − 4,500 = 5,500.0001. A divide-then-multiply implementation
    // leaves a residue here, and the residue lands in a tax figure.
    expect(money(r.totals.realizedPnl)).toBe('5500.0001');
  });

  it('drains every lot exactly — I-20 holds per lot', () => {
    const r = run(txns);
    for (const lot of r.lots) {
      const consumed = sum(
        r.disposals.filter((d) => d.lotKey === lot.key).map((d) => d.costConsumed),
        INR,
      );
      expect(money(Money.fromMinor(consumed.minor + lot.remainingCost.minor, INR))).toBe(
        money(lot.costTotal),
      );
      expect(money(lot.remainingCost)).toBe('0.0000');
      expect(qToDbString(lot.remainingQuantity)).toBe('0.00000000');
    }
  });
});

// ---------------------------------------------------------------------------
// 3, 4 — round trips and fees
// ---------------------------------------------------------------------------

describe('case 3 — sell everything, then buy again', () => {
  it('opens a new lot and keeps the realised P&L on the position', () => {
    const r = run([
      buy({ on: '2026-01-01', qty: '100', price: '100' }),
      sell({ on: '2026-03-01', qty: '100', price: '120' }),
      buy({ on: '2026-05-01', qty: '50', price: '130' }),
    ]);

    expect(r.lots).toHaveLength(2);
    // The closed lot is RETAINED at zero, not deleted: `costDeployed` sums
    // cost_total over every lot ever opened, and the disposal row references it.
    expect(money(r.lots[0]!.remainingCost)).toBe('0.0000');
    expect(money(r.lots[0]!.costTotal)).toBe('10000.0000');

    expect(money(r.totals.realizedPnl)).toBe('2000.0000');
    expect(money(r.totals.costBasis)).toBe('6500.0000');
    expect(qToDbString(r.totals.quantity)).toBe('50.00000000');
  });
});

describe('case 4 — purchase fees are capitalised; sale fees reduce proceeds', () => {
  const r = () =>
    run([
      buy({ on: '2026-01-01', qty: '100', price: '100', fees: '50' }),
      sell({ on: '2026-06-01', qty: '40', price: '150', fees: '30' }),
    ]);

  it('puts the buy fee inside cost_total', () => {
    expect(money(r().lots[0]!.costTotal)).toBe('10050.0000');
  });

  it('lets the sale fee reduce proceeds, and therefore realised P&L', () => {
    const d = r().disposals[0]!;
    expect(money(d.proceeds)).toBe('5970.0000'); // 6,000 − 30
    expect(money(d.costConsumed)).toBe('4020.0000'); // mulQtyRatio(10,050, 40, 100)
    expect(money(d.realizedPnl)).toBe('1950.0000');
  });

  it('accrues NEITHER trade fee to fees_total — that would subtract them twice', () => {
    // totalReturn subtracts fees_total. The buy fee is already inside the cost
    // basis and the sale fee has already reduced realised P&L.
    expect(money(r().totals.feesTotal)).toBe('0.0000');
    expect(money(r().totals.taxesTotal)).toBe('0.0000');
  });

  it('leaves ₹6,030 of basis on 60 units', () => {
    expect(money(r().totals.costBasis)).toBe('6030.0000');
  });
});

// ---------------------------------------------------------------------------
// 5, 5a, 21 — income
// ---------------------------------------------------------------------------

describe('case 5 — a dividend survives the holding being sold', () => {
  it('keeps income on a position that has gone to zero', () => {
    const r = run([
      buy({ on: '2026-01-01', qty: '100', price: '100' }),
      dividend({ on: '2026-04-01', gross: '500' }),
      sell({ on: '2026-06-01', qty: '100', price: '120' }),
    ]);

    expect(money(r.totals.incomeTotal)).toBe('500.0000');
    expect(qToDbString(r.totals.quantity)).toBe('0.00000000');
    expect(money(r.totals.costBasis)).toBe('0.0000');
    expect(money(r.totals.realizedPnl)).toBe('2000.0000');
  });
});

describe('case 5a — a dividend does not touch the lot', () => {
  const r = () =>
    run([
      buy({ on: '2026-01-01', qty: '100', price: '100' }),
      dividend({ on: '2026-04-01', gross: '500' }),
    ]);

  it('leaves cost_total, remaining_cost and the derived per-unit cost unchanged', () => {
    const lot = r().lots[0]!;
    expect(money(lot.costTotal)).toBe('10000.0000');
    expect(money(lot.remainingCost)).toBe('10000.0000');
    expect(avgCost(r())).toBe('100.00000000');
  });

  it('records the dividend as income, never as a cost reduction', () => {
    expect(money(r().totals.incomeTotal)).toBe('500.0000');
    // ₹9,500 would be the cost basis if the dividend had been treated as a
    // refund of principal. It is a return ON the investment, not OF it.
    expect(money(r().totals.costBasis)).toBe('10000.0000');
    expect(money(r().totals.costBasis)).not.toBe('9500.0000');
  });

  it('does not disturb the disposal that follows', () => {
    expect(r().disposals).toHaveLength(0);
  });
});

describe('cases 5b and 21 — income accrues gross, with the withholding separate', () => {
  const r = () =>
    run([
      buy({ on: '2026-01-01', qty: '100', price: '100' }),
      dividend({ on: '2026-04-01', gross: '500', taxes: '50' }),
    ]);

  it('accrues ₹500 gross to income and ₹50 to taxes', () => {
    expect(money(r().totals.incomeTotal)).toBe('500.0000');
    expect(money(r().totals.taxesTotal)).toBe('50.0000');
    expect(money(r().totals.feesTotal)).toBe('0.0000');
  });

  it('contributes exactly +450 to total return — not 400, and not 500', () => {
    const t = r().totals;
    const contribution = t.incomeTotal.minor - t.feesTotal.minor - t.taxesTotal.minor;
    expect(toDbString(Money.fromMinor(contribution, INR))).toBe('450.0000');
    // 400 = income accrued net AND the tax subtracted again (double-subtracted).
    expect(toDbString(Money.fromMinor(contribution, INR))).not.toBe('400.0000');
    // 500 = the withholding ignored entirely.
    expect(toDbString(Money.fromMinor(contribution, INR))).not.toBe('500.0000');
  });

  it('treats interest identically', () => {
    const r2 = run([interest({ on: '2026-04-01', gross: '500', taxes: '50' })]);
    expect(money(r2.totals.incomeTotal)).toBe('500.0000');
    expect(money(r2.totals.taxesTotal)).toBe('50.0000');
  });

  it('accrues a dividend collection charge to fees, never to income', () => {
    const r3 = run([dividend({ on: '2026-04-01', gross: '500', fees: '20', taxes: '50' })]);
    expect(money(r3.totals.incomeTotal)).toBe('500.0000');
    expect(money(r3.totals.feesTotal)).toBe('20.0000');
    expect(money(r3.totals.taxesTotal)).toBe('50.0000');
  });
});

describe('standalone fee and tax rows accrue their magnitude, in instrument currency', () => {
  it('accrues |net_amount_instrument| and touches no lot', () => {
    const r = run([
      buy({ on: '2026-01-01', qty: '100', price: '100' }),
      feeRow({ on: '2026-03-01', amount: '250' }),
      taxRow({ on: '2026-03-02', amount: '75' }),
    ]);
    expect(money(r.totals.feesTotal)).toBe('250.0000');
    expect(money(r.totals.taxesTotal)).toBe('75.0000');
    expect(money(r.totals.costBasis)).toBe('10000.0000');
    expect(r.disposals).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6, 7, 8, 23, 31 — corporate actions
// ---------------------------------------------------------------------------

describe('case 6 — splits before, after, and without a holding', () => {
  it('a 1:5 split before a sale gives the same realised P&L as the unsplit equivalent', () => {
    const withSplit = run([
      buy({ on: '2026-01-01', qty: '100', price: '100' }),
      split({ on: '2026-03-01', num: 5, den: 1 }),
      sell({ on: '2026-06-01', qty: '200', price: '25' }),
    ]);
    const without = run([
      buy({ on: '2026-01-01', qty: '100', price: '100' }),
      sell({ on: '2026-06-01', qty: '40', price: '125' }),
    ]);

    expect(money(withSplit.totals.realizedPnl)).toBe('1000.0000');
    expect(money(withSplit.totals.realizedPnl)).toBe(money(without.totals.realizedPnl));
    expect(money(withSplit.totals.costBasis)).toBe(money(without.totals.costBasis));
  });

  it('scales quantities and leaves the basis untouched', () => {
    const r = run([
      buy({ on: '2026-01-01', qty: '100', price: '100' }),
      split({ on: '2026-03-01', num: 5, den: 1 }),
    ]);
    expect(qToDbString(r.totals.quantity)).toBe('500.00000000');
    expect(money(r.totals.costBasis)).toBe('10000.0000');
    expect(avgCost(r)).toBe('20.00000000'); // derived, ÷5
  });

  it('a reverse split multiplies the derived per-unit cost', () => {
    const r = run([
      buy({ on: '2026-01-01', qty: '500', price: '20' }),
      split({ on: '2026-03-01', num: 1, den: 5 }),
    ]);
    expect(qToDbString(r.totals.quantity)).toBe('100.00000000');
    expect(money(r.totals.costBasis)).toBe('10000.0000');
    expect(avgCost(r)).toBe('100.00000000');
  });

  it('a split after a sale leaves the settled disposal alone', () => {
    const r = run([
      buy({ on: '2026-01-01', qty: '100', price: '100' }),
      sell({ on: '2026-02-01', qty: '40', price: '150' }),
      split({ on: '2026-03-01', num: 5, den: 1 }),
    ]);
    // The settled disposal is a historical record and is not rewritten.
    expect(qToDbString(r.disposals[0]!.quantity)).toBe('40.00000000');
    expect(money(r.disposals[0]!.costConsumed)).toBe('4000.0000');
    expect(qToDbString(r.totals.quantity)).toBe('300.00000000'); // 60 × 5
    expect(money(r.totals.costBasis)).toBe('6000.0000');
    expect(money(r.totals.realizedPnl)).toBe('2000.0000');
  });

  it('a split with no open holding is a no-op, and does not touch the closed lot', () => {
    const r = run([
      buy({ on: '2026-01-01', qty: '100', price: '100' }),
      sell({ on: '2026-02-01', qty: '100', price: '150' }),
      split({ on: '2026-03-01', num: 5, den: 1 }),
    ]);
    expect(qToDbString(r.totals.quantity)).toBe('0.00000000');
    expect(qToDbString(r.lots[0]!.originalQuantity)).toBe('100.00000000'); // NOT 500
    expect(money(r.totals.realizedPnl)).toBe('5000.0000');
  });
});

describe('case 7 — a bonus issue', () => {
  const r = () =>
    run([
      buy({ on: '2026-01-01', qty: '100', price: '100' }),
      bonus({ on: '2026-03-01', num: 1, den: 1 }),
    ]);

  it('doubles the quantity at zero incremental cost', () => {
    expect(qToDbString(r().totals.quantity)).toBe('200.00000000');
    expect(money(r().totals.costBasis)).toBe('10000.0000');
  });

  it('halves the derived average cost', () => {
    expect(avgCost(r())).toBe('50.00000000');
  });

  it('keeps remaining_quantity within original_quantity, as the table requires', () => {
    const lot = r().lots[0]!;
    expect(lot.remainingQuantity.units).toBeLessThanOrEqual(lot.originalQuantity.units);
    expect(qToDbString(lot.originalQuantity)).toBe('200.00000000');
  });
});

describe('case 8 — a split ratio that does not divide the held quantity evenly', () => {
  it('retains the fractional units at QTY_SCALE and never touches the basis', () => {
    const r = run([
      buy({ on: '2026-01-01', qty: '100', price: '100' }),
      split({ on: '2026-03-01', num: 2, den: 3 }),
    ]);
    // 100 × 2 / 3 = 66.666666666… → half_up at scale 8.
    expect(qToDbString(r.totals.quantity)).toBe('66.66666667');
    expect(money(r.totals.costBasis)).toBe('10000.0000');
  });
});

describe('case 23 — corporate actions preserve basis byte-for-byte', () => {
  const before = [buy({ on: '2026-01-01', qty: '100', price: '100', fees: '50' })];
  const actions = [
    split({ on: '2026-02-01', num: 5, den: 1 }),
    bonus({ on: '2026-03-01', num: 1, den: 1 }),
  ];

  it('leaves Σ cost_total byte-identical across a split and a bonus', () => {
    const sumCostTotal = (r: ReplayResult) => money(sum(r.lots.map((l) => l.costTotal), INR));
    expect(sumCostTotal(run([...before, ...actions]))).toBe(sumCostTotal(run(before)));
    expect(sumCostTotal(run([...before, ...actions]))).toBe('10050.0000');
  });

  it('still satisfies Σ cost_consumed + remaining_cost = cost_total after a partial sell', () => {
    // 100 → ×5 = 500 → ×2 (1:1 bonus) = 1,000 units on ₹10,050 of basis.
    const r = run([...before, ...actions, sell({ on: '2026-04-01', qty: '400', price: '15' })]);
    const lot = r.lots[0]!;
    const consumed = sum(
      r.disposals.filter((d) => d.lotKey === lot.key).map((d) => d.costConsumed),
      INR,
    );
    expect(money(Money.fromMinor(consumed.minor + lot.remainingCost.minor, INR))).toBe('10050.0000');
    // 400 of 1,000 units → mulQtyRatio(10,050, 400, 1000) = ₹4,020.
    expect(money(consumed)).toBe('4020.0000');
    expect(money(lot.remainingCost)).toBe('6030.0000');
  });
});

describe('case 31 — the quantity relation is FALSE after a corporate action, the money one is not', () => {
  it('breaks Σ disposals.quantity + remaining ≠ original, while the money form holds', () => {
    const r = run([
      buy({ on: '2026-01-01', qty: '100', price: '100' }),
      sell({ on: '2026-02-01', qty: '40', price: '150' }),
      split({ on: '2026-03-01', num: 5, den: 1 }),
    ]);
    const lot = r.lots[0]!;
    const disposedQty = r.disposals
      .filter((d) => d.lotKey === lot.key)
      .reduce((acc, d) => acc + d.quantity.units, 0n);

    // 40 disposed + 300 remaining = 340; original was rescaled to 500.
    // `verify:integrity` must NOT assert this.
    expect(disposedQty + lot.remainingQuantity.units).not.toBe(lot.originalQuantity.units);
    expect(qToDbString(Quantity.fromUnits(disposedQty))).toBe('40.00000000');
    expect(qToDbString(lot.remainingQuantity)).toBe('300.00000000');
    expect(qToDbString(lot.originalQuantity)).toBe('500.00000000');

    // The money form holds unconditionally, which is why I-20 is the one checked.
    const consumed = r.disposals
      .filter((d) => d.lotKey === lot.key)
      .reduce((acc, d) => acc + d.costConsumed.minor, 0n);
    expect(consumed + lot.remainingCost.minor).toBe(lot.costTotal.minor);
  });
});

// ---------------------------------------------------------------------------
// sub-paisa disposal — why partial cost consumption floors
// ---------------------------------------------------------------------------

describe('a partial disposal never leaves a lot with units and no basis (I-19)', () => {
  it('retains the last minor unit of basis rather than consuming it', () => {
    // A lot holding ₹0.0001 of basis over 10 units, selling 6 of them.
    // half_up would consume the whole minor unit and leave 4 units at zero cost,
    // which the `tax_lots` CHECK rejects. floor retains it.
    const r = run([
      buy({ on: '2026-01-01', qty: '10', price: '0.00001' }), // gross = ₹0.0001
      sell({ on: '2026-02-01', qty: '6', price: '1' }),
    ]);

    const lot = r.lots[0]!;
    expect(money(lot.costTotal)).toBe('0.0001');
    expect(money(r.disposals[0]!.costConsumed)).toBe('0.0000');
    expect(money(lot.remainingCost)).toBe('0.0001');
    expect(qToDbString(lot.remainingQuantity)).toBe('4.00000000');

    // I-19, stated exactly as the database CHECK does.
    expect(qToDbString(lot.remainingQuantity) === '0.00000000').toBe(lot.remainingCost.minor === 0n);
  });

  it('still drains to exactly zero when the rest is sold', () => {
    const r = run([
      buy({ on: '2026-01-01', qty: '10', price: '0.00001' }),
      sell({ on: '2026-02-01', qty: '6', price: '1' }),
      sell({ on: '2026-03-01', qty: '4', price: '1' }),
    ]);
    const lot = r.lots[0]!;
    expect(money(lot.remainingCost)).toBe('0.0000');
    expect(qToDbString(lot.remainingQuantity)).toBe('0.00000000');

    // I-20 holds exactly: the final slice takes remaining_cost verbatim.
    const consumed = r.disposals.reduce((acc, d) => acc + d.costConsumed.minor, 0n);
    expect(consumed).toBe(lot.costTotal.minor);
  });

  it('agrees with half_up on every figure that divides exactly', () => {
    // The documented worked example: mulQtyRatio(10,050, 40, 100) = 4,020 under
    // either mode. Changing the mode changed no documented figure.
    const r = run([
      buy({ on: '2026-01-01', qty: '100', price: '100', fees: '50' }),
      sell({ on: '2026-06-01', qty: '40', price: '150', fees: '30' }),
    ]);
    expect(money(r.disposals[0]!.costConsumed)).toBe('4020.0000');
  });
});

// ---------------------------------------------------------------------------
// 9 — oversell
// ---------------------------------------------------------------------------

describe('case 9 — oversell is rejected with shortBy and writes nothing', () => {
  it('reports how many units are missing', () => {
    const result = replay(
      [
        buy({ on: '2026-01-01', qty: '100', price: '100' }),
        sell({ on: '2026-02-01', qty: '150', price: '120' }),
      ],
      FIFO_INR,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('oversell');
    if (result.error.kind !== 'oversell') return;
    expect(qToDbString(result.error.shortBy)).toBe('50.00000000');
    // Selection performs no mutation, so the holding is reported intact: the UI
    // can say "you are selling 150 units but only 100 are held as of this date".
    expect(qToDbString(result.error.held)).toBe('100.00000000');
    expect(result.error.tradeDate).toBe(isoDate('2026-02-01'));
  });

  it('catches an oversell introduced by a BACKDATED sell', () => {
    // The sale is dated before the purchase, so at that instant nothing is held.
    const result = replay(
      [
        buy({ on: '2026-05-01', qty: '100', price: '100' }),
        sell({ on: '2026-01-01', qty: '10', price: '120' }),
      ],
      FIFO_INR,
    );
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === 'oversell') {
      expect(qToDbString(result.error.shortBy)).toBe('10.00000000');
    }
  });

  it('does not treat a sale of exactly the held quantity as an oversell', () => {
    const r = run([
      buy({ on: '2026-01-01', qty: '100', price: '100' }),
      sell({ on: '2026-02-01', qty: '100', price: '120' }),
    ]);
    expect(qToDbString(r.totals.quantity)).toBe('0.00000000');
  });
});

// ---------------------------------------------------------------------------
// 13, 25 — ordering
// ---------------------------------------------------------------------------

describe('case 13 — two transactions on the same trade date replay identically', () => {
  it('gives the same answer whichever array order they arrive in', () => {
    const a = buy({ on: '2026-01-01', qty: '100', price: '100', id: 'a', createdAt: new Date(1000) });
    const b = buy({ on: '2026-01-01', qty: '100', price: '150', id: 'b', createdAt: new Date(2000) });
    const forward = run([a, b, sell({ on: '2026-02-01', qty: '100', price: '200' })]);
    const reversed = run([b, a, sell({ on: '2026-02-01', qty: '100', price: '200' })]);

    // `created_at` orders them, so FIFO takes the ₹100 lot in both cases.
    expect(money(forward.totals.realizedPnl)).toBe('10000.0000');
    expect(money(reversed.totals.realizedPnl)).toBe(money(forward.totals.realizedPnl));
    expect(money(reversed.totals.costBasis)).toBe(money(forward.totals.costBasis));
  });

  it('breaks a same-millisecond tie by id, so the order is total', () => {
    const at = new Date(5000);
    const a = buy({ on: '2026-01-01', qty: '100', price: '100', id: 'aaa', createdAt: at });
    const b = buy({ on: '2026-01-01', qty: '100', price: '150', id: 'bbb', createdAt: at });
    const forward = run([a, b, sell({ on: '2026-02-01', qty: '100', price: '200' })]);
    const reversed = run([b, a, sell({ on: '2026-02-01', qty: '100', price: '200' })]);
    expect(money(forward.totals.realizedPnl)).toBe('10000.0000');
    expect(money(reversed.totals.realizedPnl)).toBe('10000.0000');
  });
});

describe('case 25 — same-date ordering is independent of entry order', () => {
  // A buy and a split sharing a trade date. Without kind_rank the answer would
  // depend on which row was entered first.
  const theBuy = buy({ on: '2026-03-01', qty: '100', price: '100', id: 'buy', createdAt: new Date(1000) });
  const theSplit = split({ on: '2026-03-01', num: 5, den: 1, id: 'split', createdAt: new Date(2000) });
  const splitFirst = split({ on: '2026-03-01', num: 5, den: 1, id: 'split', createdAt: new Date(500) });

  it('scales the same-day purchase whichever row was entered first', () => {
    const entered = run([theBuy, theSplit]);
    const enteredOther = run([splitFirst, theBuy]);

    // The shares are held by end of day, so the ratio applies to them.
    expect(qToDbString(entered.totals.quantity)).toBe('500.00000000');
    expect(qToDbString(enteredOther.totals.quantity)).toBe('500.00000000');
    expect(money(entered.totals.costBasis)).toBe('10000.0000');
    expect(money(enteredOther.totals.costBasis)).toBe('10000.0000');
  });

  it('applies a split before a same-day bonus', () => {
    // 100 → ×5 = 500 → +500 (1:1 bonus on the split-adjusted base) = 1,000.
    const r = run([
      buy({ on: '2026-01-01', qty: '100', price: '100' }),
      bonus({ on: '2026-03-01', num: 1, den: 1, createdAt: new Date(100) }),
      split({ on: '2026-03-01', num: 5, den: 1, createdAt: new Date(900) }),
    ]);
    expect(qToDbString(r.totals.quantity)).toBe('1000.00000000');
    expect(money(r.totals.costBasis)).toBe('10000.0000');
  });
});

// ---------------------------------------------------------------------------
// 14, 24 — transfers
// ---------------------------------------------------------------------------

describe('cases 14 and 24 — a transfer preserves basis and the holding clock', () => {
  it('realises exactly zero on the way out, by construction', () => {
    const r = run([
      buy({ on: '2024-01-10', qty: '100', price: '100' }),
      transferOut({ on: '2025-06-01', qty: '100', price: '250' }),
    ]);

    const d = r.disposals[0]!;
    // Proceeds are DEFINED as the cost consumed — the market price of ₹250 is
    // irrelevant. Using it would manufacture a ₹15,000 taxable gain out of a
    // move between two of the user's own accounts.
    expect(money(d.proceeds)).toBe('10000.0000');
    expect(money(d.costConsumed)).toBe('10000.0000');
    expect(money(d.realizedPnl)).toBe('0.0000');
    expect(money(r.totals.realizedPnl)).toBe('0.0000');
  });

  it('measures holding_days from the ORIGINAL acquisition, not the transfer', () => {
    // 2024-01-10 → 2025-06-01 is 366 + 142 = 508 days (2024 is a leap year).
    const out = run([
      buy({ on: '2024-01-10', qty: '100', price: '100' }),
      transferOut({ on: '2025-06-01', qty: '100', price: '250' }),
    ]);
    expect(out.disposals[0]!.holdingDays).toBe(508);

    // The destination account: a transfer_in carrying the original date, then a
    // sale a month later. 508 + 30 = 538 days — long-term, not 30 days short-term.
    const destination = run([
      transferIn({ on: '2025-06-01', qty: '100', price: '100', acquiredOn: '2024-01-10' }),
      sell({ on: '2025-07-01', qty: '100', price: '250' }),
    ]);
    expect(destination.lots[0]!.acquiredOn).toBe(isoDate('2024-01-10'));
    expect(destination.lots[0]!.openedOn).toBe(isoDate('2025-06-01'));
    expect(destination.disposals[0]!.holdingDays).toBe(538);
    expect(destination.disposals[0]!.holdingDays).not.toBe(30);
  });

  it('carries the basis across, so the eventual sale realises the whole gain once', () => {
    const destination = run([
      transferIn({ on: '2025-06-01', qty: '100', price: '100', acquiredOn: '2024-01-10' }),
      sell({ on: '2025-07-01', qty: '100', price: '250' }),
    ]);
    expect(money(destination.lots[0]!.costTotal)).toBe('10000.0000');
    expect(money(destination.totals.realizedPnl)).toBe('15000.0000');
  });

  it('realises nothing in the base currency either, when the rate has moved', () => {
    // The lot is valued at its OWN acquisition rate on the way out, so a
    // transfer cannot become a currency gain.
    const r = run(
      [
        buy({ on: '2024-01-10', qty: '100', price: '50', fx: '80', currency: USD }),
        transferOut({ on: '2025-06-01', qty: '100', price: '60', fx: '85', currency: USD }),
      ],
      FIFO_USD_IN_INR,
    );
    const d = r.disposals[0]!;
    expect(money(d.realizedPnl)).toBe('0.0000');
    expect(toDbString(d.baseRealizedPnl)).toBe('0.0000');
    expect(toDbString(d.baseFxComponent)).toBe('0.0000');
  });
});

// ---------------------------------------------------------------------------
// 12, 27 — foreign currency
// ---------------------------------------------------------------------------

describe('cases 12 and 27 — a foreign-currency position', () => {
  const txns = [
    buy({ on: '2026-01-01', qty: '100', price: '50', fx: '80', currency: USD }),
    sell({ on: '2026-06-01', qty: '100', price: '60', fx: '85', currency: USD }),
  ];

  it('keeps cost basis in the instrument currency at the acquisition rate', () => {
    const held = run([txns[0]!], FIFO_USD_IN_INR);
    expect(held.totals.costBasis.currency).toBe(USD);
    expect(money(held.totals.costBasis)).toBe('5000.0000');
    // Σ (remaining_cost × lot.fx_rate_to_base), per lot — not × today's rate.
    expect(held.totals.baseCostBasis.currency).toBe(INR);
    expect(toDbString(held.totals.baseCostBasis)).toBe('400000.0000');
  });

  it('splits realised P&L into a price and an FX component that sum back exactly', () => {
    const r = run(txns, FIFO_USD_IN_INR);
    const d = r.disposals[0]!;

    expect(money(d.realizedPnl)).toBe('1000.0000'); // $6,000 − $5,000

    // base = 6,000×85 − 5,000×80 = 510,000 − 400,000 = ₹110,000
    expect(toDbString(d.baseRealizedPnl)).toBe('110000.0000');
    // fx = cost_consumed × (fd − fl) = 5,000 × 5 = ₹25,000
    expect(toDbString(d.baseFxComponent)).toBe('25000.0000');

    // price is DERIVED as the difference, so I-18 cannot fail: (p−c)×fd = 1,000×85.
    const basePrice = d.baseRealizedPnl.minor - d.baseFxComponent.minor;
    expect(toDbString(Money.fromMinor(basePrice, INR))).toBe('85000.0000');
    expect(basePrice + d.baseFxComponent.minor).toBe(d.baseRealizedPnl.minor);
  });

  it('sums the components back on a multi-lot disposal at different acquisition rates', () => {
    const r = run(
      [
        buy({ on: '2026-01-01', qty: '60', price: '50', fx: '80', currency: USD }),
        buy({ on: '2026-02-01', qty: '40', price: '55', fx: '82.5', currency: USD }),
        sell({ on: '2026-06-01', qty: '100', price: '60', fx: '85', currency: USD }),
      ],
      FIFO_USD_IN_INR,
    );
    for (const d of r.disposals) {
      expect(d.baseRealizedPnl.minor - d.baseFxComponent.minor + d.baseFxComponent.minor).toBe(
        d.baseRealizedPnl.minor,
      );
    }
    // Each lot keeps its own rate; the disposal uses the rate on the sale date.
    expect(r.disposals[0]!.fxRateToBase.value).toBe(Rate.of('85').value);
    expect(r.lots[0]!.fxRateToBase.value).toBe(Rate.of('80').value);
    expect(r.lots[1]!.fxRateToBase.value).toBe(Rate.of('82.5').value);
  });
});

// ---------------------------------------------------------------------------
// determinism
// ---------------------------------------------------------------------------

describe('determinism', () => {
  const history = [
    buy({ on: '2026-01-01', qty: '100', price: '100', fees: '50' }),
    dividend({ on: '2026-02-01', gross: '500', taxes: '50' }),
    buy({ on: '2026-03-01', qty: '50', price: '120' }),
    split({ on: '2026-04-01', num: 2, den: 1 }),
    sell({ on: '2026-05-01', qty: '150', price: '70', fees: '30' }),
    feeRow({ on: '2026-06-01', amount: '99.99' }),
    bonus({ on: '2026-07-01', num: 1, den: 2 }),
  ];

  it('produces identical output for identical input', () => {
    expect(JSON.stringify(run(history), stringifyBigints)).toBe(
      JSON.stringify(run(history), stringifyBigints),
    );
  });

  it('is unaffected by the order the array happens to be in', () => {
    const shuffled = [history[3]!, history[0]!, history[6]!, history[2]!, history[5]!, history[1]!, history[4]!];
    expect(JSON.stringify(run(shuffled), stringifyBigints)).toBe(
      JSON.stringify(run(history), stringifyBigints),
    );
  });

  it('does not mutate the array it was given', () => {
    const input = [...history];
    run(input);
    expect(input.map((t) => t.id)).toEqual(history.map((t) => t.id));
  });
});

function stringifyBigints(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}
