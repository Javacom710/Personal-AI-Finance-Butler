import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { Money, MONEY_SCALE, currency, toDbString } from '@/lib/decimal/money';
import { Quantity, QTY_SCALE, qToDbString } from '@/lib/decimal/quantity';
import { UnitPrice, PRICE_SCALE, pToDbString } from '@/lib/decimal/price';
import { Rate, RATE_SCALE, rToDbString } from '@/lib/decimal/rate';
import {
  projectMoney,
  projectOptional,
  projectPrice,
  projectQuantity,
  projectRate,
} from '@/lib/format/json-projection';

/**
 * Invariant **I-53** — *an exact value crosses a JSON boundary without losing a
 * digit* ([ADR-36](../../docs/DECISIONS.md#adr-36--exact-values-cross-a-json-boundary-as-a-tagged-string-projection-never-as-a-json-number)).
 *
 * The failure this guards is a single plausible line — `Number(m.minor)` in a
 * tool projection — and it is invisible until the figure is large enough to
 * matter, at which point it is wrong in a financial answer rather than in a
 * test. So precision is asserted at the boundary, over generated values that
 * deliberately exceed `Number.MAX_SAFE_INTEGER`.
 */

const INR = currency('INR');

describe('I-53 — Money projects exactly', () => {
  it('renders at MONEY_SCALE with the currency attached', () => {
    expect(projectMoney(Money.of('1250.50', INR))).toEqual({
      kind: 'money',
      amount: '1250.5000',
      currency: 'INR',
      scale: MONEY_SCALE,
    });
  });

  it('keeps trailing zeros, so the scale is visible in the digits', () => {
    expect(projectMoney(Money.of('1121', INR)).amount).toBe('1121.0000');
  });

  it('renders a negative figure with a minus sign, never parentheses', () => {
    expect(projectMoney(Money.of('-42.25', INR)).amount).toBe('-42.2500');
  });

  it('agrees with toDbString — same digits the database holds', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 19n), max: 10n ** 19n }), (minor) => {
        const money = Money.fromMinor(minor, INR);
        expect(projectMoney(money).amount).toBe(toDbString(money));
      }),
    );
  });

  it('round-trips through fromDbString above 2^53, where Number would fail', () => {
    // 10^15 rupees at scale 4 is 10^19 minor units — three orders of magnitude
    // past MAX_SAFE_INTEGER. `Number()` would silently round this.
    const huge = Money.fromMinor(9_007_199_254_740_993_000n, INR);
    const projected = projectMoney(huge);
    expect(Money.fromDbString(projected.amount, INR).minor).toBe(huge.minor);
    expect(Number(projected.amount)).not.toBe(Number(huge.minor.toString()));
  });
});

describe('I-53 — Quantity, UnitPrice and Rate project exactly', () => {
  it('renders a Quantity at QTY_SCALE and tags it as one', () => {
    const q = Quantity.of('10.5');
    expect(projectQuantity(q)).toEqual({ kind: 'quantity', units: '10.50000000', scale: QTY_SCALE });
    expect(projectQuantity(q).units).toBe(qToDbString(q));
  });

  it('renders a UnitPrice at PRICE_SCALE and tags it distinctly', () => {
    const p = UnitPrice.of('1121');
    expect(projectPrice(p)).toEqual({ kind: 'price', units: '1121.00000000', scale: PRICE_SCALE });
    expect(projectPrice(p).units).toBe(pToDbString(p));
  });

  it('distinguishes a price from a quantity, which their shapes cannot', () => {
    // Both are `{ units: bigint }` at scale 8. Only the call site knows which is
    // which, and the tag is how that knowledge reaches the consumer — the
    // reason this is a set of explicit functions, not a structural walker.
    const sameDigits = '7.00000000';
    expect(projectQuantity(Quantity.of('7')).units).toBe(sameDigits);
    expect(projectPrice(UnitPrice.of('7')).units).toBe(sameDigits);
    expect(projectQuantity(Quantity.of('7')).kind).not.toBe(projectPrice(UnitPrice.of('7')).kind);
  });

  it('renders a Rate at RATE_SCALE as a fraction, not a percentage', () => {
    const r = Rate.of('0.0725');
    expect(projectRate(r)).toEqual({ kind: 'rate', value: '0.0725000000', scale: RATE_SCALE });
    expect(projectRate(r).value).toBe(rToDbString(r));
  });

  it('preserves every digit of a full-width quantity', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 27n), max: 10n ** 27n }), (units) => {
        const q = Quantity.fromUnits(units);
        expect(Quantity.fromDbString(projectQuantity(q).units).units).toBe(units);
      }),
    );
  });

  it('preserves the precision the market-data path actually produces', () => {
    // The figure I-49 tracks end to end: a provider close of 1629.80004883.
    expect(projectPrice(UnitPrice.of('1629.80004883')).units).toBe('1629.80004883');
  });
});

