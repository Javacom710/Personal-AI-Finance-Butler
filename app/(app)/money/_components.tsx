'use client';

/**
 * Form furniture for the money area.
 *
 * Client components only where interaction requires it: `useActionState` needs
 * the client, everything else on these pages is a server component reading
 * through an application service.
 *
 * Money figures arrive here **already formatted** as strings. `Money` holds a
 * `bigint`, which does not cross the server/client boundary, and formatting on
 * the server keeps `formatMoney` the single renderer of every figure.
 */

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { EMPTY_ACTION_STATE, type ActionState } from './form-state';

export const FIELD =
  'w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent';
export const LABEL = 'block text-xs font-medium text-ink-muted';

export function SubmitButton({
  children,
  variant = 'primary',
}: {
  children: React.ReactNode;
  variant?: 'primary' | 'ghost' | 'danger';
}) {
  const { pending } = useFormStatus();
  const styles =
    variant === 'primary'
      ? 'bg-accent text-accent-ink'
      : variant === 'danger'
        ? 'border border-negative/40 text-negative'
        : 'border border-border text-ink-muted';

  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-60 ${styles}`}
    >
      {pending ? 'Working…' : children}
    </button>
  );
}

export function Field({
  name,
  label,
  state,
  children,
}: {
  name: string;
  label: string;
  state: ActionState;
  children: React.ReactNode;
}) {
  const errors = state.fieldErrors[name];
  return (
    <div className="space-y-1">
      <label htmlFor={name} className={LABEL}>
        {label}
      </label>
      {children}
      {errors?.map((message) => (
        <p key={message} className="text-xs text-negative">
          {message}
        </p>
      ))}
    </div>
  );
}

export function Notice({ state }: { state: ActionState }) {
  if (state.status === 'idle' || !state.message) return null;
  const tone =
    state.status === 'ok'
      ? 'border-positive/40 bg-positive/10 text-positive'
      : 'border-negative/40 bg-negative/10 text-negative';
  return (
    <p role="status" className={`rounded-md border px-3 py-2 text-sm ${tone}`}>
      {state.message}
    </p>
  );
}

/**
 * A server action, as a prop.
 *
 * Server actions **are** serializable across the server/client boundary — they
 * cross as a reference the client calls back through. A render function is not,
 * which is why the concrete forms in `_forms.tsx` take one of these and supply
 * their own fields rather than receiving them from the page.
 */
export type FormAction = (state: ActionState, form: FormData) => Promise<ActionState>;

/** A one-button form — close an account, delete a rule, post an occurrence. */
export function InlineAction({
  action,
  label,
  values,
  variant = 'ghost',
  confirm,
}: {
  action: FormAction;
  label: string;
  values: Record<string, string>;
  variant?: 'primary' | 'ghost' | 'danger';
  confirm?: string;
}) {
  const [state, dispatch] = useActionState(action, EMPTY_ACTION_STATE);

  return (
    <form
      action={dispatch}
      className="inline"
      onSubmit={(event) => {
        // A destructive action confirms; nothing else interrupts the user
        // (ARCHITECTURE.md §8 — modals only for destructive confirmation).
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
    >
      {Object.entries(values).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <SubmitButton variant={variant}>{label}</SubmitButton>
      {state.status === 'error' && state.message ? (
        <span className="ml-2 text-xs text-negative">{state.message}</span>
      ) : null}
    </form>
  );
}

/** A form that stays out of the way until asked for. */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
}: {
  summary: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-medium"
      >
        {summary}
        <span aria-hidden="true" className="text-ink-faint">
          {open ? '−' : '+'}
        </span>
      </button>
      {open ? <div className="border-t border-border p-4">{children}</div> : null}
    </div>
  );
}

/**
 * The transaction composer.
 *
 * Income/expense and transfer are one control with two shapes rather than two
 * forms, because the choice is the first thing the user makes. Keyboard-first:
 * the amount takes focus, and every field is reachable by tab in entry order.
 */
export function QuickAdd({
  entryAction,
  transferAction,
  accounts,
  categories,
  today,
}: {
  entryAction: FormAction;
  transferAction: FormAction;
  accounts: readonly { id: string; name: string; currency: string }[];
  categories: readonly { id: string; label: string; kind: 'income' | 'expense' }[];
  today: string;
}) {
  const [kind, setKind] = useState<'expense' | 'income' | 'transfer'>('expense');
  const isTransfer = kind === 'transfer';

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex gap-1" role="group" aria-label="What are you recording?">
        {(['expense', 'income', 'transfer'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setKind(option)}
            aria-pressed={kind === option}
            className={`rounded-md px-3 py-1 text-sm capitalize ${
              kind === option ? 'bg-accent text-accent-ink' : 'border border-border text-ink-muted'
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      {isTransfer ? (
        <TransferForm action={transferAction} accounts={accounts} today={today} />
      ) : (
        <EntryForm
          action={entryAction}
          kind={kind}
          accounts={accounts}
          categories={categories.filter((c) => c.kind === kind)}
          today={today}
        />
      )}
    </div>
  );
}

