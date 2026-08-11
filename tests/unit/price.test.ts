/**
 * `UnitPrice` (TESTING.md §3, INVESTMENT-DOMAIN.md §5).
 *
 * The headline case is edge case 28: a NAV of `123.45678900` survives a round
 * trip through `UnitPrice`, and **the same value through `Money` is asserted to
 * lose precision**. Without that second assertion the first would pass against
 * an implementation that silently truncated, because nothing would prove the
 * test could detect truncation at all.
 */

import { describe, expect, it } from 'vitest';

import { Money, currency, toDbString } from '@/lib/decimal/money';
import { Quantity, qToDbString } from '@/lib/decimal/quantity';
import {
  PRICE_MAX_UNITS,
  PRICE_SCALE,
  UnitPrice,
  mulQtyRatio,
  pCmp,
  pEq,
  pIsPositive,
  pIsZero,
  pScale,
  pToDbString,
  pToNumber,
  perUnit,
  valueOf,
} from '@/lib/decimal/price';

const INR = currency('INR');

describe('UnitPrice construction', () => {
  it('round-trips a NUMERIC(20,8) string exactly', () => {
    expect(pToDbString(UnitPrice.fromDbString('123.45678900'))).toBe('123.45678900');
    expect(pToDbString(UnitPrice.fromDbString('0.00000001'))).toBe('0.00000001');
    expect(pToDbString(UnitPrice.fromDbString('-42.5'))).toBe('-42.50000000');
  });

  it('pads and normalises like the other scaled types', () => {
    expect(pToDbString(UnitPrice.of('100'))).toBe('100.00000000');
    expect(pToDbString(UnitPrice.zero())).toBe('0.00000000');
  });

  it('rejects more than eight decimals rather than truncating', () => {
    const parsed = UnitPrice.parseUserInput('1.123456789');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.code).toBe('too_many_decimals');
  });

  it('rejects malformed grouping, exactly as Money does', () => {
    const parsed = UnitPrice.parseUserInput('1,5');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.code).toBe('malformed');
  });

  it('accepts the NUMERIC(20,8) boundary and refuses to exceed it', () => {
    expect(() => UnitPrice.fromUnits(PRICE_MAX_UNITS)).not.toThrow();
    expect(() => UnitPrice.fromUnits(PRICE_MAX_UNITS + 1n)).toThrow(RangeError);
    expect(() => UnitPrice.fromUnits(-PRICE_MAX_UNITS - 1n)).toThrow(RangeError);
  });

  it('throws on a database value it cannot parse — that is schema drift, not user error', () => {
    expect(() => UnitPrice.fromDbString('not a number')).toThrow(TypeError);
  });
});

describe('edge case 28 — per-unit precision survives the read boundary', () => {
  const NAV = '123.45678900';

  it('keeps every digit through UnitPrice', () => {
    expect(pToDbString(UnitPrice.fromDbString(NAV))).toBe(NAV);
  });

  it('LOSES precision through Money — proving this test can detect truncation', () => {
    // Money is scale 4. Reading the same NAV into it drops the last four digits.
    // The parse does not silently truncate — it refuses — which is the stronger
    // guarantee, and either way the value cannot survive as a Money.
    const asMoney = Money.parseUserInput(NAV, INR);
    expect(asMoney.ok).toBe(false);
    if (!asMoney.ok) expect(asMoney.error.code).toBe('too_many_decimals');

    // And the value that *would* result from a scale-4 read is not the NAV.
    const truncated = Money.fromMinor(UnitPrice.fromDbString(NAV).units / 10_000n, INR);
    expect(toDbString(truncated)).toBe('123.4567');
    expect(toDbString(truncated)).not.toBe('123.45678900');
  });
});

describe('valueOf — quantity × price → Money', () => {
  it('multiplies at full width and rounds once', () => {
    const value = valueOf(Quantity.of('100'), UnitPrice.of('123.45678900'), INR, 'half_up');
    // 100 × 123.456789 = 12345.6789 exactly at scale 4.
    expect(toDbString(value)).toBe('12345.6789');
  });

  it('rounds half away from zero at the .5 boundary, in both signs', () => {
    // 1 × 0.00005 → 0.0001 at scale 4 (a tie, rounded away from zero).
    expect(toDbString(valueOf(Quantity.of('1'), UnitPrice.of('0.00005'), INR, 'half_up'))).toBe('0.0001');
    expect(toDbString(valueOf(Quantity.of('-1'), UnitPrice.of('0.00005'), INR, 'half_up'))).toBe('-0.0001');
    // half_even sends the same tie to the even neighbour, which is zero. There
    // is no negative zero in a bigint, so both signs format as "0.0000".
    expect(toDbString(valueOf(Quantity.of('1'), UnitPrice.of('0.00005'), INR, 'half_even'))).toBe('0.0000');
    expect(toDbString(valueOf(Quantity.of('-1'), UnitPrice.of('0.00005'), INR, 'half_even'))).toBe('0.0000');
  });

  it('floor and ceil are directional on the number line, not in magnitude', () => {
    expect(toDbString(valueOf(Quantity.of('1'), UnitPrice.of('0.00009'), INR, 'floor'))).toBe('0.0000');
    expect(toDbString(valueOf(Quantity.of('-1'), UnitPrice.of('0.00001'), INR, 'floor'))).toBe('-0.0001');
    expect(toDbString(valueOf(Quantity.of('1'), UnitPrice.of('0.00001'), INR, 'ceil'))).toBe('0.0001');
    expect(toDbString(valueOf(Quantity.of('-1'), UnitPrice.of('0.00009'), INR, 'ceil'))).toBe('0.0000');
  });

  it('handles a fractional mutual-fund holding', () => {
    // 1234.5678 units at a NAV of 87.65432100.
    // 1234.5678 × 87.654321 = 108215.2022374638 → 108215.2022 at scale 4.
    const value = valueOf(Quantity.of('1234.5678'), UnitPrice.of('87.654321'), INR, 'half_up');
    expect(toDbString(value)).toBe('108215.2022');
  });

  it('returns zero for a zero quantity without throwing', () => {
    expect(toDbString(valueOf(Quantity.zero(), UnitPrice.of('100'), INR, 'half_up'))).toBe('0.0000');
  });
});

