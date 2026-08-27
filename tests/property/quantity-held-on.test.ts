/**
 * Invariant **I-46** — `quantityHeldOn(i, T)` applies **every** corporate-action
 * ratio in `(trade_date, T]`
 * ([INVESTMENT-DOMAIN.md §8.1](../../docs/INVESTMENT-DOMAIN.md#81-portfolio-growth-over-time),
 * [TESTING.md §6.7](../../docs/TESTING.md)).
 *
 * A **property** test rather than a table of cases, because this is the one
 * genuinely new algorithm in Phase 6.11 and the one place a plain `Σ quantity`
 * looks right and is wrong. A split and a bonus carry `quantity IS NULL` and a
 * ratio, so a running sum ignores them entirely and reports the pre-split
 * quantity for ever after — and a table test only catches that if somebody
 * thought to put a split before the date they happened to assert.
 *
 * The law, stated exactly:
 *
 * ```
 * quantityHeldOn(timeline, T) === replay(txns dated <= T).totals.quantity
 * ```
 *
 * for **every** `T`, over ledgers containing splits, bonuses and reverse splits
 * in any order with disposals before and after each. `replay()` bounded at `T`
 * is exact by construction — it is the same fold `positions.quantity` comes
 * from — so this is the strongest available reference, and it is what stops the
 * Net Worth page and the Investments page disagreeing about the same holding.
 *
 * Every assertion is **exact**. A tolerance would pass against a form that
 * rounds the sum of the lots instead of the lots of the sum, which differs by
 * units of 10⁻⁸ on a reverse split that does not divide evenly.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { addDays, compareDates, isoDate, type IsoDate } from '@/lib/date';
import { Money, currency, neg, sub } from '@/lib/decimal/money';
import { Quantity, qToDbString } from '@/lib/decimal/quantity';
import { Rate } from '@/lib/decimal/rate';
import { UnitPrice, valueOf } from '@/lib/decimal/price';
import { replay, type ReplayTxn } from '@/server/domain/lots/engine';
import { naiveQuantitySum, quantityHeldOn } from '@/server/domain/lots/quantity';

const INR = currency('INR');
const OPTIONS = { method: 'fifo' as const, currency: INR, baseCurrency: INR };

const held = (txns: readonly ReplayTxn[], on: IsoDate): string => {
  const all = replay(txns, OPTIONS);
  if (!all.ok) throw new Error(`replay failed: ${all.error.kind}`);
  return qToDbString(quantityHeldOn(all.value.quantityTimeline, on));
};

/** The reference: a replay over exactly the rows dated on or before `on`. */
const boundedReplay = (txns: readonly ReplayTxn[], on: IsoDate): string => {
  const bounded = replay(
    txns.filter((t) => compareDates(t.tradeDate, on) <= 0),
    OPTIONS,
  );
  if (!bounded.ok) throw new Error(`bounded replay failed: ${bounded.error.kind}`);
  return qToDbString(bounded.value.totals.quantity);
};

// --------------------------------------------------------------- generators

type Op =
  | { readonly tag: 'buy'; readonly units: bigint }
  | { readonly tag: 'sell'; readonly percent: number }
  | { readonly tag: 'split'; readonly num: number; readonly den: number }
  | { readonly tag: 'bonus'; readonly num: number; readonly den: number };

const op: fc.Arbitrary<Op> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.record({
      tag: fc.constant('buy' as const),
      units: fc.bigInt({ min: 1_000_000n, max: 1_000_000_000_000n }),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      tag: fc.constant('sell' as const),
      percent: fc.integer({ min: 1, max: 100 }),
    }),
  },
  {
    // `num < den` is a REVERSE split, which is where the rounding bites.
    weight: 3,
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
 * Validity is established by replaying the prefix rather than by tracking a
 * running quantity alongside — a parallel counter drifts from the engine on
 * exactly the reverse splits this test exists to cover, and would generate
 * spurious oversells that test the generator rather than the engine.
 *
 * Dates advance by 0 to 2 days, so same-date collisions between a trade and a
 * corporate action are common. Those are the interesting ones: `kindRank` makes
 * the action replay last that day, so the checkpoint for the date must already
 * include it.
 */
function build(ops: readonly Op[], gaps: readonly number[]): ReplayTxn[] {
  const txns: ReplayTxn[] = [];
  let date: IsoDate = isoDate('2026-01-01');
  let sequence = 0;

  const heldNow = (): bigint => {
    const result = replay(txns, OPTIONS);
    return result.ok ? result.value.totals.quantity.units : 0n;
  };

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
      quantity: null,
      grossAmount: null,
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
        const gross = valueOf(quantity, UnitPrice.fromUnits(10_000_000_000n), INR, 'half_up');
        if (gross.minor <= 0n) return;
        push({ ...common, kind: 'buy', quantity, grossAmount: gross, netAmountInstrument: neg(gross) });
        return;
      }
      case 'sell': {
        const owned = heldNow();
        if (owned === 0n) return;
        const take = (owned * BigInt(current.percent)) / 100n;
        if (take === 0n) return;
        const gross = valueOf(
          Quantity.fromUnits(take),
          UnitPrice.fromUnits(12_000_000_000n),
          INR,
          'half_up',
        );
        push({
          ...common,
          kind: 'sell',
          quantity: Quantity.fromUnits(-take),
          grossAmount: gross,
          netAmountInstrument: sub(gross, Money.zero(INR)),
        });
        return;
      }
      default: {
        push({
          ...common,
          kind: current.tag,
          ratioNum: current.num,
          ratioDen: current.den,
          netAmountInstrument: Money.zero(INR),
        });
        return;
      }
    }
  });

  return txns;
}

