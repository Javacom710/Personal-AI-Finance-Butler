'use client';

/**
 * The Net Worth area's forms.
 *
 * Each is a **concrete** client component taking only serializable props, for
 * the reason recorded in `money/_forms.tsx`: a render prop is a function crossing
 * the server/client boundary, which React refuses at runtime after compiling and
 * building cleanly.
 *
 * There is no form here for editing a valuation or a balance, because there is
 * no such operation — revaluing inserts, and updating in place would rewrite
 * every historical figure derived from it.
 */

import { useActionState, useState } from 'react';

import { Field, FIELD, Notice, SubmitButton, type FormAction } from '../money/_components';
import { EMPTY_ACTION_STATE } from '../money/form-state';

const ASSET_KINDS = [
  ['property', 'Property'],
  ['vehicle', 'Vehicle'],
  ['gold_physical', 'Physical gold'],
  ['collectible', 'Collectible'],
  ['receivable', 'Receivable'],
  ['other', 'Other'],
] as const;

const LIABILITY_KINDS = [
  ['home_loan', 'Home loan'],
  ['auto_loan', 'Auto loan'],
  ['personal_loan', 'Personal loan'],
  ['student_loan', 'Student loan'],
  ['credit_card', 'Credit card'],
  ['other', 'Other'],
] as const;

export interface AccountOption {
  readonly id: string;
  readonly label: string;
}

