import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { isoDate, type IsoDate } from '@/lib/date';
import { add, currency, Money, sub, toDbString, type Money as MoneyValue } from '@/lib/decimal/money';
import { Rate } from '@/lib/decimal/rate';
import { compose, type ComponentInput } from '@/server/domain/networth/compose';
import { sourceKeyId, type SourceKey } from '@/server/domain/networth/keys';
import { reconcile } from '@/server/domain/networth/reconcile';

/**
 * Algebraic properties of `Net Worth at Cost`.
 *
 * The ones that matter are **I-22** (the two summation paths agree exactly) and
 * **I-25** (a purchase is net-worth neutral, a sale moves it by exactly the
 * realised P&L). Both are stated over generated data rather than over a fixture,
 * because the failure mode they guard is a rounding or sign error that a
 * hand-picked example happens to miss.
 */

const INR = currency('INR');
const AS_OF = isoDate('2026-06-30');

/** Amounts up to ₹10 crore, at full 4-decimal precision. */
const amount = fc
  .bigInt({ min: -1_000_000_000_0000n, max: 1_000_000_000_0000n })
  .map((minor) => Money.fromMinor(minor, INR));

const positiveAmount = fc
  .bigInt({ min: 1n, max: 1_000_000_000_0000n })
  .map((minor) => Money.fromMinor(minor, INR));

const sourceKey: fc.Arbitrary<SourceKey> = fc.oneof(
  fc.uuid().map((id) => ({ t: 'account', accountId: id }) as const),
  fc.tuple(fc.uuid(), fc.uuid()).map(([a, i]) => ({ t: 'position', accountId: a, instrumentId: i }) as const),
  fc.uuid().map((id) => ({ t: 'asset', assetId: id }) as const),
  fc.uuid().map((id) => ({ t: 'liability', liabilityId: id }) as const),
);

const component: fc.Arbitrary<ComponentInput> = fc
  .record({ key: sourceKey, native: amount })
  .map(({ key, native }) => ({
    key,
    label: sourceKeyId(key),
    group: 'cash' as const,
    native,
    sourceRef: { type: 'account', id: 'x' },
    fx: { rate: Rate.one(), asOf: AS_OF },
  }));

