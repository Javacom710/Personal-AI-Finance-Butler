/**
 * Algebraic laws over the lot engine (TESTING.md §3).
 *
 * A table-driven test shows the cases somebody thought of hold. These show the
 * law holds over the space — which is what catches the class of bug where a
 * rebuild produces a different answer from the incremental path, and where the
 * answer depends on the order rows happened to be entered.
 *
 * Every assertion here is **exact**. The former `± 1 minor unit per lot`
 * tolerance was a consequence of storing `cost_per_unit` and multiplying it on
 * read; lots now store money exactly and derive the rate, so there is nothing to
 * drift. A property test with a tolerance would pass against an engine that
 * leaks a paisa per disposal.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { addDays, isoDate, type IsoDate } from '@/lib/date';
import { Money, currency, neg, sub, sum, toDbString } from '@/lib/decimal/money';
import { Quantity, qIsZero, qSum } from '@/lib/decimal/quantity';
import { Rate } from '@/lib/decimal/rate';
import { UnitPrice, mulQtyRatio, perUnit, valueOf } from '@/lib/decimal/price';
import { replay, type ReplayResult, type ReplayTxn } from '@/server/domain/lots/engine';

const INR = currency('INR');
const OPTIONS = { method: 'fifo' as const, currency: INR, baseCurrency: INR };

// --------------------------------------------------------------- generators

type Op =
  | { readonly tag: 'buy'; readonly units: bigint; readonly priceUnits: bigint; readonly feeMinor: bigint }
  | { readonly tag: 'sell'; readonly percent: number; readonly priceUnits: bigint; readonly feeMinor: bigint }
  | { readonly tag: 'dividend'; readonly grossMinor: bigint; readonly taxMinor: bigint }
  | { readonly tag: 'fee'; readonly minor: bigint }
  | { readonly tag: 'split'; readonly num: number; readonly den: number }
  | { readonly tag: 'bonus'; readonly num: number; readonly den: number };

/** 0.01 to 10,000 units, at scale 8. */
const units = fc.bigInt({ min: 1_000_000n, max: 1_000_000_000_000n });
/** ₹0.01 to ₹10,000 per unit, at scale 8. */
const priceUnits = fc.bigInt({ min: 1_000_000n, max: 1_000_000_000_000n });
const feeMinor = fc.bigInt({ min: 0n, max: 10_000_000n });

const op: fc.Arbitrary<Op> = fc.oneof(
  { weight: 5, arbitrary: fc.record({ tag: fc.constant('buy' as const), units, priceUnits, feeMinor }) },
  {
    weight: 4,
    arbitrary: fc.record({
      tag: fc.constant('sell' as const),
      percent: fc.integer({ min: 1, max: 100 }),
      priceUnits,
      feeMinor,
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      tag: fc.constant('dividend' as const),
      grossMinor: fc.bigInt({ min: 1n, max: 100_000_000n }),
      taxMinor: fc.bigInt({ min: 0n, max: 1_000_000n }),
    }),
  },
  { weight: 1, arbitrary: fc.record({ tag: fc.constant('fee' as const), minor: feeMinor }) },
  {
    weight: 2,
    arbitrary: fc.record({
      tag: fc.constant('split' as const),
      num: fc.integer({ min: 1, max: 10 }),
      den: fc.integer({ min: 1, max: 10 }),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      tag: fc.constant('bonus' as const),
      num: fc.integer({ min: 1, max: 5 }),
      den: fc.integer({ min: 1, max: 5 }),
    }),
  },
);

/**
 * Interpret a random op list into a **valid** ledger.
 *
 * Validity is established by **replaying the prefix**, not by tracking a running
 * quantity alongside. The two are not the same: a split scales each open lot
 * separately and rounds each at `QTY_SCALE`, so the sum of the scaled lots is
 * not the scale of the summed lots. A parallel counter drifts from the engine by
 * a few units of 10⁻⁸ and produces spurious oversells — testing the generator
 * rather than the engine.
 *
 * A candidate row that the engine rejects is simply dropped: an oversell is a
 * data error the service refuses, not a state the engine is expected to survive,
 * and generating one would only exercise the error path over and over.
 *
 * Dates advance by 0 to 3 days, so same-date collisions are common — which is
 * what makes the order-independence property meaningful.
 */