describe('I-53 — the projection is JSON-safe and deterministic', () => {
  const values = [
    projectMoney(Money.of('1250.50', INR)),
    projectQuantity(Quantity.of('10.5')),
    projectPrice(UnitPrice.of('1121')),
    projectRate(Rate.of('0.0725')),
  ];

  it('survives JSON.stringify, which the domain types do not', () => {
    // The premise of the whole module: every one of these throws undecorated.
    expect(() => JSON.stringify(Money.of('1', INR))).toThrow(TypeError);
    expect(() => JSON.stringify(values)).not.toThrow();
  });

  it('contains no JSON number anywhere a figure lives', () => {
    // `scale` is a number and is meant to be; the digits never are. A number
    // here would be an IEEE-754 double before any consumer saw it.
    const json = JSON.stringify(values);
    expect(json).not.toMatch(/"(amount|units|value)":\s*-?\d/);
    for (const v of values) {
      const digits = 'amount' in v ? v.amount : 'units' in v ? v.units : v.value;
      expect(typeof digits).toBe('string');
    }
  });

  it('is byte-stable across repeated projection of the same value', () => {
    const once = JSON.stringify(projectMoney(Money.of('1250.50', INR)));
    const twice = JSON.stringify(projectMoney(Money.of('1250.50', INR)));
    expect(once).toBe(twice);
    expect(once).toBe('{"kind":"money","amount":"1250.5000","currency":"INR","scale":4}');
  });

  it('carries the scale, so a consumer never has to infer it', () => {
    expect(values.map((v) => v.scale)).toEqual([MONEY_SCALE, QTY_SCALE, PRICE_SCALE, RATE_SCALE]);
  });
});

describe('I-53 — adversarial values survive the boundary', () => {
  it('renders the maximum a NUMERIC(20,4) can hold, exactly', () => {
    // 10^20 - 1 minor units. `Number()` would lose 4 digits of it silently.
    const max = Money.fromMinor(10n ** 20n - 1n, INR);
    const projected = projectMoney(max);
    expect(projected.amount).toBe('9999999999999999.9999');
    expect(Money.fromDbString(projected.amount, INR).minor).toBe(max.minor);
  });

  it('renders the most negative figure without dropping the sign', () => {
    const min = Money.fromMinor(-(10n ** 20n - 1n), INR);
    expect(projectMoney(min).amount).toBe('-9999999999999999.9999');
    expect(Money.fromDbString(projectMoney(min).amount, INR).minor).toBe(min.minor);
  });

  it('has no negative zero to be ambiguous about', () => {
    // -0n === 0n in bigint, so the float hazard cannot arise here. Asserted
    // rather than assumed, because it is exactly the kind of thing that would
    // change if anyone routed this through a number.
    expect(projectMoney(Money.fromMinor(-0n, INR)).amount).toBe('0.0000');
    expect(projectMoney(Money.fromMinor(0n, INR)).amount).toBe('0.0000');
  });

  it('keeps identical digits in different currencies distinguishable', () => {
    // The reason the currency travels inside the projection rather than beside
    // it: ₹1,000 and $1,000 are the same digits and not the same money.
    const rupees = projectMoney(Money.of('1000', INR));
    const dollars = projectMoney(Money.of('1000', currency('USD')));
    expect(rupees.amount).toBe(dollars.amount);
    expect(rupees.currency).not.toBe(dollars.currency);
    expect(JSON.stringify(rupees)).not.toBe(JSON.stringify(dollars));
  });

  it('cannot be re-read as a different scale', () => {
    // Every projection states its own scale, so a consumer never infers one
    // from the digit count. 1.5 at scale 4 and 1.5 at scale 8 are the same
    // quantity of money and price respectively, and say so.
    expect(projectMoney(Money.of('1.5', INR))).toMatchObject({ amount: '1.5000', scale: 4 });
    expect(projectPrice(UnitPrice.of('1.5'))).toMatchObject({ units: '1.50000000', scale: 8 });
    expect(projectRate(Rate.of('1.5'))).toMatchObject({ value: '1.5000000000', scale: 10 });
  });
});

describe('I-53 — absence stays absent', () => {
  it('projects null as null, never as zero', () => {
    // FINANCIAL-DOMAIN.md §10.3. A boundary is where this is most easily lost:
    // "no value" and "nought" serialise to the same thing the moment someone
    // reaches for a `?? 0`.
    expect(projectOptional(null, projectMoney)).toBeNull();
    expect(projectOptional(Money.of('0', INR), projectMoney)).toEqual({
      kind: 'money',
      amount: '0.0000',
      currency: 'INR',
      scale: MONEY_SCALE,
    });
  });

  it('keeps null explicit through JSON rather than dropping the key', () => {
    expect(JSON.stringify({ xirr: projectOptional(null, projectRate) })).toBe('{"xirr":null}');
  });
});