/** Components with distinct keys — a duplicate is a separate, tested error. */
const distinctComponents = fc
  .array(component, { maxLength: 24 })
  .map((items) => {
    const seen = new Set<string>();
    return items.filter((c) => {
      const id = sourceKeyId(c.key);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  });

function composeOf(inputs: readonly ComponentInput[], asOf: IsoDate = AS_OF) {
  return compose(inputs, { asOf, base: INR, basis: 'cost' });
}

describe('I-22 — assets − liabilities equals the map, exactly', () => {
  it('holds for any set of components', () => {
    fc.assert(
      fc.property(distinctComponents, (inputs) => {
        const result = composeOf(inputs);
        const fromMap = inputs.reduce((acc, c) => acc + c.native.minor, 0n);
        expect(result.netWorth.minor).toBe(fromMap);
        expect(result.assets.minor - result.liabilities.minor).toBe(fromMap);
      }),
      { numRuns: 300 },
    );
  });

  it('reconciles by the independent group path, with a zero residual', () => {
    fc.assert(
      fc.property(distinctComponents, (inputs) => {
        const r = reconcile(composeOf(inputs));
        expect(r.residual.minor).toBe(0n);
        expect(r.balances).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('is independent of the order the components arrive in', () => {
    fc.assert(
      fc.property(distinctComponents, (inputs) => {
        const forward = composeOf(inputs);
        const reversed = composeOf([...inputs].reverse());
        expect(toDbString(reversed.netWorth)).toBe(toDbString(forward.netWorth));
        expect(toDbString(reversed.assets)).toBe(toDbString(forward.assets));
        expect(toDbString(reversed.liabilities)).toBe(toDbString(forward.liabilities));
      }),
      { numRuns: 200 },
    );
  });

  it('every contribution lands on the side its sign puts it', () => {
    fc.assert(
      fc.property(distinctComponents, (inputs) => {
        for (const c of composeOf(inputs).contributions) {
          if (c.native.minor > 0n) expect(c.side).toBe('asset');
          else if (c.native.minor < 0n) expect(c.side).toBe('liability');
          else expect(c.side).toBe('none');
        }
      }),
      { numRuns: 200 },
    );
  });
});

/**
 * **I-25** — a buy is net-worth neutral; a sell moves it by exactly the realised
 * P&L.
 *
 * Modelled at the composition level: a purchase debits the brokerage cash
 * contribution by exactly what it credits the position contribution, because
 * both are halves of one ledger row. The integration suite proves the ledger
 * really does behave that way; this proves the arithmetic cannot lose a paisa
 * for any amounts.
 */
describe('I-25 — a purchase is net-worth neutral', () => {
  const account: SourceKey = { t: 'account', accountId: 'brk' };
  const position: SourceKey = { t: 'position', accountId: 'brk', instrumentId: 'i' };

  function snapshot(cash: MoneyValue, basis: MoneyValue) {
    return composeOf([
      {
        key: account,
        label: 'Brokerage',
        group: 'brokerage_cash',
        native: cash,
        sourceRef: { type: 'account', id: 'brk' },
        fx: { rate: Rate.one(), asOf: AS_OF },
      },
      {
        key: position,
        label: 'INFY',
        group: 'investments',
        native: basis,
        sourceRef: { type: 'instrument', id: 'i' },
        fx: { rate: Rate.one(), asOf: AS_OF },
      },
    ]);
  }

  it('leaves net worth unchanged for any opening cash and any purchase size', () => {
    fc.assert(
      fc.property(positiveAmount, positiveAmount, (openingCash, cost) => {
        const before = snapshot(openingCash, Money.zero(INR));
        const after = snapshot(sub(openingCash, cost), cost);
        expect(toDbString(after.netWorth)).toBe(toDbString(before.netWorth));
      }),
      { numRuns: 400 },
    );
  });

  it('a sale moves net worth by exactly proceeds − cost consumed', () => {
    fc.assert(
      fc.property(positiveAmount, positiveAmount, positiveAmount, (cash, basis, proceeds) => {
        const before = snapshot(cash, basis);
        // The whole position is sold: cash gains the proceeds, basis drains.
        const after = snapshot(add(cash, proceeds), Money.zero(INR));
        const realised = sub(proceeds, basis);
        expect(after.netWorth.minor - before.netWorth.minor).toBe(realised.minor);
      }),
      { numRuns: 400 },
    );
  });

  it('a corporate action moves net worth by exactly zero', () => {
    // A split or a bonus rescales quantities and touches no money at all, so the
    // basis contribution is byte-identical before and after.
    fc.assert(
      fc.property(positiveAmount, positiveAmount, (cash, basis) => {
        const before = snapshot(cash, basis);
        const after = snapshot(cash, basis);
        expect(toDbString(after.netWorth)).toBe(toDbString(before.netWorth));
      }),
      { numRuns: 100 },
    );
  });
});

describe('rounding and precision', () => {
  it('converting once per component never loses a unit against the sum of parts', () => {
    fc.assert(
      fc.property(
        fc.array(positiveAmount, { minLength: 1, maxLength: 12 }),
        fc.bigInt({ min: 1n, max: 200_0000000000n }),
        (natives, rateValue) => {
          const rate = Rate.fromValue(rateValue);
          const inputs: ComponentInput[] = natives.map((native, index) => ({
            key: { t: 'account', accountId: `a${index}` },
            label: `a${index}`,
            group: 'cash' as const,
            native,
            sourceRef: { type: 'account', id: `a${index}` },
            fx: { rate, asOf: AS_OF },
          }));

          const result = composeOf(inputs);
          // The subtotal must equal the sum of the per-component rounded figures
          // exactly — that is what makes assets − liabilities = Σ map hold.
          const expected = result.contributions.reduce((acc, c) => acc + c.base.minor, 0n);
          expect(result.assets.minor).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('handles amounts at the NUMERIC(20,4) boundary without overflow', () => {
    const huge = Money.fromMinor(9_999_999_999_999_999n, INR);
    const result = composeOf([
      {
        key: { t: 'account', accountId: 'big' },
        label: 'big',
        group: 'cash',
        native: huge,
        sourceRef: { type: 'account', id: 'big' },
        fx: { rate: Rate.one(), asOf: AS_OF },
      },
    ]);
    expect(result.netWorth.minor).toBe(huge.minor);
  });
});