export function AssetForm({
  action,
  currencies,
  baseCurrency,
  today,
}: {
  action: FormAction;
  currencies: readonly string[];
  baseCurrency: string;
  today: string;
}) {
  const [state, dispatch] = useActionState(action, EMPTY_ACTION_STATE);

  return (
    <form action={dispatch} className="space-y-3">
      <Notice state={state} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field name="name" label="Name" state={state}>
          <input id="name" name="name" required className={FIELD} placeholder="Flat, Bandra" />
        </Field>

        <Field name="kind" label="Type" state={state}>
          <select id="kind" name="kind" defaultValue="property" className={FIELD}>
            {ASSET_KINDS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <Field name="currencyCode" label="Currency" state={state}>
          <select id="currencyCode" name="currencyCode" defaultValue={baseCurrency} className={FIELD}>
            {currencies.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </Field>

        <Field
          name="value"
          label="Current value"
          state={state}
          hint="An asset needs a valuation to count. Revaluing later adds a row rather than replacing this one."
        >
          <input id="value" name="value" required inputMode="decimal" className={FIELD} />
        </Field>

        <Field name="valuedOn" label="Valued on" state={state}>
          <input id="valuedOn" name="valuedOn" type="date" defaultValue={today} className={FIELD} />
        </Field>

        <Field name="acquiredOn" label="Acquired on (optional)" state={state}>
          <input id="acquiredOn" name="acquiredOn" type="date" className={FIELD} />
        </Field>

        <Field name="acquisitionCost" label="Acquisition cost (optional)" state={state}>
          <input id="acquisitionCost" name="acquisitionCost" inputMode="decimal" className={FIELD} />
        </Field>
      </div>

      <SubmitButton>Add asset</SubmitButton>
    </form>
  );
}

export function RevalueForm({
  action,
  assetId,
  today,
}: {
  action: FormAction;
  assetId: string;
  today: string;
}) {
  const [state, dispatch] = useActionState(action, EMPTY_ACTION_STATE);

  return (
    <form action={dispatch} className="space-y-3">
      <Notice state={state} />
      <input type="hidden" name="assetId" value={assetId} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Field name="value" label="New value" state={state}>
          <input id="value" name="value" required inputMode="decimal" className={FIELD} />
        </Field>
        <Field name="asOf" label="As of" state={state}>
          <input id="asOf" name="asOf" type="date" required defaultValue={today} className={FIELD} />
        </Field>
        <Field name="note" label="Note (optional)" state={state}>
          <input id="note" name="note" className={FIELD} placeholder="Broker estimate" />
        </Field>
      </div>

      <SubmitButton>Record valuation</SubmitButton>
    </form>
  );
}

export function DisposeForm({
  action,
  assetId,
  today,
}: {
  action: FormAction;
  assetId: string;
  today: string;
}) {
  const [state, dispatch] = useActionState(action, EMPTY_ACTION_STATE);

  return (
    <form action={dispatch} className="space-y-3">
      <Notice state={state} />
      <input type="hidden" name="assetId" value={assetId} />

      <Field
        name="disposedOn"
        label="Disposed on"
        state={state}
        hint="It stops counting from this date. Every earlier figure is unchanged — record the sale proceeds separately as a receipt into an account."
      >
        <input
          id="disposedOn"
          name="disposedOn"
          type="date"
          required
          defaultValue={today}
          className={FIELD}
        />
      </Field>

      <SubmitButton>Dispose</SubmitButton>
    </form>
  );
}

/**
 * Two shapes in one form, switched by whether an account is linked.
 *
 * A **transacted** liability takes its outstanding from the linked account, so
 * the balance fields disappear: storing a figure nothing reads is how a second
 * source of truth begins.
 */
export function LiabilityForm({
  action,
  currencies,
  baseCurrency,
  today,
  linkableAccounts,
}: {
  action: FormAction;
  currencies: readonly string[];
  baseCurrency: string;
  today: string;
  linkableAccounts: readonly AccountOption[];
}) {
  const [state, dispatch] = useActionState(action, EMPTY_ACTION_STATE);
  const [linked, setLinked] = useState<string>('');

  return (
    <form action={dispatch} className="space-y-3">
      <Notice state={state} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field name="name" label="Name" state={state}>
          <input id="name" name="name" required className={FIELD} placeholder="Home loan" />
        </Field>

        <Field name="kind" label="Type" state={state}>
          <select id="kind" name="kind" defaultValue="home_loan" className={FIELD}>
            {LIABILITY_KINDS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <Field name="currencyCode" label="Currency" state={state}>
          <select id="currencyCode" name="currencyCode" defaultValue={baseCurrency} className={FIELD}>
            {currencies.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </Field>

        <Field
          name="linkedAccountId"
          label="Linked account (optional)"
          state={state}
          hint="Link a credit card or loan account and the balance comes from it — this row then carries no money of its own."
        >
          <select
            id="linkedAccountId"
            name="linkedAccountId"
            value={linked}
            onChange={(e) => setLinked(e.target.value)}
            className={FIELD}
          >
            <option value="">Not linked — track by statement balance</option>
            {linkableAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </Field>

        {linked === '' ? (
          <>
            <Field name="openingBalance" label="Outstanding now" state={state}>
              <input
                id="openingBalance"
                name="openingBalance"
                required
                inputMode="decimal"
                className={FIELD}
              />
            </Field>
            <Field name="openingBalanceOn" label="As of" state={state}>
              <input
                id="openingBalanceOn"
                name="openingBalanceOn"
                type="date"
                defaultValue={today}
                className={FIELD}
              />
            </Field>
          </>
        ) : null}

        <Field name="interestRate" label="Interest rate (optional)" state={state} hint="Recorded, never used to compute a schedule.">
          <input id="interestRate" name="interestRate" inputMode="decimal" className={FIELD} placeholder="0.0850" />
        </Field>

        <Field name="emiAmount" label="EMI (optional)" state={state}>
          <input id="emiAmount" name="emiAmount" inputMode="decimal" className={FIELD} />
        </Field>

        <Field name="startedOn" label="Started on (optional)" state={state}>
          <input id="startedOn" name="startedOn" type="date" className={FIELD} />
        </Field>
      </div>

      <SubmitButton>Add liability</SubmitButton>
    </form>
  );
}

export function RecordBalanceForm({
  action,
  liabilityId,
  today,
}: {
  action: FormAction;
  liabilityId: string;
  today: string;
}) {
  const [state, dispatch] = useActionState(action, EMPTY_ACTION_STATE);

  return (
    <form action={dispatch} className="space-y-3">
      <Notice state={state} />
      <input type="hidden" name="liabilityId" value={liabilityId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="outstanding" label="Outstanding" state={state}>
          <input id="outstanding" name="outstanding" required inputMode="decimal" className={FIELD} />
        </Field>
        <Field name="asOf" label="As of" state={state}>
          <input id="asOf" name="asOf" type="date" required defaultValue={today} className={FIELD} />
        </Field>
      </div>

      <SubmitButton>Record balance</SubmitButton>
    </form>
  );
}

export function CloseLiabilityForm({
  action,
  liabilityId,
  today,
}: {
  action: FormAction;
  liabilityId: string;
  today: string;
}) {
  const [state, dispatch] = useActionState(action, EMPTY_ACTION_STATE);

  return (
    <form action={dispatch} className="space-y-3">
      <Notice state={state} />
      <input type="hidden" name="liabilityId" value={liabilityId} />

      <Field
        name="closedOn"
        label="Closed on"
        state={state}
        hint="A zero balance is recorded on this date, which is what stops it counting — the flag alone changes nothing."
      >
        <input id="closedOn" name="closedOn" type="date" required defaultValue={today} className={FIELD} />
      </Field>

      <SubmitButton>Close</SubmitButton>
    </form>
  );
}
