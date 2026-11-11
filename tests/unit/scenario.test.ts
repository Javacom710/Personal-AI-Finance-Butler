/**
 * Scenario projection (FINANCIAL-DOMAIN.md §13).
 *
 * Known-input / known-output. The small cases are worked by hand in the comments
 * so the expected figure is not the engine's own output read back; the SIP case
 * is checked against the textbook annuity-due closed form, computed here
 * independently in floating point and compared to the paisa.
 */

import { describe, expect, it } from 'vitest';

import { Money, currency, toDbString } from '@/lib/decimal/money';
import { Rate, rToDbString } from '@/lib/decimal/rate';
import {
  SCENARIO_MAX_MONTHS,
  allocationAfterAdding,
  projectScenario,
  type ScenarioInput,
} from '@/server/domain/calc/scenario';

const INR = currency('INR');
const inr = (s: string) => Money.of(s, INR);
const rate = (s: string) => Rate.of(s);

function input(overrides: {
  start?: string;
  monthly?: string;
  months?: number;
  stepUp?: string;
  timing?: 'start' | 'end';
  returns?: string[];
  inflation?: string | null;
}): ScenarioInput {
  return {
    plan: {
      startingBalance: inr(overrides.start ?? '0'),
      monthlyContribution: inr(overrides.monthly ?? '0'),
      months: overrides.months ?? 12,
      annualStepUp: rate(overrides.stepUp ?? '0'),
      timing: overrides.timing ?? 'start',
    },
    assumptions: (overrides.returns ?? ['0.12']).map((r) => ({ label: r, annualReturn: rate(r) })),
    annualInflation: overrides.inflation == null ? null : rate(overrides.inflation),
  };
}

function project(overrides: Parameters<typeof input>[0]) {
  const result = projectScenario(input(overrides));
  if (!result.ok) throw new Error(`expected a projection, got ${JSON.stringify(result.error)}`);
  return result.value;
}

describe('compounding convention', () => {
  it('compounds monthly at annual/12, instalment at the START of the month', () => {
    // 12% a year → 1% a month.
    // Month 1: (0 + 1000) × 1.01 = 1010.00
    // Month 2: (1010 + 1000) × 1.01 = 2030.10
    const p = project({ monthly: '1000', months: 2 });
    expect(toDbString(p.outcomes[0]!.finalValue)).toBe('2030.1000');
    expect(toDbString(p.deterministic.totalContributions)).toBe('2000.0000');
    expect(toDbString(p.outcomes[0]!.growth)).toBe('30.1000');
  });

  it('instalment at the END of the month earns nothing in its own month', () => {
    // Month 1: 0 × 1.01 + 1000 = 1000.00
    // Month 2: 1000 × 1.01 + 1000 = 2010.00
    const p = project({ monthly: '1000', months: 2, timing: 'end' });
    expect(toDbString(p.outcomes[0]!.finalValue)).toBe('2010.0000');
  });

  it('grows a lump sum by (1 + r/12)^n', () => {
    // 1.01^12 = 1.126825030131969720661201 → ₹1,12,682.5030 on ₹1,00,000.
    const p = project({ start: '100000', months: 12 });
    expect(toDbString(p.outcomes[0]!.finalValue)).toBe('112682.5030');
    expect(toDbString(p.deterministic.totalContributions)).toBe('0.0000');
  });

  it('applies a negative return', () => {
    // −12% a year → −1% a month: 100000 × 0.99 = 99000.
    const p = project({ start: '100000', months: 1, returns: ['-0.12'] });
    expect(toDbString(p.outcomes[0]!.finalValue)).toBe('99000.0000');
    expect(toDbString(p.outcomes[0]!.growth)).toBe('-1000.0000');
  });

  it('matches the annuity-due closed form for ₹25,000 a month over five years', () => {
    // FV = P × (1+i) × ((1+i)^n − 1) / i, i = 0.01, n = 60.
    const closedForm = 25000 * 1.01 * ((1.01 ** 60 - 1) / 0.01);
    const p = project({ monthly: '25000', months: 60 });
    const final = Number(toDbString(p.outcomes[0]!.finalValue));
    expect(Math.abs(final - closedForm)).toBeLessThan(0.01);
    // The deterministic half is exact, not approximately right.
    expect(toDbString(p.deterministic.totalContributions)).toBe('1500000.0000');
    expect(toDbString(p.deterministic.totalInvested)).toBe('1500000.0000');
  });
});

