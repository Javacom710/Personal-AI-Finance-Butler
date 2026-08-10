'use client';

/**
 * The money area's forms.
 *
 * Each is a **concrete** client component taking only serializable props —
 * option lists, dates, strings. An earlier version exposed a generic
 * `<ActionForm>{(state) => …}</ActionForm>` and let each server page supply its
 * fields as a render prop; that is a function passed across the server/client
 * boundary, which React refuses at runtime ("Functions are not valid as a child
 * of Client Components"). It compiled, built, and failed on the first page
 * load. Server actions themselves *are* serializable, so they still cross as
 * props — only the render function could not.
 */

import { useActionState, useState } from 'react';

import { Field, FIELD, SubmitButton, Notice, type FormAction } from './_components';
import { EMPTY_ACTION_STATE } from './form-state';

export interface Option {
  readonly id: string;
  readonly label: string;
}

export interface AccountOption extends Option {
  readonly currency: string;
}

export interface CategoryOption extends Option {
  readonly kind: 'income' | 'expense';
}

const ACCOUNT_KINDS = [
  ['bank', 'Bank'],
  ['cash', 'Cash'],
  ['credit_card', 'Credit card'],
  ['wallet', 'Wallet'],
  ['brokerage', 'Brokerage / demat'],
  ['loan', 'Loan'],
  ['other', 'Other'],
] as const;

