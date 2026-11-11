/**
 * The validation boundary for scenarios (ADR-16, FINANCIAL-DOMAIN.md §13).
 *
 * A scenario writes nothing, so this is not a mutation schema — but it is still
 * a boundary: every figure typed by a person (or, later, proposed by a model)
 * becomes a `Money` or a `Rate` here, by digit manipulation, before the engine
 * sees it. **Percentages are strings, never JSON numbers**, for the same reason
 * amounts are.
 *
 * The bounds on the assumptions are deliberately tighter than the engine's. The
 * engine accepts any rate that keeps a month's growth factor positive; a person
 * typing `120` for a yearly return almost certainly meant `12.0`, and a
 * projection at 120% a year is not a scenario worth drawing.
 */

import { z } from 'zod';

import { MONEY_MAX_MINOR, MONEY_SCALE } from '../decimal/money';
import { parseFixed } from '../decimal/scaled';

/** Decimal places accepted in a percentage. `12.5` → `0.125` exactly at the rate scale. */
const PERCENT_SCALE = 8;
const PERCENT_UNIT = 10n ** BigInt(PERCENT_SCALE);

export const SCENARIO_MAX_YEARS = 50;
export const SCENARIO_RETURN_MIN_PCT = -50;
export const SCENARIO_RETURN_MAX_PCT = 50;
export const SCENARIO_STEP_UP_MAX_PCT = 50;
export const SCENARIO_INFLATION_MAX_PCT = 30;

/**
 * A percentage as text, within `[min, max]`.
 *
 * The parsed integer at scale 8 **is** the fraction at the rate scale of 10
 * (`12.5` → `1250000000` → `0.1250000000`), so the conversion from "percent" to
 * "fraction" is exact and involves no division.
 */
function percentSchema(min: number, max: number, what: string) {
  return z
    .string()
    .trim()
    .min(1, `Enter ${what}.`)
    .max(20, 'That is too long to be a percentage.')
    .superRefine((value, ctx) => {
      const parsed = parseFixed(value, { scale: PERCENT_SCALE, maxMagnitude: 1000n * PERCENT_UNIT });
      if (!parsed.ok) {
        ctx.addIssue({ code: 'custom', message: parsed.error.message });
        return;
      }
      if (parsed.value < BigInt(min) * PERCENT_UNIT || parsed.value > BigInt(max) * PERCENT_UNIT) {
        ctx.addIssue({ code: 'custom', message: `Enter a percentage between ${min} and ${max}.` });
      }
    });
}

/** The rate-scale integer for a percentage string that has passed {@link percentSchema}. */
export function percentToRateValue(percent: string): bigint {
  const parsed = parseFixed(percent, { scale: PERCENT_SCALE, maxMagnitude: 1000n * PERCENT_UNIT });
  if (!parsed.ok) throw new TypeError(`percentToRateValue: ${parsed.error.message}`);
  return parsed.value;
}

const nonNegativeAmountSchema = z
  .string()
  .trim()
  .min(1, 'Enter an amount.')
  .max(40, 'That amount is too long to be real.')
  .superRefine((value, ctx) => {
    const parsed = parseFixed(value, { scale: MONEY_SCALE, maxMagnitude: MONEY_MAX_MINOR });
    if (!parsed.ok) {
      ctx.addIssue({ code: 'custom', message: parsed.error.message });
      return;
    }
    if (parsed.value < 0n) ctx.addIssue({ code: 'custom', message: 'Enter zero or a positive amount.' });
  });

const positiveAmountSchema = z
  .string()
  .trim()
  .min(1, 'Enter an amount.')
  .max(40, 'That amount is too long to be real.')
  .superRefine((value, ctx) => {
    const parsed = parseFixed(value, { scale: MONEY_SCALE, maxMagnitude: MONEY_MAX_MINOR });
    if (!parsed.ok) {
      ctx.addIssue({ code: 'custom', message: parsed.error.message });
      return;
    }
    if (parsed.value <= 0n) ctx.addIssue({ code: 'custom', message: 'Enter a positive amount.' });
  });

export const investmentScenarioSchema = z
  .object({
    /**
     * Where the projection starts. `portfolio` reads today's priced market value
     * — a deterministic input, disclosed with its coverage.
     */
    startFrom: z.enum(['zero', 'portfolio', 'amount']).default('zero'),
    startingAmount: nonNegativeAmountSchema.optional(),
    monthlyContribution: nonNegativeAmountSchema,
    years: z.coerce
      .number('Enter a whole number of years.')
      .int('Enter a whole number of years.')
      .min(1, 'The horizon must be at least one year.')
      .max(SCENARIO_MAX_YEARS, `The horizon cannot exceed ${SCENARIO_MAX_YEARS} years.`),
    annualStepUpPct: percentSchema(0, SCENARIO_STEP_UP_MAX_PCT, 'a yearly step-up').default('0'),
    /** One to five hypothetical yearly returns. Order is preserved. */
    annualReturnPcts: z
      .array(percentSchema(SCENARIO_RETURN_MIN_PCT, SCENARIO_RETURN_MAX_PCT, 'a yearly return'))
      .min(1, 'Give at least one return assumption.')
      .max(5, 'Compare at most five return assumptions.'),
    annualInflationPct: percentSchema(0, SCENARIO_INFLATION_MAX_PCT, 'an inflation rate').optional(),
    timing: z.enum(['start', 'end']).default('start'),
  })
  .superRefine((value, ctx) => {
    if (value.startFrom === 'amount' && value.startingAmount === undefined) {
      ctx.addIssue({ code: 'custom', path: ['startingAmount'], message: 'Enter the starting amount.' });
    }
  });

export type InvestmentScenarioInput = z.input<typeof investmentScenarioSchema>;

export const allocationScenarioSchema = z.object({
  additions: z
    .array(
      z.object({
        /** An asset-class key, e.g. `equity`. Checked against the known classes by the service. */
        assetClass: z.string().trim().min(1).max(40),
        amount: positiveAmountSchema,
      }),
    )
    .min(1, 'Give at least one amount to add.')
    .max(9, 'There are only nine asset classes.'),
});

export type AllocationScenarioInput = z.input<typeof allocationScenarioSchema>;