describe('the deterministic half', () => {
  it('is identical under every assumption', () => {
    const p = project({ start: '50000', monthly: '10000', months: 36, returns: ['0.06', '0.10', '0.14'] });
    expect(p.outcomes).toHaveLength(3);
    expect(toDbString(p.deterministic.totalContributions)).toBe('360000.0000');
    expect(toDbString(p.deterministic.totalInvested)).toBe('410000.0000');
    for (const outcome of p.outcomes) {
      // growth is defined against the same invested total for each.
      expect(outcome.finalValue.minor - outcome.growth.minor).toBe(p.deterministic.totalInvested.minor);
    }
    // A higher assumed return gives a higher value; the order given is kept.
    expect(p.outcomes[0]!.finalValue.minor).toBeLessThan(p.outcomes[1]!.finalValue.minor);
    expect(p.outcomes[1]!.finalValue.minor).toBeLessThan(p.outcomes[2]!.finalValue.minor);
    expect(p.outcomes.map((o) => rToDbString(o.annualReturn))).toEqual([
      '0.0600000000',
      '0.1000000000',
      '0.1400000000',
    ]);
  });

  it('at a zero return the value is exactly what was put in', () => {
    const p = project({ start: '12345.6789', monthly: '3333.3333', months: 37, returns: ['0'] });
    expect(p.outcomes[0]!.finalValue.minor).toBe(p.deterministic.totalInvested.minor);
    expect(p.outcomes[0]!.growth.minor).toBe(0n);
  });

  it('steps the instalment up at each anniversary', () => {
    // 10,000 → 11,000 → 12,100; 12 instalments of each.
    const p = project({ monthly: '10000', months: 36, stepUp: '0.10' });
    expect(p.deterministic.schedule.map((y) => toDbString(y.monthlyContribution))).toEqual([
      '10000.0000',
      '11000.0000',
      '12100.0000',
    ]);
    expect(p.deterministic.schedule.map((y) => toDbString(y.contributed))).toEqual([
      '120000.0000',
      '132000.0000',
      '145200.0000',
    ]);
    expect(toDbString(p.deterministic.totalContributions)).toBe('397200.0000');
    expect(toDbString(p.deterministic.schedule[2]!.cumulativeInvested)).toBe('397200.0000');
  });

  it('counts a final part-year by its months', () => {
    const p = project({ monthly: '1000', months: 18 });
    expect(p.deterministic.schedule.map((y) => y.months)).toEqual([12, 6]);
    expect(toDbString(p.deterministic.totalContributions)).toBe('18000.0000');
    // A path point at each 12th month and at the end.
    expect(p.outcomes[0]!.path.map((point) => point.month)).toEqual([12, 18]);
    expect(p.outcomes[0]!.path.at(-1)!.value.minor).toBe(p.outcomes[0]!.finalValue.minor);
  });
});

describe('inflation', () => {
  it('is omitted, not zeroed, when no assumption is given', () => {
    const p = project({ start: '100000' });
    expect(p.outcomes[0]!.realFinalValue).toBeNull();
    expect(p.annualInflation).toBeNull();
  });

  it('cancels a return of the same rate', () => {
    // Growth and deflation are the same factor, so today's-money value is the start.
    const p = project({ start: '100000', months: 120, returns: ['0.07'], inflation: '0.07' });
    expect(toDbString(p.outcomes[0]!.realFinalValue!)).toBe('100000.0000');
  });

  it('deflates by (1 + i/12)^months', () => {
    // 100000 at 0% for 12 months, 12% inflation: 100000 / 1.01^12 = 88744.9225…
    const p = project({ start: '100000', months: 12, returns: ['0'], inflation: '0.12' });
    expect(toDbString(p.outcomes[0]!.realFinalValue!)).toBe('88744.9225');
  });
});