function EntryForm({
  action,
  kind,
  accounts,
  categories,
  today,
}: {
  action: FormAction;
  kind: 'income' | 'expense';
  accounts: readonly { id: string; name: string; currency: string }[];
  categories: readonly { id: string; label: string }[];
  today: string;
}) {
  const [state, dispatch] = useActionState(action, EMPTY_ACTION_STATE);
  return (
    <form action={dispatch} className="space-y-3">
      <Notice state={state} />
      <EntryFields state={state} kind={kind} accounts={accounts} categories={categories} today={today} />
    </form>
  );
}

function TransferForm({
  action,
  accounts,
  today,
}: {
  action: FormAction;
  accounts: readonly { id: string; name: string; currency: string }[];
  today: string;
}) {
  const [state, dispatch] = useActionState(action, EMPTY_ACTION_STATE);
  return (
    <form action={dispatch} className="space-y-3">
      <Notice state={state} />
      <TransferFields state={state} accounts={accounts} today={today} />
    </form>
  );
}

function EntryFields({
  state,
  kind,
  accounts,
  categories,
  today,
}: {
  state: ActionState;
  kind: 'income' | 'expense';
  accounts: readonly { id: string; name: string; currency: string }[];
  categories: readonly { id: string; label: string }[];
  today: string;
}) {
  return (
    <>
      <input type="hidden" name="kind" value={kind} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field name="amount" label="Amount" state={state}>
          <input
            id="amount"
            name="amount"
            inputMode="decimal"
            required
            autoFocus
            placeholder="1250.00"
            className={`${FIELD} tabular`}
          />
        </Field>

        <Field name="accountId" label="Account" state={state}>
          <select id="accountId" name="accountId" required className={FIELD}>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.currency})
              </option>
            ))}
          </select>
        </Field>

        <Field name="categoryId" label="Category" state={state}>
          <select id="categoryId" name="categoryId" required className={FIELD}>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
        </Field>

        <Field name="bookedOn" label="Date" state={state}>
          <input
            id="bookedOn"
            name="bookedOn"
            type="date"
            required
            defaultValue={today}
            className={FIELD}
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="description" label="Description" state={state}>
          <input id="description" name="description" required className={FIELD} />
        </Field>
        <Field name="tags" label="Tags (comma separated, optional)" state={state}>
          <input id="tags" name="tags" className={FIELD} placeholder="work, reimbursable" />
        </Field>
      </div>

      <SubmitButton>Record {kind}</SubmitButton>
    </>
  );
}

function TransferFields({
  state,
  accounts,
  today,
}: {
  state: ActionState;
  accounts: readonly { id: string; name: string; currency: string }[];
  today: string;
}) {
  const [fromId, setFromId] = useState(accounts[0]?.id ?? '');
  const [toId, setToId] = useState(accounts[1]?.id ?? accounts[0]?.id ?? '');

  const fromCurrency = accounts.find((a) => a.id === fromId)?.currency;
  const toCurrency = accounts.find((a) => a.id === toId)?.currency;
  const crossCurrency = Boolean(fromCurrency && toCurrency && fromCurrency !== toCurrency);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field name="fromAccountId" label="From" state={state}>
          <select
            id="fromAccountId"
            name="fromAccountId"
            required
            value={fromId}
            onChange={(e) => setFromId(e.target.value)}
            className={FIELD}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </select>
        </Field>

        <Field name="toAccountId" label="To" state={state}>
          <select
            id="toAccountId"
            name="toAccountId"
            required
            value={toId}
            onChange={(e) => setToId(e.target.value)}
            className={FIELD}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </select>
        </Field>

        {crossCurrency ? (
          <>
            <Field name="fromAmount" label={`Debited (${fromCurrency})`} state={state}>
              <input
                id="fromAmount"
                name="fromAmount"
                inputMode="decimal"
                required
                className={`${FIELD} tabular`}
              />
            </Field>
            <Field name="toAmount" label={`Credited (${toCurrency})`} state={state}>
              <input
                id="toAmount"
                name="toAmount"
                inputMode="decimal"
                required
                className={`${FIELD} tabular`}
              />
            </Field>
          </>
        ) : (
          <>
            <Field name="amount" label="Amount" state={state}>
              <input
                id="amount"
                name="amount"
                inputMode="decimal"
                required
                autoFocus
                className={`${FIELD} tabular`}
              />
            </Field>
            <Field name="bookedOn" label="Date" state={state}>
              <input
                id="bookedOn"
                name="bookedOn"
                type="date"
                required
                defaultValue={today}
                className={FIELD}
              />
            </Field>
          </>
        )}
      </div>

      {crossCurrency ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="bookedOn" label="Date" state={state}>
            <input
              id="bookedOn"
              name="bookedOn"
              type="date"
              required
              defaultValue={today}
              className={FIELD}
            />
          </Field>
          <p className="self-end text-xs text-ink-faint">
            Enter both amounts exactly as they appear on the two statements. The difference between
            them in {' '}
            <abbr title="your base currency">base</abbr> currency is a realised exchange effect, and
            is reported as such rather than folded into either figure.
          </p>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="description" label="Description" state={state}>
          <input id="description" name="description" required className={FIELD} />
        </Field>
        <Field name="tags" label="Tags (comma separated, optional)" state={state}>
          <input id="tags" name="tags" className={FIELD} />
        </Field>
      </div>

      <p className="text-xs text-ink-faint">
        A transfer moves money between your own accounts. It is never counted as income or spending.
      </p>

      <SubmitButton>Record transfer</SubmitButton>
    </>
  );
}