/** Every trade date, plus the day either side, plus a date before and after the ledger. */
function probeDates(txns: readonly ReplayTxn[]): IsoDate[] {
  const dates = new Set<string>();
  for (const txn of txns) {
    dates.add(txn.tradeDate);
    dates.add(addDays(txn.tradeDate, -1));
    dates.add(addDays(txn.tradeDate, 1));
  }
  dates.add(isoDate('2025-06-30'));
  dates.add(isoDate('2027-06-30'));
  return [...dates].map((d) => isoDate(d));
}

const ledger = fc
  .tuple(fc.array(op, { minLength: 1, maxLength: 14 }), fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 1, maxLength: 6 }))
  .map(([ops, gaps]) => build(ops, gaps));

// ------------------------------------------------------------------- the law

describe('I-46 — quantityHeldOn over an arbitrary ledger', () => {
  it('equals a replay bounded at the same date, at every date', () => {
    fc.assert(
      fc.property(ledger, (txns) => {
        for (const on of probeDates(txns)) {
          expect(held(txns, on), `at ${on}`).toBe(boundedReplay(txns, on));
        }
      }),
      { numRuns: 120 },
    );
  });

  it('agrees with the position total at the last trade date', () => {
    fc.assert(
      fc.property(ledger, (txns) => {
        const all = replay(txns, OPTIONS);
        if (!all.ok) throw new Error('replay failed');
        const last = all.value.totals.lastTradeOn!;
        expect(held(txns, last)).toBe(qToDbString(all.value.totals.quantity));
      }),
      { numRuns: 120 },
    );
  });

  it('is zero before the first trade, and never negative', () => {
    fc.assert(
      fc.property(ledger, (txns) => {
        expect(held(txns, isoDate('2025-06-30'))).toBe('0.00000000');
        for (const on of probeDates(txns)) {
          expect(Number(held(txns, on))).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 60 },
    );
  });

  it('is monotone in the date only where no disposal or reverse split intervenes', () => {
    // Stated as the weaker true property rather than the tempting false one:
    // quantity is NOT monotone, and a series-smoothing "fix" that assumed it was
    // would be wrong after every sell (SCHEMA.md §12, non-invariants).
    fc.assert(
      fc.property(ledger, (txns) => {
        const buysOnly = txns.filter((t) => t.kind === 'buy');
        if (buysOnly.length < 2) return;
        const dates = probeDates(buysOnly).sort(compareDates);
        let previous = -1;
        for (const on of dates) {
          const now = Number(held(buysOnly, on));
          expect(now).toBeGreaterThanOrEqual(previous);
          previous = now;
        }
      }),
      { numRuns: 60 },
    );
  });
});

// ---------------------------------------------------- the wrong form, proved

describe('I-46 — the naive form is wrong, and this is where', () => {
  const buyOf = (on: string, qty: string, id: string): ReplayTxn => {
    const quantity = Quantity.of(qty);
    const gross = valueOf(quantity, UnitPrice.of('100'), INR, 'half_up');
    return {
      id,
      kind: 'buy',
      tradeDate: isoDate(on),
      createdAt: new Date(`${on}T00:00:00Z`),
      quantity,
      grossAmount: gross,
      fees: Money.zero(INR),
      taxes: Money.zero(INR),
      netAmountInstrument: neg(gross),
      ratioNum: null,
      ratioDen: null,
      originalAcquiredOn: null,
      fxInstrumentToBase: Rate.one(),
    };
  };

  const actionOf = (
    on: string,
    kind: 'split' | 'bonus',
    num: number,
    den: number,
    id: string,
  ): ReplayTxn => ({
    id,
    kind,
    tradeDate: isoDate(on),
    createdAt: new Date(`${on}T00:00:00Z`),
    quantity: null,
    grossAmount: null,
    fees: Money.zero(INR),
    taxes: Money.zero(INR),
    netAmountInstrument: Money.zero(INR),
    ratioNum: num,
    ratioDen: den,
    originalAcquiredOn: null,
    fxInstrumentToBase: Rate.one(),
  });

  it('a 2:1 split doubles the holding; Σ quantity does not notice', () => {
    const txns = [buyOf('2026-01-05', '100', 't1'), actionOf('2026-03-01', 'split', 2, 1, 't2')];

    expect(held(txns, isoDate('2026-02-28'))).toBe('100.00000000');
    expect(held(txns, isoDate('2026-03-01'))).toBe('200.00000000');
    expect(held(txns, isoDate('2026-06-01'))).toBe('200.00000000');

    // The form this function exists to avoid, reporting the pre-split figure
    // for ever after.
    expect(qToDbString(naiveQuantitySum(txns, isoDate('2026-06-01')))).toBe('100.00000000');
  });

  it('a 1:1 bonus doubles it too, and the ratio is units-per-unit-held', () => {
    const txns = [buyOf('2026-01-05', '100', 't1'), actionOf('2026-03-01', 'bonus', 1, 1, 't2')];
    expect(held(txns, isoDate('2026-03-01'))).toBe('200.00000000');
  });

  it('a 1:3 reverse split divides it, per lot', () => {
    const txns = [
      buyOf('2026-01-05', '100', 't1'),
      buyOf('2026-01-06', '100', 't2'),
      actionOf('2026-03-01', 'split', 1, 3, 't3'),
    ];
    // 100 → 33.33333333 per LOT, twice. Not 200 ÷ 3 = 66.66666667, which is what
    // scaling the aggregate would give and what would disagree with `positions`.
    expect(held(txns, isoDate('2026-03-01'))).toBe('66.66666666');
    expect(held(txns, isoDate('2026-03-01'))).toBe(boundedReplay(txns, isoDate('2026-03-01')));
  });

  it('a disposal before the action and one after both land correctly', () => {
    const sellOf = (on: string, qty: string, id: string): ReplayTxn => {
      const quantity = Quantity.of(qty);
      const gross = valueOf(quantity, UnitPrice.of('150'), INR, 'half_up');
      return {
        id,
        kind: 'sell',
        tradeDate: isoDate(on),
        createdAt: new Date(`${on}T00:00:00Z`),
        quantity: Quantity.fromUnits(-quantity.units),
        grossAmount: gross,
        fees: Money.zero(INR),
        taxes: Money.zero(INR),
        netAmountInstrument: gross,
        ratioNum: null,
        ratioDen: null,
        originalAcquiredOn: null,
        fxInstrumentToBase: Rate.one(),
      };
    };

    const txns = [
      buyOf('2026-01-05', '100', 't1'),
      sellOf('2026-02-01', '40', 't2'),
      actionOf('2026-03-01', 'split', 2, 1, 't3'),
      sellOf('2026-04-01', '50', 't4'),
    ];

    expect(held(txns, isoDate('2026-01-31'))).toBe('100.00000000');
    expect(held(txns, isoDate('2026-02-01'))).toBe('60.00000000');
    expect(held(txns, isoDate('2026-03-01'))).toBe('120.00000000');
    expect(held(txns, isoDate('2026-04-01'))).toBe('70.00000000');

    for (const on of ['2026-01-31', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01']) {
      expect(held(txns, isoDate(on)), on).toBe(boundedReplay(txns, isoDate(on)));
    }
  });

  it('a corporate action sharing a date with a buy is already applied at that date', () => {
    // `kindRank` replays the action AFTER the same-day trade, so the checkpoint
    // for that date must include the buy AND the split. Recording the checkpoint
    // per transaction rather than per date would report the pre-split figure for
    // anyone asking about that day.
    const txns = [
      buyOf('2026-01-05', '100', 't1'),
      buyOf('2026-03-01', '50', 't2'),
      actionOf('2026-03-01', 'split', 2, 1, 't3'),
    ];
    expect(held(txns, isoDate('2026-03-01'))).toBe('300.00000000');
    expect(held(txns, isoDate('2026-03-01'))).toBe(boundedReplay(txns, isoDate('2026-03-01')));
  });
});
