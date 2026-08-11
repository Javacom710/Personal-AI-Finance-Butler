/**
 * Time-weighted return (TESTING.md §3, INVESTMENT-DOMAIN.md §8).
 *
 * The load-bearing test is the **boundary convention**: a flow dated `D` belongs
 * to the period *starting* at `D`. The fixture below gives 27.06% under that
 * convention and 5.00% under the opposite one, and both figures are asserted —
 * so the choice is pinned rather than accidental.
 */

import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/date';
import { Money, currency } from '@/lib/decimal/money';
import { rToNumber } from '@/lib/decimal/rate';
import { twr, type ExternalFlow, type Valuation } from '@/server/domain/calc/twr';

const INR = currency('INR');

const at = (on: string, amount: string): Valuation => ({
  on: isoDate(on),
  value: Money.of(amount, INR),
});
const flow = (on: string, amount: string): ExternalFlow => ({
  on: isoDate(on),
  amount: Money.of(amount, INR),
});

describe('the boundary convention is deliberate', () => {
  // ₹1,000 grows to ₹1,200 by 1 July; ₹500 is contributed that day; the
  // portfolio ends the year at ₹1,800.
  const input = {
    from: isoDate('2026-01-01'),
    to: isoDate('2026-12-31'),
    valuations: [at('2026-01-01', '1000'), at('2026-07-01', '1200'), at('2026-12-31', '1800')],
    flows: [flow('2026-07-01', '500')],
  };

  it('assigns the flow to the period STARTING at its date', () => {
    const result = twr(input);
    expect(result.value).not.toBeNull();

    // Period 1 (1 Jan → 1 Jul]: no flows.  r₁ = (1200 − 1000) / 1000 = 20%
    // Period 2 (1 Jul → 31 Dec]: the ₹500 is present for the whole period, so
    //   its weight is 1.  r₂ = (1800 − 1200 − 500) / (1200 + 500) = 100/1700
    // TWR = 1.20 × (1 + 100/1700) − 1 = 0.270588…
    expect(rToNumber(result.value!.twr)).toBeCloseTo(0.270588, 6);
    expect(result.value!.subPeriods).toBe(2);
  });

  it('is NOT the figure the opposite convention would produce', () => {
    // Assigning the flow to the period ENDING at its date gives
    //   r₁ = (1200 − 1000 − 500) / 1000 = −30%
    //   r₂ = (1800 − 1200) / 1200       = +50%
    //   TWR = 0.70 × 1.50 − 1 = 5.00%
    const result = twr(input);
    expect(rToNumber(result.value!.twr)).not.toBeCloseTo(0.05, 4);
  });

  it('does not annualise a window shorter than a year', () => {
    const result = twr(input);
    expect(result.value!.annualised).toBe(false);
    expect(result.value!.days).toBe(364);
  });
});

describe('annualisation', () => {
  it('takes the square root over exactly two years', () => {
    // 2021-01-01 → 2023-01-01 is 730 days, so the exponent is exactly 1/2.
    // Total 21% → (1.21)^(1/2) − 1 = 10%.
    const result = twr({
      from: isoDate('2021-01-01'),
      to: isoDate('2023-01-01'),
      valuations: [at('2021-01-01', '1000'), at('2023-01-01', '1210')],
      flows: [],
    });
    expect(result.value).not.toBeNull();
    expect(rToNumber(result.value!.twr)).toBeCloseTo(0.1, 6);
    expect(result.value!.annualised).toBe(true);
    expect(result.value!.days).toBe(730);
  });

  it('reports the raw figure when annualisation is switched off', () => {
    const result = twr({
      from: isoDate('2021-01-01'),
      to: isoDate('2023-01-01'),
      valuations: [at('2021-01-01', '1000'), at('2023-01-01', '1210')],
      flows: [],
      annualise: false,
    });
    expect(rToNumber(result.value!.twr)).toBeCloseTo(0.21, 6);
    expect(result.value!.annualised).toBe(false);
  });

  it('removes the effect of contribution timing, which is the whole point', () => {
    // Same underlying performance, very different contribution timing: TWR is
    // identical, where XIRR would not be.
    const early = twr({
      from: isoDate('2026-01-01'),
      to: isoDate('2026-07-01'),
      valuations: [at('2026-01-01', '1000'), at('2026-04-01', '1100'), at('2026-07-01', '2420')],
      flows: [flow('2026-04-01', '1100')],
    });
    // r₁ = 1100/1000 = 1.1;  r₂ = (2420 − 1100 − 1100) / (1100 + 1100) = 0.1
    expect(rToNumber(early.value!.twr)).toBeCloseTo(0.21, 6);
  });
});

