/**
 * Scenario projection — the deterministic half of `CLAUDE.md <scenario_analysis>`
 * ([FINANCIAL-DOMAIN.md §13](../../../../docs/FINANCIAL-DOMAIN.md#13-scenario-projection)).
 *
 * A scenario has two kinds of input and they never mix:
 *
 * - **Deterministic inputs** — the starting balance, the monthly contribution,
 *   its yearly step-up, the horizon. What these produce (`totalContributions`,
 *   the contribution schedule) is a fact about the plan, true under every
 *   assumption.
 * - **Hypothetical assumptions** — an annual return, an inflation rate. What
 *   these produce (`finalValue`, `growth`, `realFinalValue`) is conditional on
 *   the assumption and is returned **per assumption, labelled with it**, so no
 *   caller can present a projected value without the rate it depends on.
 *
 * ## Conventions, stated because each one changes the answer
 *
 * 1. **Monthly compounding at `annualRate / 12`.** The nominal-rate convention
 *    every Indian SIP calculator uses, so a figure here can be checked against
 *    one. It is *not* the effective-annual convention: 12% here compounds to
 *    12.68% over a year.
 * 2. **Contribution timing is explicit** — `'start'` (annuity-due, the SIP
 *    convention: each instalment earns its first month) or `'end'`.
 * 3. **Step-up applies at each 12-month anniversary**, to the previous year's
 *    instalment, rounded `half_even` to the money scale — an instalment is a
 *    real amount of money, so each year's is rounded before the next builds on
 *    it.
 * 4. **Inflation deflates the final value once**, by `(1 + i/12)^months`.
 *
 * ## Exactness
 *
 * No float touches a figure. The balance is carried as a `bigint` with
 * {@link GUARD_DIGITS} guard digits below the money scale; each month's growth
 * is one exact rational multiplication rounded `half_even` at that working
 * scale, and the result is rounded to the money scale **once**, at the end. At
 * a zero return the projection therefore equals the starting balance plus the
 * contributions *exactly* — asserted by a property test, because that identity
 * is what separates "the engine added the contributions" from "the engine
 * approximately added them".
 *
 * Pure: no I/O, no clock.
 */

import { Money as MoneyCtor, add, mulRate, sub, type Money } from '../../../lib/decimal/money';
import { RATE_SCALE, Rate } from '../../../lib/decimal/rate';
import { divRound, pow10 } from '../../../lib/decimal/rounding';
import { MONEY_MAX_MINOR } from '../../../lib/decimal/money';
import { err, ok, type Result } from '../../../lib/result';

/** Fifty years. A horizon beyond a working life is a typo, not a plan. */
export const SCENARIO_MAX_MONTHS = 600;
/** Enough to compare low / expected / high plus one or two alternatives. */
export const SCENARIO_MAX_ASSUMPTIONS = 5;

/** Guard digits carried below the money scale while compounding. */
const GUARD_DIGITS = 12;
const GUARD = pow10(GUARD_DIGITS);
const RATE_UNIT = pow10(RATE_SCALE);
const MONTHS_PER_YEAR = 12n;

export type ContributionTiming = 'start' | 'end';

export interface ContributionPlan {
  /** What is already invested. Zero for a plan that starts from nothing. */
  readonly startingBalance: Money;
  /** The first year's monthly instalment. Zero projects the starting balance alone. */
  readonly monthlyContribution: Money;
  /** Whole months, `1 … SCENARIO_MAX_MONTHS`. */
  readonly months: number;
  /** Yearly increase of the instalment, as a fraction: `0.10` raises it 10% each anniversary. */
  readonly annualStepUp: Rate;
  readonly timing: ContributionTiming;
}

export interface ReturnAssumption {
  readonly label: string;
  /** Nominal annual rate, compounded monthly. May be negative. */
  readonly annualReturn: Rate;
}

export interface ScenarioInput {
  readonly plan: ContributionPlan;
  readonly assumptions: readonly ReturnAssumption[];
  /** Nominal annual inflation; `null` omits the real-terms figure. */
  readonly annualInflation: Rate | null;
}