function build(ops: readonly Op[], gaps: readonly number[]): ReplayTxn[] {
  const txns: ReplayTxn[] = [];
  let date: IsoDate = isoDate('2026-01-01');
  let sequence = 0;

  /** The engine's own answer for the ledger so far. */
  const heldNow = (): bigint => {
    const result = replay(txns, OPTIONS);
    return result.ok ? result.value.totals.quantity.units : 0n;
  };

  /** Append only if the ledger stays valid; otherwise drop the row. */
  const push = (txn: ReplayTxn): void => {
    txns.push(txn);
    if (!replay(txns, OPTIONS).ok) txns.pop();
  };

  const next = (gap: number) => {
    date = addDays(date, gap);
    sequence += 1;
    return {
      id: `t${sequence.toString().padStart(4, '0')}`,
      tradeDate: date,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)),
      fxInstrumentToBase: Rate.one(),
      ratioNum: null,
      ratioDen: null,
      originalAcquiredOn: null,
      fees: Money.zero(INR),
      taxes: Money.zero(INR),
    };
  };

  // Always open with a purchase, so the sequence has something to act on.
  {
    const head = next(0);
    const quantity = Quantity.fromUnits(1_000_000_000n);
    const gross = valueOf(quantity, UnitPrice.fromUnits(10_000_000_000n), INR, 'half_up');
    txns.push({ ...head, kind: 'buy', quantity, grossAmount: gross, netAmountInstrument: neg(gross) });
  }

  ops.forEach((current, index) => {
    const common = next(gaps[index % gaps.length] ?? 1);

    switch (current.tag) {
      case 'buy': {
        const quantity = Quantity.fromUnits(current.units);
        const gross = valueOf(quantity, UnitPrice.fromUnits(current.priceUnits), INR, 'half_up');
        const fees = Money.fromMinor(current.feeMinor, INR);
        // `inv_txn_acquisition_has_cost`: an acquisition with no cost would open
        // a lot with units and no basis, which I-19 forbids.
        if (gross.minor + fees.minor <= 0n) return;
        push({
          ...common,
          kind: 'buy',
          quantity,
          grossAmount: gross,
          fees,
          netAmountInstrument: neg(Money.fromMinor(gross.minor + fees.minor, INR)),
        });
        return;
      }

      case 'sell': {
        const held = heldNow();
        if (held === 0n) return;
        const take = (held * BigInt(current.percent)) / 100n;
        if (take === 0n) return;
        const quantity = Quantity.fromUnits(take);
        const gross = valueOf(quantity, UnitPrice.fromUnits(current.priceUnits), INR, 'half_up');
        const fees = Money.fromMinor(current.feeMinor, INR);
        push({
          ...common,
          kind: 'sell',
          quantity: Quantity.fromUnits(-take),
          grossAmount: gross,
          fees,
          netAmountInstrument: sub(gross, fees),
        });
        return;
      }

      case 'dividend': {
        const gross = Money.fromMinor(current.grossMinor, INR);
        const taxes = Money.fromMinor(
          current.taxMinor > current.grossMinor ? current.grossMinor : current.taxMinor,
          INR,
        );
        push({
          ...common,
          kind: 'dividend',
          quantity: null,
          grossAmount: gross,
          taxes,
          netAmountInstrument: sub(gross, taxes),
        });
        return;
      }

      case 'fee': {
        push({
          ...common,
          kind: 'fee',
          quantity: null,
          grossAmount: null,
          netAmountInstrument: neg(Money.fromMinor(current.minor, INR)),
        });
        return;
      }

      case 'split':
      case 'bonus': {
        push({
          ...common,
          kind: current.tag,
          quantity: null,
          grossAmount: null,
          netAmountInstrument: Money.zero(INR),
          ratioNum: current.num,
          ratioDen: current.den,
        });
        return;
      }
    }
  });

  return txns;
}