describe('case 17 — a missing valuation is a null with a reason, never a partial figure', () => {
  it('refuses when a flow date has no valuation', () => {
    const result = twr({
      from: isoDate('2026-01-01'),
      to: isoDate('2026-12-31'),
      valuations: [at('2026-01-01', '1000'), at('2026-12-31', '1800')],
      flows: [flow('2026-07-01', '500')], // no valuation on this date
    });
    expect(result.value).toBeNull();
    expect(result.reason).toBe('insufficient_price_history');
  });

  it('refuses when the closing valuation is missing', () => {
    const result = twr({
      from: isoDate('2026-01-01'),
      to: isoDate('2026-12-31'),
      valuations: [at('2026-01-01', '1000')],
      flows: [],
    });
    expect(result.value).toBeNull();
    expect(result.reason).toBe('insufficient_price_history');
  });

  it('refuses when there are no valuations at all — the launch state for equities', () => {
    // `instrument_prices` is empty until OD-3 is resolved, so every equity and
    // ETF lands here. That is the documented behaviour, not a defect to chase.
    const result = twr({
      from: isoDate('2026-01-01'),
      to: isoDate('2026-12-31'),
      valuations: [],
      flows: [],
    });
    expect(result.value).toBeNull();
    expect(result.reason).toBe('insufficient_price_history');
  });

  it('never substitutes zero for an unanswerable window', () => {
    const result = twr({
      from: isoDate('2026-01-01'),
      to: isoDate('2026-01-01'),
      valuations: [at('2026-01-01', '1000')],
      flows: [],
    });
    expect(result.value).toBeNull();
    expect(result.reason).toBe('no_data');
  });
});

describe('degenerate periods', () => {
  it('handles a portfolio that starts empty and is funded on day one', () => {
    const result = twr({
      from: isoDate('2026-01-01'),
      to: isoDate('2026-12-31'),
      valuations: [at('2026-01-01', '0'), at('2026-12-31', '1100')],
      flows: [flow('2026-01-01', '1000')],
    });
    // One sub-period, opening 0, weighted flow 1,000 → r = (1100 − 0 − 1000)/1000.
    expect(rToNumber(result.value!.twr)).toBeCloseTo(0.1, 6);
  });

  it('reports divide_by_zero when a period has no capital at risk but changed value', () => {
    const result = twr({
      from: isoDate('2026-01-01'),
      to: isoDate('2026-12-31'),
      valuations: [at('2026-01-01', '0'), at('2026-12-31', '500')],
      flows: [],
    });
    expect(result.value).toBeNull();
    expect(result.reason).toBe('divide_by_zero');
  });

  it('collapses two flows on one date into a single boundary', () => {
    const result = twr({
      from: isoDate('2026-01-01'),
      to: isoDate('2026-12-31'),
      valuations: [at('2026-01-01', '1000'), at('2026-07-01', '1200'), at('2026-12-31', '1800')],
      flows: [flow('2026-07-01', '300'), flow('2026-07-01', '200')],
    });
    // Identical to the single ₹500 flow in the convention fixture above.
    expect(rToNumber(result.value!.twr)).toBeCloseTo(0.270588, 6);
    expect(result.value!.subPeriods).toBe(2);
  });

  it('refuses to annualise a total loss rather than inventing a root', () => {
    const result = twr({
      from: isoDate('2021-01-01'),
      to: isoDate('2023-01-01'),
      valuations: [at('2021-01-01', '1000'), at('2023-01-01', '0')],
      flows: [],
    });
    expect(result.value).toBeNull();
    expect(result.reason).toBe('did_not_converge');
  });
});