/** One year of the plan. Deterministic — the same under every assumption. */
export interface ContributionYear {
  /** 1-based. */
  readonly year: number;
  /** Months of this year inside the horizon — 12, or fewer in a final part-year. */
  readonly months: number;
  readonly monthlyContribution: Money;
  readonly contributed: Money;
  /** Starting balance plus every contribution up to the end of this year. */
  readonly cumulativeInvested: Money;
}

export interface ScenarioPathPoint {
  /** Months elapsed: every 12th month, and the final month. */
  readonly month: number;
  readonly value: Money;
}

/** What one assumption produces. Hypothetical by construction. */
export interface ScenarioOutcome {
  readonly label: string;
  readonly annualReturn: Rate;
  readonly finalValue: Money;
  /** `finalValue − startingBalance − totalContributions`. Negative under a negative return. */
  readonly growth: Money;
  /** `finalValue` in today's money, or `null` when no inflation assumption was given. */
  readonly realFinalValue: Money | null;
  readonly path: readonly ScenarioPathPoint[];
}

export interface ScenarioProjection {
  /** Facts about the plan. True whatever the markets do. */
  readonly deterministic: {
    readonly startingBalance: Money;
    readonly months: number;
    readonly timing: ContributionTiming;
    readonly annualStepUp: Rate;
    readonly totalContributions: Money;
    /** `startingBalance + totalContributions`. */
    readonly totalInvested: Money;
    readonly schedule: readonly ContributionYear[];
  };
  /** One per assumption, in the order given. None is a prediction. */
  readonly outcomes: readonly ScenarioOutcome[];
  readonly annualInflation: Rate | null;
}

export type ScenarioField =
  | 'startingBalance'
  | 'monthlyContribution'
  | 'months'
  | 'annualStepUp'
  | 'assumptions'
  | 'annualInflation';

export type ScenarioError =
  | { readonly code: 'invalid_input'; readonly field: ScenarioField; readonly message: string }
  /** A figure exceeded `the storable money range`. Reported, never clamped. */
  | { readonly code: 'out_of_range'; readonly message: string };

const invalid = (field: ScenarioField, message: string): Result<never, ScenarioError> =>
  err({ code: 'invalid_input', field, message });

function validate(input: ScenarioInput): Result<null, ScenarioError> {
  const { plan, assumptions, annualInflation } = input;

  if (plan.startingBalance.currency !== plan.monthlyContribution.currency) {
    // A programming error, not a user's: the service converts before it calls.
    throw new TypeError(
      `projectScenario: the starting balance is in ${plan.startingBalance.currency} and the contribution in ${plan.monthlyContribution.currency}.`,
    );
  }
  if (plan.startingBalance.minor < 0n) {
    return invalid('startingBalance', 'The starting balance cannot be negative.');
  }
  if (plan.monthlyContribution.minor < 0n) {
    return invalid('monthlyContribution', 'The monthly contribution cannot be negative.');
  }
  if (!Number.isInteger(plan.months) || plan.months < 1 || plan.months > SCENARIO_MAX_MONTHS) {
    return invalid('months', `The horizon must be between 1 and ${SCENARIO_MAX_MONTHS} months.`);
  }
  if (plan.annualStepUp.value < 0n) {
    return invalid('annualStepUp', 'The yearly step-up cannot be negative.');
  }
  if (assumptions.length < 1 || assumptions.length > SCENARIO_MAX_ASSUMPTIONS) {
    return invalid('assumptions', `Give between 1 and ${SCENARIO_MAX_ASSUMPTIONS} return assumptions.`);
  }
  for (const assumption of assumptions) {
    // `1 + r/12` must stay positive, or a month would flip the balance's sign.
    if (monthlyNumerator(assumption.annualReturn) <= 0n) {
      return invalid('assumptions', `"${assumption.label}" loses more than everything in a month.`);
    }
  }
  if (annualInflation !== null && monthlyNumerator(annualInflation) <= 0n) {
    return invalid('annualInflation', 'That inflation rate is below −1,200% a year.');
  }
  return ok(null);
}

/** `1 + r/12` as a fraction over {@link MONTHLY_DENOMINATOR} — exact, no rounding. */
function monthlyNumerator(annual: Rate): bigint {
  return MONTHS_PER_YEAR * RATE_UNIT + annual.value;
}
const MONTHLY_DENOMINATOR = MONTHS_PER_YEAR * RATE_UNIT;