describe('perUnit — Money ÷ quantity → UnitPrice', () => {
  it('derives the per-unit cost at scale 8', () => {
    expect(pToDbString(perUnit(Money.of('10050', INR), Quantity.of('100'), 'half_up'))).toBe('100.50000000');
  });

  it('keeps eight significant decimals where Money would keep four', () => {
    // ₹1000 over 3 units = 333.33333333…
    expect(pToDbString(perUnit(Money.of('1000', INR), Quantity.of('3'), 'half_up'))).toBe('333.33333333');
  });

  it('throws on a zero quantity rather than returning a wrong number', () => {
    expect(() => perUnit(Money.of('100', INR), Quantity.zero(), 'half_up')).toThrow(RangeError);
  });

  it('is the inverse of valueOf when the division is exact', () => {
    const qty = Quantity.of('40');
    const price = UnitPrice.of('150');
    const value = valueOf(qty, price, INR, 'half_up');
    expect(pEq(perUnit(value, qty, 'half_up'), price)).toBe(true);
  });
});

describe('mulQtyRatio — the exact proportional share', () => {
  it('takes the share of a cost without materialising a per-unit rate', () => {
    // ₹10,050 of basis over 100 units; 40 units consumed → ₹4,020 exactly.
    const consumed = mulQtyRatio(
      Money.of('10050', INR),
      Quantity.of('40'),
      Quantity.of('100'),
      'half_up',
    );
    expect(toDbString(consumed)).toBe('4020.0000');
  });

  it('throws on a zero denominator', () => {
    expect(() => mulQtyRatio(Money.of('1', INR), Quantity.of('1'), Quantity.zero(), 'half_up')).toThrow(
      RangeError,
    );
  });

  it('preserves the whole amount when the whole quantity is taken', () => {
    const cost = Money.of('333.3333', INR);
    const qty = Quantity.of('7');
    expect(toDbString(mulQtyRatio(cost, qty, qty, 'half_up'))).toBe('333.3333');
  });

  /**
   * The property that matters (TESTING.md §3): consuming a lot in any sequence
   * of partial slices, with the **final slice taking the remainder verbatim**,
   * sums back to the original exactly. This is the shape the FIFO engine uses,
   * and it is what makes invariant I-20 exact rather than approximate.
   */
  it('sums back exactly when the last slice takes the remainder verbatim', () => {
    const slices = ['7', '11', '13', '19'];
    const total = Money.of('1000', INR);
    let remainingCost = total;
    let remainingQty = Quantity.of('50');
    const consumed: bigint[] = [];

    for (let i = 0; i < slices.length; i += 1) {
      const take = Quantity.of(slices[i]!);
      const isLast = i === slices.length - 1;
      const cost = isLast
        ? remainingCost
        : mulQtyRatio(remainingCost, take, remainingQty, 'half_up');
      consumed.push(cost.minor);
      remainingCost = Money.fromMinor(remainingCost.minor - cost.minor, INR);
      remainingQty = Quantity.fromUnits(remainingQty.units - take.units);
    }

    expect(qToDbString(remainingQty)).toBe('0.00000000');
    expect(consumed.reduce((a, b) => a + b, 0n)).toBe(total.minor);
    expect(remainingCost.minor).toBe(0n);
  });
});

describe('comparison, scaling and output', () => {
  it('compares by value', () => {
    expect(pCmp(UnitPrice.of('1'), UnitPrice.of('2'))).toBe(-1);
    expect(pCmp(UnitPrice.of('2'), UnitPrice.of('1'))).toBe(1);
    expect(pCmp(UnitPrice.of('2'), UnitPrice.of('2.00000000'))).toBe(0);
    expect(pIsZero(UnitPrice.zero())).toBe(true);
    expect(pIsPositive(UnitPrice.of('0.00000001'))).toBe(true);
    expect(pIsPositive(UnitPrice.zero())).toBe(false);
  });

  it('scales a displayed price by a split ratio', () => {
    expect(pToDbString(pScale(UnitPrice.of('100'), 1n, 5n, 'half_up'))).toBe('20.00000000');
    expect(pToDbString(pScale(UnitPrice.of('100'), 5n, 1n, 'half_up'))).toBe('500.00000000');
    expect(() => pScale(UnitPrice.of('100'), 1n, 0n, 'half_up')).toThrow(RangeError);
  });

  it('converts to a number for display, and refuses above MAX_SAFE_INTEGER', () => {
    expect(pToNumber(UnitPrice.of('123.45678900'))).toBeCloseTo(123.456789, 8);
    expect(() => pToNumber(UnitPrice.fromUnits(BigInt(Number.MAX_SAFE_INTEGER) + 1n))).toThrow(RangeError);
  });

  it('states its scale where the schema does', () => {
    expect(PRICE_SCALE).toBe(8);
  });
});
