import 'server-only';

/**
 * Scenarios on the read path
 * ([FINANCIAL-DOMAIN.md §13](../../../docs/FINANCIAL-DOMAIN.md#13-scenario-projection)).
 *
 * A scenario reads and never writes: it takes a `ReadCtx`, and nothing here can
 * reach a write handle. The service does three things and no arithmetic —
 * validate what was typed, fetch the deterministic inputs the user asked to
 * start from (today's portfolio value, today's allocation), and hand both to
 * `domain/calc/scenario.ts`.
 *
 * What comes back keeps the two halves apart all the way to the caller:
 * `deterministic` is true of the plan, `outcomes` are each conditional on the
 * assumption they carry. A page or an AI tool built on this cannot show a
 * projected value without the rate it depends on, because the two are one
 * object.
 */

import { Money, type Money as MoneyValue } from '../../lib/decimal/money';
import { Rate } from '../../lib/decimal/rate';
import { formatPercent } from '../../lib/format';
import { err, ok, validationFailed, type DomainError, type Result } from '../../lib/result';
import {
  allocationScenarioSchema,
  investmentScenarioSchema,
  percentToRateValue,
} from '../../lib/schemas/scenarios';
import {
  allocationAfterAdding,
  projectScenario,
  type AllocationShift,
  type ScenarioError,
  type ScenarioProjection,
} from '../domain/calc/scenario';
import { ASSET_CLASS_LABELS } from '../domain/pricing/allocation';
import type { ReadCtx } from './_ctx';
import { fieldErrors } from './_validation';
import { assetAllocation, portfolio } from './portfolio';

export type {
  AllocationShift,
  AllocationShiftRow,
  ContributionYear,
  ScenarioOutcome,
  ScenarioProjection,
} from '../domain/calc/scenario';

/** Where the starting balance came from — shown beside it, because it is an input the user did not type. */
export type ScenarioStart =
  | { readonly kind: 'zero' }
  | { readonly kind: 'amount' }
  | {
      readonly kind: 'portfolio';
      /** Share of cost basis that could be priced. Below 1, the starting figure omits holdings. */
      readonly coverage: Rate;
      readonly unpricedCount: number;
      /** Holdings counted at a stale price. The figure is then a last-known value, not today's. */
      readonly staleCount: number;
    };

export interface InvestmentScenario {
  readonly projection: ScenarioProjection;
  readonly start: ScenarioStart;
}

/** Engine field → form field, so a message lands beside the input that caused it. */
const FORM_FIELD: Record<Extract<ScenarioError, { code: 'invalid_input' }>['field'], string> = {
  startingBalance: 'startingAmount',
  monthlyContribution: 'monthlyContribution',
  months: 'years',
  annualStepUp: 'annualStepUpPct',
  assumptions: 'annualReturnPcts',
  annualInflation: 'annualInflationPct',
};

function toDomainError(error: ScenarioError): DomainError {
  return validationFailed({
    [error.code === 'invalid_input' ? FORM_FIELD[error.field] : '_']: [error.message],
  });
}

/**
 * Project a monthly-contribution plan under the given return assumptions.
 *
 * `raw` is untrusted — a form today, a model's structured output later — and is
 * validated here regardless of who produced it.
 */
export async function investmentScenario(
  ctx: ReadCtx,
  raw: unknown,
): Promise<Result<InvestmentScenario, DomainError>> {
  const parsed = investmentScenarioSchema.safeParse(raw);
  if (!parsed.success) return err(fieldErrors(parsed.error));
  const input = parsed.data;

  let startingBalance: MoneyValue = Money.zero(ctx.base);
  let start: ScenarioStart = { kind: 'zero' };

  if (input.startFrom === 'amount') {
    startingBalance = Money.of(input.startingAmount!, ctx.base);
    start = { kind: 'amount' };
  } else if (input.startFrom === 'portfolio') {
    const current = await portfolio(ctx, {}, { twr: false });
    if (!current.ok) return current;
    const { valuation } = current.value;
    startingBalance = valuation.pricedValue;
    start = {
      kind: 'portfolio',
      coverage: valuation.coverage,
      unpricedCount: valuation.unpricedCount,
      staleCount: valuation.stale.length,
    };
  }

  const projection = projectScenario({
    plan: {
      startingBalance,
      monthlyContribution: Money.of(input.monthlyContribution, ctx.base),
      months: input.years * 12,
      annualStepUp: Rate.fromValue(percentToRateValue(input.annualStepUpPct)),
      timing: input.timing,
    },
    assumptions: input.annualReturnPcts.map((pct) => {
      const annualReturn = Rate.fromValue(percentToRateValue(pct));
      return { label: `${formatPercent(annualReturn, 2)} a year`, annualReturn };
    }),
    annualInflation:
      input.annualInflationPct === undefined
        ? null
        : Rate.fromValue(percentToRateValue(input.annualInflationPct)),
  });
  if (!projection.ok) return err(toDomainError(projection.error));

  return ok({ projection: projection.value, start });
}

export interface AllocationScenario {
  readonly shift: AllocationShift;
  /** Holdings left out of "before" because they could not be priced. */
  readonly unpricedCount: number;
  readonly unpricedCost: MoneyValue;
  /** Holdings in "before" valued at a stale price. */
  readonly staleCount: number;
}

/**
 * How the asset-class split moves if the given amounts are added today.
 *
 * Deterministic: the additions are valued at what is paid for them and no price
 * is assumed afterwards.
 */
export async function allocationScenario(
  ctx: ReadCtx,
  raw: unknown,
): Promise<Result<AllocationScenario, DomainError>> {
  const parsed = allocationScenarioSchema.safeParse(raw);
  if (!parsed.success) return err(fieldErrors(parsed.error));

  const unknown = parsed.data.additions.find((a) => !(a.assetClass in ASSET_CLASS_LABELS));
  if (unknown) {
    return err(validationFailed({ additions: [`"${unknown.assetClass}" is not an asset class.`] }));
  }

  // The allocation carries values but not their freshness; the valuation does.
  const [current, valued] = await Promise.all([assetAllocation(ctx, 'asset_class'), portfolio(ctx, {}, { twr: false })]);
  if (!valued.ok) return valued;
  const shift = allocationAfterAdding(
    current.slices.map((s) => ({ key: s.key, label: s.label, value: s.marketValue })),
    parsed.data.additions.map((a) => ({
      key: a.assetClass,
      label: ASSET_CLASS_LABELS[a.assetClass]!,
      amount: Money.of(a.amount, ctx.base),
    })),
  );
  if (!shift.ok) return err(toDomainError(shift.error));

  return ok({
    shift: shift.value,
    unpricedCount: current.unpricedCount,
    unpricedCost: current.unpricedValue,
    staleCount: valued.value.valuation.stale.length,
  });
}