const ledger = fc
  .tuple(fc.array(op, { minLength: 1, maxLength: 25 }), fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 1, maxLength: 8 }))
  .map(([ops, gaps]) => build(ops, gaps));

function run(txns: readonly ReplayTxn[]): ReplayResult {
  const result = replay(txns, OPTIONS);
  if (!result.ok) throw new Error(`generated ledger was invalid: ${JSON.stringify(result.error)}`);
  return result.value;
}

const canonical = (r: ReplayResult): string =>
  JSON.stringify(r, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));

// ---------------------------------------------------------------- the laws

describe('lot engine invariants over arbitrary valid ledgers', () => {
  it('I-5 — Σ remaining_quantity over open lots equals the position quantity', () => {
    fc.assert(
      fc.property(ledger, (txns) => {
        const r = run(txns);
        const openUnits = qSum(r.lots.map((l) => l.remainingQuantity));
        expect(openUnits.units).toBe(r.totals.quantity.units);
      }),
    );
  });

  it('I-6 — Σ remaining_cost equals cost_basis EXACTLY, with no tolerance', () => {
    fc.assert(
      fc.property(ledger, (txns) => {
        const r = run(txns);
        const total = r.lots.reduce((acc, l) => acc + l.remainingCost.minor, 0n);
        expect(total).toBe(r.totals.costBasis.minor);
      }),
    );
  });

  it('I-20 — per lot, Σ cost_consumed + remaining_cost = cost_total', () => {
    fc.assert(
      fc.property(ledger, (txns) => {
        const r = run(txns);
        for (const lot of r.lots) {
          const consumed = r.disposals
            .filter((d) => d.lotKey === lot.key)
            .reduce((acc, d) => acc + d.costConsumed.minor, 0n);
          expect(consumed + lot.remainingCost.minor).toBe(lot.costTotal.minor);
        }
      }),
    );
  });

  it('I-19 — units and basis drain together on every lot', () => {
    fc.assert(
      fc.property(ledger, (txns) => {
        for (const lot of run(txns).lots) {
          expect(qIsZero(lot.remainingQuantity)).toBe(lot.remainingCost.minor === 0n);
          expect(lot.remainingQuantity.units).toBeLessThanOrEqual(lot.originalQuantity.units);
          expect(lot.remainingCost.minor).toBeLessThanOrEqual(lot.costTotal.minor);
        }
      }),
    );
  });

  it('I-15 — realized_pnl = proceeds − cost_consumed on every disposal', () => {
    fc.assert(
      fc.property(ledger, (txns) => {
        for (const d of run(txns).disposals) {
          expect(d.realizedPnl.minor).toBe(d.proceeds.minor - d.costConsumed.minor);
          expect(d.costConsumed.minor).toBeGreaterThanOrEqual(0n);
          expect(d.quantity.units).toBeGreaterThan(0n);
          expect(d.holdingDays).toBeGreaterThanOrEqual(0);
        }
      }),
    );
  });

  it('allocates the net proceeds of each disposal so they sum back exactly', () => {
    fc.assert(
      fc.property(ledger, (txns) => {
        const r = run(txns);
        // Group disposals by the transaction that produced them; each group must
        // sum to that row's own net proceeds.
        const byTxn = new Map<string, typeof r.disposals>();
        for (const d of r.disposals) {
          byTxn.set(d.closedByTxnId, [...(byTxn.get(d.closedByTxnId) ?? []), d]);
        }
        for (const [txnId, group] of byTxn) {
          const source = txns.find((t) => t.id === txnId)!;
          const netProceeds = sub(sub(source.grossAmount!, source.fees), source.taxes);
          const allocated = sum(group.map((d) => d.proceeds), INR);
          expect(toDbString(allocated)).toBe(toDbString(netProceeds));
        }
      }),
    );
  });

  it('never lets a position go negative — shorting is out of scope', () => {
    fc.assert(
      fc.property(ledger, (txns) => {
        const r = run(txns);
        expect(r.totals.quantity.units).toBeGreaterThanOrEqual(0n);
        expect(r.totals.costBasis.minor).toBeGreaterThanOrEqual(0n);
      }),
    );
  });

  it('accrues income gross, so income − fees − taxes is the cash actually received', () => {
    fc.assert(
      fc.property(ledger, (txns) => {
        const r = run(txns);
        const declared = txns
          .filter((t) => t.kind === 'dividend' || t.kind === 'interest')
          .reduce((acc, t) => acc + t.grossAmount!.minor, 0n);
        expect(r.totals.incomeTotal.minor).toBe(declared);
      }),
    );
  });
});