export function AccountForm({
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
  const [kind, setKind] = useState<string>('bank');

  return (
    <form action={dispatch} className="space-y-3">
      <Notice state={state} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field name="name" label="Name" state={state}>
          <input id="name" name="name" required className={FIELD} placeholder="HDFC Savings" />
        </Field>

        <Field name="kind" label="Type" state={state}>
          <select
            id="kind"
            name="kind"
            required
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className={FIELD}
          >
            {ACCOUNT_KINDS.map(([value, label]) => (
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

        <Field name="institution" label="Institution (optional)" state={state}>
          <input id="institution" name="institution" className={FIELD} />
        </Field>

        <Field name="openingBalance" label="Opening balance" state={state}>
          <input
            id="openingBalance"
            name="openingBalance"
            inputMode="decimal"
            defaultValue="0"
            className={`${FIELD} tabular`}
          />
        </Field>

        <Field name="openingDate" label="Opening date" state={state}>
          <input id="openingDate" name="openingDate" type="date" required defaultValue={today} className={FIELD} />
        </Field>

        {kind === 'credit_card' ? (
          <Field name="creditLimit" label="Credit limit" state={state}>
            <input id="creditLimit" name="creditLimit" inputMode="decimal" required className={`${FIELD} tabular`} />
          </Field>
        ) : null}
      </div>

      <p className="text-xs text-ink-faint">
        The opening balance is the position <em>before</em> the ledger begins, and it is never edited
        afterwards. Nothing can be booked to this account before its opening date.
      </p>

      <SubmitButton>Create account</SubmitButton>
    </form>
  );
}

export function CategoryForm({
  action,
  parents,
}: {
  action: FormAction;
  parents: readonly CategoryOption[];
}) {
  const [state, dispatch] = useActionState(action, EMPTY_ACTION_STATE);
  const [kind, setKind] = useState<'income' | 'expense'>('expense');

  return (
    <form action={dispatch} className="space-y-3">
      <Notice state={state} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Field name="name" label="Name" state={state}>
          <input id="name" name="name" required className={FIELD} />
        </Field>

        <Field name="kind" label="Kind" state={state}>
          <select
            id="kind"
            name="kind"
            required
            value={kind}
            onChange={(e) => setKind(e.target.value as 'income' | 'expense')}
            className={FIELD}
          >
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </Field>

        <Field name="parentId" label="Parent (optional)" state={state}>
          {/* Only same-kind parents: a child must share its parent's kind. */}
          <select id="parentId" name="parentId" className={FIELD} defaultValue="">
            <option value="">Top level</option>
            {parents
              .filter((p) => p.kind === kind)
              .map((parent) => (
                <option key={parent.id} value={parent.id}>
                  {parent.label}
                </option>
              ))}
          </select>
        </Field>
      </div>

      <SubmitButton>Create category</SubmitButton>
    </form>
  );
}

export function BudgetForm({
  action,
  categories,
  currencies,
  baseCurrency,
  today,
}: {
  action: FormAction;
  categories: readonly Option[];
  currencies: readonly string[];
  baseCurrency: string;
  today: string;
}) {
  const [state, dispatch] = useActionState(action, EMPTY_ACTION_STATE);

  return (
    <form action={dispatch} className="space-y-3">
      <Notice state={state} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field name="categoryId" label="Category" state={state}>
          <select id="categoryId" name="categoryId" required className={FIELD}>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
        </Field>

        <Field name="period" label="Period" state={state}>
          <select id="period" name="period" required className={FIELD}>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="yearly">Yearly (fiscal)</option>
          </select>
        </Field>

        <Field name="amount" label="Amount" state={state}>
          <input id="amount" name="amount" inputMode="decimal" required className={`${FIELD} tabular`} />
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

        <Field name="startsOn" label="Starts" state={state}>
          <input id="startsOn" name="startsOn" type="date" required defaultValue={today} className={FIELD} />
        </Field>

        <Field name="endsOn" label="Ends (optional)" state={state}>
          <input id="endsOn" name="endsOn" type="date" className={FIELD} />
        </Field>
      </div>

      <p className="text-xs text-ink-faint">
        A category budget includes its subcategories — budgeting Food covers Groceries and Dining. A
        budget in another currency is converted at the rate in force on the first day of the period,
        not today.
      </p>

      <SubmitButton>Create budget</SubmitButton>
    </form>
  );
}

const SCHEDULES = [
  ['FREQ=MONTHLY', 'Monthly, on the start date'],
  ['FREQ=MONTHLY;BYMONTHDAY=1', 'Monthly, on the 1st'],
  ['FREQ=MONTHLY;BYMONTHDAY=-1', 'Monthly, on the last day'],
  ['FREQ=MONTHLY;BYMONTHDAY=31', 'Monthly, on the 31st (last day in short months)'],
  ['FREQ=WEEKLY', 'Weekly'],
  ['FREQ=WEEKLY;INTERVAL=2', 'Fortnightly'],
  ['FREQ=DAILY', 'Daily'],
  ['FREQ=MONTHLY;INTERVAL=3', 'Quarterly'],
  ['FREQ=YEARLY', 'Yearly'],
] as const;

export function RecurringRuleForm({
  action,
  accounts,
  categories,
  today,
}: {
  action: FormAction;
  accounts: readonly AccountOption[];
  categories: readonly CategoryOption[];
  today: string;
}) {
  const [state, dispatch] = useActionState(action, EMPTY_ACTION_STATE);
  const [kind, setKind] = useState<'income' | 'expense' | 'transfer'>('expense');
  const isTransfer = kind === 'transfer';

  return (
    <form action={dispatch} className="space-y-3">
      <Notice state={state} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field name="name" label="Name" state={state}>
          <input id="name" name="name" required className={FIELD} placeholder="Rent" />
        </Field>

        <Field name="kind" label="Kind" state={state}>
          <select
            id="kind"
            name="kind"
            required
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
            className={FIELD}
          >
            <option value="expense">Expense</option>
            <option value="income">Income</option>
            <option value="transfer">Transfer</option>
          </select>
        </Field>

        <Field name="amount" label="Amount" state={state}>
          <input id="amount" name="amount" inputMode="decimal" required className={`${FIELD} tabular`} />
        </Field>

        {isTransfer ? (
          <>
            <Field name="fromAccountId" label="From" state={state}>
              <select id="fromAccountId" name="fromAccountId" required className={FIELD}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field name="toAccountId" label="To" state={state}>
              <select id="toAccountId" name="toAccountId" required className={FIELD}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </Field>
          </>
        ) : (
          <>
            <Field name="accountId" label="Account" state={state}>
              <select id="accountId" name="accountId" required className={FIELD}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field name="categoryId" label="Category" state={state}>
              <select id="categoryId" name="categoryId" required className={FIELD}>
                {categories
                  .filter((c) => c.kind === kind)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
              </select>
            </Field>
          </>
        )}

        <Field name="rrule" label="Repeats" state={state}>
          <select id="rrule" name="rrule" required className={FIELD}>
            {SCHEDULES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <Field name="startsOn" label="Starts" state={state}>
          <input id="startsOn" name="startsOn" type="date" required defaultValue={today} className={FIELD} />
        </Field>

        <Field name="endsOn" label="Ends (optional)" state={state}>
          <input id="endsOn" name="endsOn" type="date" className={FIELD} />
        </Field>

        <Field name="description" label="Description on each posting" state={state}>
          <input id="description" name="description" required className={FIELD} />
        </Field>

        <label className="flex items-end gap-2 pb-1.5 text-sm">
          <input type="checkbox" name="autoPost" className="size-4" />
          <span>Post automatically</span>
        </label>
      </div>

      <p className="text-xs text-ink-faint">
        Leave automatic posting off for anything whose amount varies — a utility bill — and confirm
        each one instead. A monthly rule on the 31st falls on the last day of shorter months, so
        February is the 28th or 29th rather than being skipped.
      </p>

      <SubmitButton>Create rule</SubmitButton>
    </form>
  );
}
