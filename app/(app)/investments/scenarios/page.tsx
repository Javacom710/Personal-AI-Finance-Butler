import type { Metadata } from 'next';

import { PageHeader } from '../../../_components/page-shell';
import { FIELD } from '../../money/_components';
import { amountTone, loadMoneyContext } from '../../money/_page-data';
import { allocationScenario, investmentScenario } from '@/server/services';
import { NavTabs, TABLE, TD, TD_NUM, TH, TH_NUM } from '../_components';

export const metadata: Metadata = { title: 'Scenarios' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const ASSET_CLASSES = [
  ['equity', 'Equities'],
  ['mutual_fund', 'Mutual funds'],
  ['etf', 'ETFs'],
  ['bond', 'Bonds'],
  ['fixed_deposit', 'Fixed deposits'],
  ['gold', 'Gold'],
  ['crypto', 'Crypto'],
  ['cash_equivalent', 'Cash equivalents'],
  ['other', 'Other'],
] as const;

const DEFAULTS = {
  startFrom: 'zero',
  startingAmount: '',
  monthlyContribution: '',
  years: '10',
  annualStepUpPct: '0',
  returnLow: '8',
  returnMid: '10',
  returnHigh: '12',
  annualInflationPct: '',
  timing: 'start',
  addAssetClass: 'equity',
  addAmount: '',
} as const;

/** A service field name → the label on the input it came from. */
const FIELD_LABELS: Record<string, string> = {
  monthlyContribution: 'Monthly amount',
  years: 'Years',
  annualStepUpPct: 'Yearly step-up',
  annualReturnPcts: 'Yearly return',
  annualInflationPct: 'Yearly inflation',
  startingAmount: 'Starting amount',
  additions: 'Amount',
};

type FormValues = { -readonly [K in keyof typeof DEFAULTS]: string };

function readForm(params: Record<string, string | string[] | undefined>): FormValues {
  const out = { ...DEFAULTS } as FormValues;
  for (const key of Object.keys(DEFAULTS) as (keyof FormValues)[]) {
    const value = params[key];
    if (typeof value === 'string') out[key] = value.trim();
  }
  return out;
}

/**
 * Scenarios — "what would this plan look like?" (`CLAUDE.md <scenario_analysis>`).
 *
 * A plain GET form: a scenario writes nothing, so there is no server action and
 * the address bar holds the whole question — reload it, bookmark it.
 *
 * The page keeps the two halves of every answer apart. What the plan puts in is
 * a fact and is shown once, under its own heading. What it might become is shown
 * per assumed return, each column headed by the assumption it depends on, under
 * a heading that says it is hypothetical. No figure on this page is a forecast,
 * and none is computed here: both tables are the engine's output.
 */
export default async function ScenariosPage({ searchParams }: { searchParams: SearchParams }) {
  const { ctx, format } = await loadMoneyContext('/investments/scenarios');
  const params = await searchParams;
  const form = readForm(params);

  const wantsProjection = form.monthlyContribution !== '' || form.startFrom !== 'zero';
  const projection = wantsProjection
    ? await investmentScenario(ctx, {
        startFrom: form.startFrom,
        startingAmount: form.startingAmount === '' ? undefined : form.startingAmount,
        monthlyContribution: form.monthlyContribution === '' ? '0' : form.monthlyContribution,
        years: form.years,
        annualStepUpPct: form.annualStepUpPct === '' ? '0' : form.annualStepUpPct,
        annualReturnPcts: [form.returnLow, form.returnMid, form.returnHigh].filter((r) => r !== ''),
        annualInflationPct: form.annualInflationPct === '' ? undefined : form.annualInflationPct,
        timing: form.timing,
      })
    : null;

  const shift =
    form.addAmount !== ''
      ? await allocationScenario(ctx, {
          additions: [{ assetClass: form.addAssetClass, amount: form.addAmount }],
        })
      : null;

  const errors = (result: typeof projection | typeof shift): string[] => {
    if (result === null || result.ok) return [];
    if (result.error.code !== 'validation_failed') return [result.error.message];
    return Object.entries(result.error.fieldErrors).flatMap(([field, messages]) =>
      messages.map((message) => {
        const label = FIELD_LABELS[field.replace(/\.\d+(\..*)?$/, '')];
        return label ? `${label}: ${message}` : message;
      }),
    );
  };

  return (
    <>
      <PageHeader
        title="Scenarios"
        description="Arithmetic on a plan you describe. Not a forecast."
        actions={<NavTabs current="/investments/scenarios" />}
      />

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Monthly investing plan</h2>
        <form method="get" className="space-y-3 rounded-lg border border-border bg-surface px-4 py-3">
          <input type="hidden" name="addAssetClass" value={form.addAssetClass} />
          <input type="hidden" name="addAmount" value={form.addAmount} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Labelled id="monthlyContribution" label={`Monthly amount (${format.base})`}>
              <input id="monthlyContribution" name="monthlyContribution" inputMode="decimal" defaultValue={form.monthlyContribution} placeholder="25000" className={`${FIELD} tabular`} />
            </Labelled>
            <Labelled id="years" label="Years">
              <input id="years" name="years" inputMode="numeric" defaultValue={form.years} className={`${FIELD} tabular`} />
            </Labelled>
            <Labelled id="annualStepUpPct" label="Yearly step-up %">
              <input id="annualStepUpPct" name="annualStepUpPct" inputMode="decimal" defaultValue={form.annualStepUpPct} className={`${FIELD} tabular`} />
            </Labelled>
            <Labelled id="timing" label="Instalment paid">
              <select id="timing" name="timing" defaultValue={form.timing} className={FIELD}>
                <option value="start">At the start of each month</option>
                <option value="end">At the end of each month</option>
              </select>
            </Labelled>
            <Labelled id="startFrom" label="Start from">
              <select id="startFrom" name="startFrom" defaultValue={form.startFrom} className={FIELD}>
                <option value="zero">Nothing</option>
                <option value="portfolio">My portfolio&apos;s value today</option>
                <option value="amount">An amount I enter</option>
              </select>
            </Labelled>
            <Labelled id="startingAmount" label={`Starting amount (${format.base})`}>
              <input id="startingAmount" name="startingAmount" inputMode="decimal" defaultValue={form.startingAmount} placeholder="If entering one" className={`${FIELD} tabular`} />
            </Labelled>
          </div>

          <fieldset className="space-y-2 border-t border-border pt-3">
            <legend className="text-xs font-medium text-ink-muted">
              Assumptions — yours, not the application&apos;s. Nobody knows these numbers.
            </legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Labelled id="returnLow" label="Yearly return %, low">
                <input id="returnLow" name="returnLow" inputMode="decimal" defaultValue={form.returnLow} className={`${FIELD} tabular`} />
              </Labelled>
              <Labelled id="returnMid" label="Yearly return %, middle">
                <input id="returnMid" name="returnMid" inputMode="decimal" defaultValue={form.returnMid} className={`${FIELD} tabular`} />
              </Labelled>
              <Labelled id="returnHigh" label="Yearly return %, high">
                <input id="returnHigh" name="returnHigh" inputMode="decimal" defaultValue={form.returnHigh} className={`${FIELD} tabular`} />
              </Labelled>
              <Labelled id="annualInflationPct" label="Yearly inflation % (optional)">
                <input id="annualInflationPct" name="annualInflationPct" inputMode="decimal" defaultValue={form.annualInflationPct} className={`${FIELD} tabular`} />
              </Labelled>
            </div>
          </fieldset>

          <button type="submit" className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink">
            Calculate
          </button>
        </form>

        <Errors messages={errors(projection)} />

        {projection?.ok ? (
          <>
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
                What you put in — certain
              </h3>
              <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Starting balance" value={format.money(projection.value.projection.deterministic.startingBalance)} />
                <Stat label="Contributions" value={format.money(projection.value.projection.deterministic.totalContributions)} />
                <Stat label="Total invested" value={format.money(projection.value.projection.deterministic.totalInvested)} />
                <Stat label="Over" value={`${projection.value.projection.deterministic.months / 12} years`} />
              </dl>
              {projection.value.start.kind === 'portfolio' ? (
                <p className="text-xs text-ink-faint">
                  The starting balance is the market value of your priced holdings today.
                  {projection.value.start.unpricedCount > 0
                    ? ` ${projection.value.start.unpricedCount} holding(s) could not be priced and are left out; ${format.percent(projection.value.start.coverage, 1)} of cost is covered.`
                    : ''}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
                What it might become — hypothetical, one column per assumption
              </h3>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className={TABLE}>
                  <thead className="bg-surface-sunken">
                    <tr>
                      <th className={TH}>If the return were</th>
                      {projection.value.projection.outcomes.map((o) => (
                        <th key={o.label} className={TH_NUM}>{o.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-border">
                      <td className={TD}>Value at the end</td>
                      {projection.value.projection.outcomes.map((o) => (
                        <td key={o.label} className={`${TD_NUM} font-medium`}>{format.money(o.finalValue)}</td>
                      ))}
                    </tr>
                    <tr className="border-t border-border">
                      <td className={TD}>Of which growth</td>
                      {projection.value.projection.outcomes.map((o) => (
                        <td key={o.label} className={`${TD_NUM} ${amountTone(o.growth.minor)}`}>
                          {format.money(o.growth, { signDisplay: 'always' })}
                        </td>
                      ))}
                    </tr>
                    {projection.value.projection.annualInflation !== null ? (
                      <tr className="border-t border-border">
                        <td className={TD}>
                          In today&apos;s money, at {format.percent(projection.value.projection.annualInflation, 2)} inflation
                        </td>
                        {projection.value.projection.outcomes.map((o) => (
                          <td key={o.label} className={TD_NUM}>
                            {o.realFinalValue === null ? '—' : format.money(o.realFinalValue)}
                          </td>
                        ))}
                      </tr>
                    ) : null}
                    {projection.value.projection.deterministic.schedule.map((year, index) => (
                      <tr key={year.year} className="border-t border-border text-ink-muted">
                        <td className={TD}>
                          After year {year.year}
                          <span className="ml-2 text-xs text-ink-faint">
                            {format.money(year.cumulativeInvested)} in
                          </span>
                        </td>
                        {projection.value.projection.outcomes.map((o) => (
                          <td key={o.label} className={TD_NUM}>
                            {o.path[index] ? format.money(o.path[index].value) : '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-ink-faint">
                Each column assumes that return every single month, compounded monthly at one-twelfth
                of the yearly rate — the convention SIP calculators use. Real returns vary from year
                to year and can be negative; these figures show what the arithmetic gives under each
                assumption and are not a prediction or a recommendation.
              </p>
            </div>
          </>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
          If I add to one asset class today
        </h2>
        <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface px-4 py-3">
          {(Object.keys(DEFAULTS) as (keyof FormValues)[])
            .filter((key) => key !== 'addAssetClass' && key !== 'addAmount')
            .map((key) => (
              <input key={key} type="hidden" name={key} value={form[key]} />
            ))}
          <Labelled id="addAmount" label={`Amount (${format.base})`}>
            <input id="addAmount" name="addAmount" inputMode="decimal" defaultValue={form.addAmount} placeholder="200000" className={`${FIELD} tabular`} />
          </Labelled>
          <Labelled id="addAssetClass" label="Into">
            <select id="addAssetClass" name="addAssetClass" defaultValue={form.addAssetClass} className={FIELD}>
              {ASSET_CLASSES.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Labelled>
          <button type="submit" className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink">
            Show the change
          </button>
        </form>

        <Errors messages={errors(shift)} />

        {shift?.ok ? (
          <>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className={TABLE}>
                <thead className="bg-surface-sunken">
                  <tr>
                    <th className={TH}>Asset class</th>
                    <th className={TH_NUM}>Now</th>
                    <th className={TH_NUM}>Share now</th>
                    <th className={TH_NUM}>After</th>
                    <th className={TH_NUM}>Share after</th>
                    <th className={TH_NUM}>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {shift.value.shift.rows.map((row) => (
                    <tr key={row.key} className="border-t border-border">
                      <td className={TD}>{row.label}</td>
                      <td className={TD_NUM}>{format.money(row.before)}</td>
                      <td className={TD_NUM}>{row.weightBefore === null ? '—' : format.percent(row.weightBefore, 1)}</td>
                      <td className={TD_NUM}>{format.money(row.after)}</td>
                      <td className={`${TD_NUM} font-medium`}>{format.percent(row.weightAfter, 1)}</td>
                      <td className={TD_NUM}>
                        {row.weightChange === null
                          ? '—'
                          : `${row.weightChange.value > 0n ? '+' : ''}${format.percent(row.weightChange, 1)}`}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-border bg-surface-sunken font-medium">
                    <td className={TD}>Total</td>
                    <td className={TD_NUM}>{format.money(shift.value.shift.totalBefore)}</td>
                    <td className={TD_NUM} />
                    <td className={TD_NUM}>{format.money(shift.value.shift.totalAfter)}</td>
                    <td className={TD_NUM} />
                    <td className={TD_NUM} />
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-ink-faint">
              Today&apos;s market values plus the amount added, at what you would pay for it. Nothing
              is assumed about prices afterwards. The change column is in percentage points.
              {shift.value.unpricedCount > 0
                ? ` ${shift.value.unpricedCount} holding(s) costing ${format.money(shift.value.unpricedCost)} could not be priced and are in neither column.`
                : ''}
            </p>
          </>
        ) : null}
      </section>
    </>
  );
}

function Labelled({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs text-ink-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="tabular mt-0.5 text-lg">{value}</dd>
    </div>
  );
}

function Errors({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <ul role="alert" className="rounded-md border border-negative/40 bg-negative/10 px-3 py-2 text-sm">
      {messages.map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  );
}