describe('determinism', () => {
  it('replay(txns) === replay(txns)', () => {
    fc.assert(
      fc.property(ledger, (txns) => {
        expect(canonical(run(txns))).toBe(canonical(run(txns)));
      }),
    );
  });

  it('replay(shuffle(txns)) === replay(txns) — array order is not an input', () => {
    fc.assert(
      fc.property(ledger, fc.integer({ min: 1, max: 1_000_000 }), (txns, seed) => {
        // A deterministic shuffle driven by the seed, so a failure reproduces.
        const shuffled = [...txns]
          .map((t, i) => ({ t, k: (i * 2654435761 + seed) % 1_000_003 }))
          .sort((a, b) => a.k - b.k)
          .map(({ t }) => t);
        expect(canonical(run(shuffled))).toBe(canonical(run(txns)));
      }),
    );
  });

  it('leaves the input array untouched', () => {
    fc.assert(
      fc.property(ledger, (txns) => {
        const before = txns.map((t) => t.id).join(',');
        run(txns);
        expect(txns.map((t) => t.id).join(',')).toBe(before);
      }),
    );
  });
});

describe('UnitPrice laws', () => {
  const positiveMinor = fc.bigInt({ min: 1n, max: 1_000_000_000_000n });
  // From 0.01 units upward: below that, `perUnit` of a large amount exceeds
  // NUMERIC(20,8) and correctly throws rather than silently wrapping.
  const positiveUnits = fc.bigInt({ min: 1_000_000n, max: 1_000_000_000_000n });

  it('consuming a lot in slices, with the last taking the remainder, sums back exactly', () => {
    fc.assert(
      fc.property(
        positiveMinor,
        positiveUnits,
        fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 8 }),
        (costMinor, totalUnits, percents) => {
          let remainingCost = Money.fromMinor(costMinor, INR);
          let remainingQty = Quantity.fromUnits(totalUnits);
          let consumed = 0n;

          for (let i = 0; i < percents.length && remainingQty.units > 0n; i += 1) {
            const isLast = i === percents.length - 1;
            const takeUnits = isLast
              ? remainingQty.units
              : (remainingQty.units * BigInt(percents[i]!)) / 100n;
            if (takeUnits === 0n) continue;
            const take = Quantity.fromUnits(takeUnits);
            const drains = takeUnits === remainingQty.units;
            const cost = drains ? remainingCost : mulQtyRatio(remainingCost, take, remainingQty, 'half_up');
            consumed += cost.minor;
            remainingCost = Money.fromMinor(remainingCost.minor - cost.minor, INR);
            remainingQty = Quantity.fromUnits(remainingQty.units - takeUnits);
          }

          expect(consumed + remainingCost.minor).toBe(costMinor);
          expect(remainingCost.minor).toBeGreaterThanOrEqual(0n);
        },
      ),
    );
  });

  it('valueOf(quantity, perUnit(money, quantity)) recovers the amount within one minor unit', () => {
    fc.assert(
      fc.property(positiveMinor, positiveUnits, (costMinor, qtyUnits) => {
        const amount = Money.fromMinor(costMinor, INR);
        const quantity = Quantity.fromUnits(qtyUnits);
        const back = valueOf(quantity, perUnit(amount, quantity, 'half_up'), INR, 'half_up');
        // Not exact, and deliberately not asserted as exact: a per-unit rate is
        // a lossy intermediate, which is precisely why the engine holds money
        // and derives the rate rather than the other way round.
        const drift = back.minor - amount.minor;
        expect(drift <= 1n && drift >= -1n).toBe(true);
      }),
    );
  });
});