/** The instalment for each month of the horizon, and the yearly schedule built from it. */
function contributionSchedule(plan: ContributionPlan): {
  readonly perMonth: readonly Money[];
  readonly schedule: readonly ContributionYear[];
  readonly total: Money;
} {
  const currency = plan.startingBalance.currency;
  const stepFactor = Rate.fromValue(RATE_UNIT + plan.annualStepUp.value);

  const perMonth: Money[] = [];
  const schedule: ContributionYear[] = [];
  let instalment = plan.monthlyContribution;
  let total = MoneyCtor.zero(currency);

  for (let done = 0, year = 1; done < plan.months; year += 1) {
    if (year > 1) instalment = mulRate(instalment, stepFactor, 'half_even');
    const months = Math.min(12, plan.months - done);
    const contributed = MoneyCtor.fromMinor(instalment.minor * BigInt(months), currency);
    total = add(total, contributed);
    for (let m = 0; m < months; m += 1) perMonth.push(instalment);
    schedule.push({
      year,
      months,
      monthlyContribution: instalment,
      contributed,
      cumulativeInvested: add(plan.startingBalance, total),
    });
    done += months;
  }

  return { perMonth, schedule, total };
}

function toMoneyMinor(working: bigint): bigint {
  return divRound(working, GUARD, 'half_even');
}

/**
 * Project a contribution plan under each return assumption.
 *
 * Returns a typed error rather than throwing for anything a user can type: a
 * negative amount, a horizon out of range, a figure too large to store.
 */
export function projectScenario(input: ScenarioInput): Result<ScenarioProjection, ScenarioError> {
  const valid = validate(input);
  if (!valid.ok) return valid;

  const { plan, assumptions, annualInflation } = input;
  const currency = plan.startingBalance.currency;

  let perMonth: readonly Money[];
  let schedule: readonly ContributionYear[];
  let totalContributions: Money;
  try {
    ({ perMonth, schedule, total: totalContributions } = contributionSchedule(plan));
  } catch (error) {
    // `Money` refuses a magnitude beyond the storable money range; a step-up compounding
    // for decades can get there.
    if (error instanceof RangeError) {
      return err({ code: 'out_of_range', message: 'The contributions grow too large to represent.' });
    }
    throw error;
  }
  const totalInvested = add(plan.startingBalance, totalContributions);

  const deflator =
    annualInflation === null
      ? null
      : {
          numerator: MONTHLY_DENOMINATOR ** BigInt(plan.months),
          denominator: monthlyNumerator(annualInflation) ** BigInt(plan.months),
        };

  const outcomes: ScenarioOutcome[] = [];

  for (const assumption of assumptions) {
    const numerator = monthlyNumerator(assumption.annualReturn);
    let balance = plan.startingBalance.minor * GUARD;
    const path: ScenarioPathPoint[] = [];

    for (let month = 1; month <= plan.months; month += 1) {
      const instalment = perMonth[month - 1]!.minor * GUARD;
      if (plan.timing === 'start') balance += instalment;
      balance = divRound(balance * numerator, MONTHLY_DENOMINATOR, 'half_even');
      if (plan.timing === 'end') balance += instalment;

      if (toMoneyMinor(balance) > MONEY_MAX_MINOR) {
        return err({
          code: 'out_of_range',
          message: `"${assumption.label}" grows too large to represent by month ${month}.`,
        });
      }
      if (month % 12 === 0 || month === plan.months) {
        path.push({ month, value: MoneyCtor.fromMinor(toMoneyMinor(balance), currency) });
      }
    }

    const finalValue = MoneyCtor.fromMinor(toMoneyMinor(balance), currency);
    outcomes.push({
      label: assumption.label,
      annualReturn: assumption.annualReturn,
      finalValue,
      growth: sub(finalValue, totalInvested),
      realFinalValue:
        deflator === null
          ? null
          : MoneyCtor.fromMinor(
              divRound(balance * deflator.numerator, deflator.denominator * GUARD, 'half_even'),
              currency,
            ),
      path,
    });
  }

  return ok({
    deterministic: {
      startingBalance: plan.startingBalance,
      months: plan.months,
      timing: plan.timing,
      annualStepUp: plan.annualStepUp,
      totalContributions,
      totalInvested,
      schedule,
    },
    outcomes,
    annualInflation,
  });
}

// ------------------------------------------------------- allocation what-if

