'use client';

/**
 * The investment area's forms.
 *
 * Each is a **concrete** client component taking only serializable props, for
 * the reason recorded in `money/_forms.tsx`: a render prop is a function across
 * the server/client boundary, which React refuses at runtime after compiling,
 * linting and building cleanly.
 *
 * **No form has a signed-amount field.** The user picks a kind and types a
 * positive quantity; the service derives the sign, the gross amount and all
 * three denominations of the cash effect. A form that let the user type `-100`
 * would make "sell" expressible twice, in two ways that could disagree.
 */

import { useActionState, useState } from 'react';

import { Field, FIELD, SubmitButton, Notice, type FormAction } from '../money/_components';
import { EMPTY_ACTION_STATE } from '../money/form-state';

export interface AccountOption {
  readonly id: string;
  readonly label: string;
  readonly currency: string;
}

export interface InstrumentOption {
  readonly id: string;
  readonly label: string;
  readonly currency: string;
}

const ASSET_CLASSES = [
  ['equity', 'Equity'],
  ['mutual_fund', 'Mutual fund'],
  ['etf', 'ETF'],
  ['bond', 'Bond'],
  ['fixed_deposit', 'Fixed deposit'],
  ['gold', 'Gold'],
  ['crypto', 'Crypto'],
  ['cash_equivalent', 'Cash equivalent'],
  ['other', 'Other'],
] as const;

/**
 * The ledger kinds, grouped by the shape of the form they need. The grouping is
 * the same discriminated union the schema uses, so a kind can never reach a
 * service with fields that kind does not have.
 */
const KIND_GROUPS = {
  trade: ['buy', 'sell', 'mf_purchase', 'mf_redemption'],
  income: ['dividend', 'interest'],
  charge: ['fee', 'tax'],
  ratio: ['split', 'bonus'],
  transferIn: ['transfer_in'],
  transferOut: ['transfer_out'],
} as const;

const KIND_LABELS: Record<string, string> = {
  buy: 'Buy',
  sell: 'Sell',
  mf_purchase: 'Mutual fund purchase',
  mf_redemption: 'Mutual fund redemption',
  dividend: 'Dividend',
  interest: 'Interest',
  fee: 'Fee',
  tax: 'Tax',
  split: 'Stock split',
  bonus: 'Bonus issue',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
};

const ORDERED_KINDS = [
  ...KIND_GROUPS.trade,
  ...KIND_GROUPS.income,
  ...KIND_GROUPS.charge,
  ...KIND_GROUPS.ratio,
  ...KIND_GROUPS.transferIn,
  ...KIND_GROUPS.transferOut,
];

type Shape = keyof typeof KIND_GROUPS;

function shapeOf(kind: string): Shape {
  for (const [shape, kinds] of Object.entries(KIND_GROUPS)) {
    if ((kinds as readonly string[]).includes(kind)) return shape as Shape;
  }
  return 'trade';
}