describe('rejected input', () => {
  const field = (overrides: Parameters<typeof input>[0]) => {
    const result = projectScenario(input(overrides));
    if (result.ok) throw new Error('expected a rejection');
    return result.error.code === 'invalid_input' ? result.error.field : result.error.code;
  };

  it('names the field', () => {
    expect(field({ months: 0 })).toBe('months');
    expect(field({ months: SCENARIO_MAX_MONTHS + 1 })).toBe('months');
    expect(field({ months: 1.5 })).toBe('months');
    expect(field({ stepUp: '-0.01' })).toBe('annualStepUp');
    expect(field({ returns: [] })).toBe('assumptions');
    expect(field({ returns: ['0.01', '0.02', '0.03', '0.04', '0.05', '0.06'] })).toBe('assumptions');
    expect(field({ returns: ['-12'] })).toBe('assumptions');
    expect(field({ inflation: '-12' })).toBe('annualInflation');
  });

  it('rejects negative money without constructing a projection', () => {
    const negativeStart = projectScenario({ ...input({}), plan: { ...input({}).plan, startingBalance: inr('-1') } });
    expect(negativeStart.ok).toBe(false);
    const negativeMonthly = projectScenario({
      ...input({}),
      plan: { ...input({}).plan, monthlyContribution: inr('-1') },
    });
    expect(negativeMonthly.ok).toBe(false);
  });

  it('reports a value too large to store rather than clamping it', () => {
    expect(field({ start: '1000000000000', months: 600, returns: ['1'] })).toBe('out_of_range');
    expect(field({ monthly: '1000000000000', months: 600, stepUp: '5' })).toBe('out_of_range');
  });

  it('refuses mixed currencies as a programming error', () => {
    const base = input({});
    expect(() =>
      projectScenario({ ...base, plan: { ...base.plan, monthlyContribution: Money.of('1', currency('USD')) } }),
    ).toThrow(TypeError);
  });
});

describe('allocation after adding', () => {
  const positions = [
    { key: 'equity', label: 'Equities', value: inr('600000') },
    { key: 'mutual_fund', label: 'Mutual funds', value: inr('400000') },
  ];

  it('shifts every weight, including the slices nothing was added to', () => {
    const result = allocationAfterAdding(positions, [{ key: 'gold', label: 'Gold', amount: inr('200000') }]);
    if (!result.ok) throw new Error('expected a shift');
    const shift = result.value;

    expect(toDbString(shift.totalBefore)).toBe('1000000.0000');
    expect(toDbString(shift.totalAdded)).toBe('200000.0000');
    expect(toDbString(shift.totalAfter)).toBe('1200000.0000');

    const row = (key: string) => shift.rows.find((r) => r.key === key)!;
    expect(rToDbString(row('equity').weightBefore!)).toBe('0.6000000000');
    expect(rToDbString(row('equity').weightAfter)).toBe('0.5000000000');
    expect(rToDbString(row('equity').weightChange!)).toBe('-0.1000000000');
    expect(rToDbString(row('mutual_fund').weightAfter)).toBe('0.3333333333');
    // A new slice was 0% of a real portfolio before — a figure, not "unknown".
    expect(rToDbString(row('gold').weightBefore!)).toBe('0.0000000000');
    expect(rToDbString(row('gold').weightAfter)).toBe('0.1666666667');
    expect(shift.rows.map((r) => r.key)).toEqual(['equity', 'mutual_fund', 'gold']);
  });

  it('adds to an existing slice', () => {
    const result = allocationAfterAdding(positions, [{ key: 'equity', label: 'Equities', amount: inr('200000') }]);
    if (!result.ok) throw new Error('expected a shift');
    const equity = result.value.rows.find((r) => r.key === 'equity')!;
    expect(toDbString(equity.after)).toBe('800000.0000');
    expect(rToDbString(equity.weightAfter)).toBe('0.6666666667');
  });

  it('has no "before" weight for an empty portfolio', () => {
    const result = allocationAfterAdding([], [{ key: 'equity', label: 'Equities', amount: inr('50000') }]);
    if (!result.ok) throw new Error('expected a shift');
    expect(result.value.rows[0]!.weightBefore).toBeNull();
    expect(result.value.rows[0]!.weightChange).toBeNull();
    expect(rToDbString(result.value.rows[0]!.weightAfter)).toBe('1.0000000000');
  });

  it('rejects nothing to add, and a non-positive amount', () => {
    expect(allocationAfterAdding(positions, []).ok).toBe(false);
    expect(allocationAfterAdding(positions, [{ key: 'gold', label: 'Gold', amount: inr('0') }]).ok).toBe(false);
  });
});