export interface AllocationPosition {
  readonly key: string;
  readonly label: string;
  /** Current value in base currency. Never negative. */
  readonly value: Money;
}

export interface AllocationAddition {
  readonly key: string;
  /** Used when `key` names a slice the portfolio does not hold yet. */
  readonly label: string;
  /** What would be added. Positive. */
  readonly amount: Money;
}

export interface AllocationShiftRow {
  readonly key: string;
  readonly label: string;
  readonly before: Money;
  readonly after: Money;
  /** `null` when the portfolio is empty before the addition: there is no whole to be a share of. */
  readonly weightBefore: Rate | null;
  readonly weightAfter: Rate;
  /** `weightAfter − weightBefore` in rate units; `null` when there is no "before". */
  readonly weightChange: Rate | null;
}

export interface AllocationShift {
  readonly totalBefore: Money;
  readonly totalAdded: Money;
  readonly totalAfter: Money;
  /** Largest "after" value first, ties by label — deterministic across runs. */
  readonly rows: readonly AllocationShiftRow[];
}

/**
 * "If I invest another ₹2 lakh, how will my allocation change?"
 *
 * Arithmetic on today's values only: the addition is valued at what is paid for
 * it and nothing is assumed about any price afterwards. That makes this a
 * deterministic calculation, not a projection — it needs no assumption.
 */
export function allocationAfterAdding(
  positions: readonly AllocationPosition[],
  additions: readonly AllocationAddition[],
): Result<AllocationShift, ScenarioError> {
  const first = positions[0]?.value ?? additions[0]?.amount;
  if (first === undefined || additions.length === 0) {
    return invalid('assumptions', 'Give at least one amount to add.');
  }
  const currency = first.currency;

  const rows = new Map<string, { label: string; before: bigint; added: bigint }>();
  for (const position of positions) {
    if (position.value.minor < 0n) {
      return invalid('startingBalance', `"${position.label}" has a negative value.`);
    }
    if (position.value.currency !== currency) throw new TypeError('allocationAfterAdding: mixed currencies.');
    const row = rows.get(position.key);
    if (row) row.before += position.value.minor;
    else rows.set(position.key, { label: position.label, before: position.value.minor, added: 0n });
  }
  for (const addition of additions) {
    if (addition.amount.minor <= 0n) {
      return invalid('monthlyContribution', `The amount added to "${addition.label}" must be positive.`);
    }
    if (addition.amount.currency !== currency) throw new TypeError('allocationAfterAdding: mixed currencies.');
    const row = rows.get(addition.key);
    if (row) row.added += addition.amount.minor;
    else rows.set(addition.key, { label: addition.label, before: 0n, added: addition.amount.minor });
  }

  let totalBefore = 0n;
  let totalAdded = 0n;
  for (const row of rows.values()) {
    totalBefore += row.before;
    totalAdded += row.added;
  }
  const totalAfter = totalBefore + totalAdded;
  if (totalAfter > MONEY_MAX_MINOR) {
    return err({ code: 'out_of_range', message: 'The total is too large to represent.' });
  }

  const weight = (part: bigint, whole: bigint): Rate =>
    Rate.fromValue(divRound(part * RATE_UNIT, whole, 'half_up'));

  const shifted: AllocationShiftRow[] = [...rows.entries()].map(([key, row]) => {
    const after = row.before + row.added;
    const weightBefore = totalBefore === 0n ? null : weight(row.before, totalBefore);
    const weightAfter = weight(after, totalAfter);
    return {
      key,
      label: row.label,
      before: MoneyCtor.fromMinor(row.before, currency),
      after: MoneyCtor.fromMinor(after, currency),
      weightBefore,
      weightAfter,
      weightChange: weightBefore === null ? null : Rate.fromValue(weightAfter.value - weightBefore.value),
    };
  });

  shifted.sort((a, b) =>
    a.after.minor === b.after.minor ? a.label.localeCompare(b.label) : a.after.minor > b.after.minor ? -1 : 1,
  );

  return ok({
    totalBefore: MoneyCtor.fromMinor(totalBefore, currency),
    totalAdded: MoneyCtor.fromMinor(totalAdded, currency),
    totalAfter: MoneyCtor.fromMinor(totalAfter, currency),
    rows: shifted,
  });
}