export function InstrumentForm({
  action,
  currencies,
  baseCurrency,
}: {
  action: FormAction;
  currencies: readonly string[];
  baseCurrency: string;
}) {
  const [state, dispatch] = useActionState(action, EMPTY_ACTION_STATE);

  return (
    <form action={dispatch} className="space-y-3">
      <Notice state={state} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field name="symbol" label="Symbol" state={state}>
          <input id="symbol" name="symbol" required className={FIELD} placeholder="RELIANCE" />
        </Field>

        <Field name="name" label="Name" state={state}>
          <input id="name" name="name" required className={FIELD} placeholder="Reliance Industries" />
        </Field>

        <Field name="exchange" label="Exchange (blank for a fund)" state={state}>
          <input id="exchange" name="exchange" className={FIELD} placeholder="NSE" />
        </Field>

        <Field name="assetClass" label="Asset class" state={state}>
          <select id="assetClass" name="assetClass" required defaultValue="equity" className={FIELD}>
            {ASSET_CLASSES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <Field name="currencyCode" label="Currency" state={state}>
          <select id="currencyCode" name="currencyCode" required defaultValue={baseCurrency} className={FIELD}>
            {currencies.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </Field>

        <Field name="country" label="Country (optional)" state={state}>
          <input id="country" name="country" className={FIELD} placeholder="IN" maxLength={2} />
        </Field>

        <Field name="isin" label="ISIN (optional)" state={state}>
          <input id="isin" name="isin" className={`${FIELD} tabular`} placeholder="INE002A01018" />
        </Field>
      </div>

      <p className="text-xs text-ink-faint">
        The symbol, exchange and currency are identity and cannot be edited afterwards: changing the
        currency would silently reinterpret every price, fee and tax already recorded against it.
      </p>

      <SubmitButton>Add instrument</SubmitButton>
    </form>
  );
}

export function InvestmentTransactionForm({
  action,
  accounts,
  instruments,
  today,
}: {
  action: FormAction;
  accounts: readonly AccountOption[];
  instruments: readonly InstrumentOption[];
  today: string;
}) {
  const [state, dispatch] = useActionState(action, EMPTY_ACTION_STATE);
  const [kind, setKind] = useState<string>('buy');
  const shape = shapeOf(kind);

  const needsInstrument = shape !== 'income' && shape !== 'charge';
  const needsQuantity = shape === 'trade' || shape === 'transferIn' || shape === 'transferOut';
  const allowsCharges = shape === 'trade' || shape === 'income';

  return (
    <form action={dispatch} className="space-y-3">
      <Notice state={state} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field name="kind" label="Kind" state={state}>
          <select
            id="kind"
            name="kind"
            required
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className={FIELD}
          >
            {ORDERED_KINDS.map((value) => (
              <option key={value} value={value}>
                {KIND_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>

        <Field name="accountId" label="Account" state={state}>
          <select id="accountId" name="accountId" required className={FIELD}>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label} · {account.currency}
              </option>
            ))}
          </select>
        </Field>

        <Field
          name="instrumentId"
          label={needsInstrument ? 'Instrument' : 'Instrument (blank = account level)'}
          state={state}
        >
          <select id="instrumentId" name="instrumentId" required={needsInstrument} className={FIELD} defaultValue="">
            {needsInstrument ? null : <option value="">Whole account</option>}
            {instruments.map((instrument) => (
              <option key={instrument.id} value={instrument.id}>
                {instrument.label} · {instrument.currency}
              </option>
            ))}
          </select>
        </Field>

        <Field name="tradeDate" label="Trade date" state={state}>
          <input id="tradeDate" name="tradeDate" type="date" required defaultValue={today} className={FIELD} />
        </Field>

        {needsQuantity ? (
          <>
            <Field name="quantity" label="Quantity" state={state}>
              <input
                id="quantity"
                name="quantity"
                inputMode="decimal"
                required
                className={`${FIELD} tabular`}
                placeholder="100"
              />
            </Field>

            <Field
              name="price"
              label={shape === 'transferIn' ? 'Carried cost per unit' : 'Price per unit'}
              state={state}
            >
              <input id="price" name="price" inputMode="decimal" required className={`${FIELD} tabular`} />
            </Field>
          </>
        ) : null}

        {shape === 'income' ? (
          <Field name="grossAmount" label="Declared amount (gross)" state={state}>
            <input id="grossAmount" name="grossAmount" inputMode="decimal" required className={`${FIELD} tabular`} />
          </Field>
        ) : null}

        {shape === 'charge' ? (
          <Field name="amount" label="Amount" state={state}>
            <input id="amount" name="amount" inputMode="decimal" required className={`${FIELD} tabular`} />
          </Field>
        ) : null}

        {shape === 'ratio' ? (
          <>
            <Field name="ratioNum" label="New units" state={state}>
              <input id="ratioNum" name="ratioNum" inputMode="numeric" required defaultValue="1" className={`${FIELD} tabular`} />
            </Field>
            <Field name="ratioDen" label="per old units" state={state}>
              <input id="ratioDen" name="ratioDen" inputMode="numeric" required defaultValue="1" className={`${FIELD} tabular`} />
            </Field>
          </>
        ) : null}

        {shape === 'transferIn' ? (
          <Field name="originalAcquiredOn" label="Originally acquired on" state={state}>
            <input id="originalAcquiredOn" name="originalAcquiredOn" type="date" className={FIELD} />
          </Field>
        ) : null}

        {allowsCharges ? (
          <>
            <Field name="fees" label="Fees (optional)" state={state}>
              <input id="fees" name="fees" inputMode="decimal" className={`${FIELD} tabular`} />
            </Field>
            <Field name="taxes" label={shape === 'income' ? 'Tax withheld (TDS)' : 'Taxes (optional)'} state={state}>
              <input id="taxes" name="taxes" inputMode="decimal" className={`${FIELD} tabular`} />
            </Field>
          </>
        ) : null}

        <Field name="notes" label="Note (optional)" state={state}>
          <input id="notes" name="notes" className={FIELD} />
        </Field>
      </div>

      <p className="text-xs text-ink-faint">{HINTS[shape]}</p>

      <SubmitButton>Record</SubmitButton>
    </form>
  );
}

const HINTS: Record<Shape, string> = {
  trade:
    'Enter a positive quantity — the kind decides the sign. A purchase fee is capitalised into the lot; a sale fee reduces the proceeds. Neither is counted again in portfolio fees.',
  income:
    'Enter the amount declared, not the amount received. Withholding goes in its own field and is subtracted once, so a ₹500 dividend with ₹50 TDS contributes ₹450 to return and still reads as ₹500 of income.',
  charge:
    'Leave the instrument blank for an annual demat charge: it reduces cash and portfolio return without distorting any holding’s cost basis or allocation weight.',
  ratio:
    'A 1:5 split is 5 new units per 1 old. A ratio moves units only — the total cost basis is untouched, so the per-unit cost changes because it is derived, not because anything divided it.',
  transferIn:
    'Give the original acquisition date. Without it a long-term holding silently becomes short-term, which is a materially wrong tax classification. Transfer charges are recorded separately as a fee.',
  transferOut:
    'The price is recorded for the ledger; it does not affect P&L. A transfer realises exactly nothing, because its proceeds are defined as the cost consumed.',
};

export function PriceForm({
  action,
  instruments,
}: {
  action: FormAction;
  instruments: readonly InstrumentOption[];
}) {
  const [state, dispatch] = useActionState(action, EMPTY_ACTION_STATE);

  return (
    <form action={dispatch} className="space-y-3">
      <Notice state={state} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Field name="instrumentId" label="Instrument" state={state}>
          <select id="instrumentId" name="instrumentId" required className={FIELD}>
            {instruments.map((instrument) => (
              <option key={instrument.id} value={instrument.id}>
                {instrument.label} · {instrument.currency}
              </option>
            ))}
          </select>
        </Field>

        <Field name="price" label="Price per unit" state={state}>
          <input id="price" name="price" inputMode="decimal" required className={`${FIELD} tabular`} />
        </Field>

        <Field name="asOf" label="As of (optional)" state={state}>
          <input id="asOf" name="asOf" type="datetime-local" className={FIELD} />
        </Field>
      </div>

      <p className="text-xs text-ink-faint">
        Prices are entered by hand until Phase 6 adds provider adapters. &ldquo;As of&rdquo; is when
        the price was <em>true</em>, not when it was typed — a NAV entered on Monday for
        Friday&rsquo;s close ages from Friday.
      </p>

      <SubmitButton>Record price</SubmitButton>
    </form>
  );
}
