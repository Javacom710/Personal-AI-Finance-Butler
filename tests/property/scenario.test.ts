/**
 * Scenario projection invariants (FINANCIAL-DOMAIN.md §13).
 *
 * Properties rather than examples, because each is a claim about *every* plan:
 * the deterministic half never depends on the assumption, a zero return adds
 * nothing, and a higher assumed return never produces a lower value.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { Money, currency } from '@/lib/decimal/money';
import { Rate } from '@/lib/decimal/rate';
import { projectScenario, type ScenarioInput } from '@/server/domain/calc/scenario';

const INR = currency('INR');

const plan = fc.record({
  start: fc.bigInt({ min: 0n, max: 10n ** 13n }),
  monthly: fc.bigInt({ min: 0n, max: 10n ** 10n }),
  months: fc.integer({ min: 1, max: 600 }),
  // 0% … 25% a year.
  stepUp: fc.bigInt({ min: 0n, max: 2_500_000_000n }),
  timing: fc.constantFrom('start' as const, 'end' as const),
});
// −50% … +50% a year, at the rate scale.
const annualRate = fc.bigInt({ min: -5_000_000_000n, max: 5_000_000_000n });

interface PlanSample {
  start: bigint;
  monthly: bigint;
  months: number;
  stepUp: bigint;
  timing: 'start' | 'end';
}

function build(p: PlanSample, rates: readonly bigint[]): ScenarioInput {
  return {
    plan: {
      startingBalance: Money.fromMinor(p.start, INR),
      monthlyContribution: Money.fromMinor(p.monthly, INR),
      months: p.months,
      annualStepUp: Rate.fromValue(p.stepUp),
      timing: p.timing,
    },
    assumptions: rates.map((r, i) => ({ label: `a${i}`, annualReturn: Rate.fromValue(r) })),
    annualInflation: null,
  };
}

describe('scenario projection', () => {
  it('a zero return returns exactly what was invested', () => {
    fc.assert(
      fc.property(plan, (p) => {
        const result = projectScenario(build(p, [0n]));
        if (!result.ok) return;
        const { deterministic, outcomes } = result.value;
        expect(outcomes[0]!.finalValue.minor).toBe(deterministic.totalInvested.minor);
      }),
    );
  });

  it('the contribution schedule sums to the total and does not depend on the assumption', () => {
    fc.assert(
      fc.property(plan, annualRate, annualRate, (p, a, b) => {
        const one = projectScenario(build(p, [a]));
        const two = projectScenario(build(p, [b]));
        if (!one.ok || !two.ok) return;
        const d = one.value.deterministic;
        expect(d.schedule.reduce((acc, y) => acc + y.contributed.minor, 0n)).toBe(d.totalContributions.minor);
        expect(d.schedule.reduce((acc, y) => acc + y.months, 0)).toBe(p.months);
        expect(d.totalInvested.minor).toBe(p.start + d.totalContributions.minor);
        expect(two.value.deterministic.totalContributions.minor).toBe(d.totalContributions.minor);
      }),
    );
  });

  it('a higher assumed return never gives a lower value, and growth is value minus invested', () => {
    fc.assert(
      fc.property(plan, annualRate, annualRate, (p, a, b) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        const result = projectScenario(build(p, [low, high]));
        if (!result.ok) return;
        const [lower, higher] = result.value.outcomes;
        expect(lower!.finalValue.minor <= higher!.finalValue.minor).toBe(true);
        for (const outcome of result.value.outcomes) {
          expect(outcome.growth.minor).toBe(outcome.finalValue.minor - result.value.deterministic.totalInvested.minor);
          expect(outcome.finalValue.minor >= 0n).toBe(true);
        }
      }),
    );
  });
});
