/**
 * `FormData` → service call.
 *
 * Kept out of `actions.ts` because that module may export only async server
 * functions, and because translating a form is not itself a server action —
 * separating them keeps the endpoint surface exactly as wide as the list of
 * actions.
 *
 * Nothing here validates: the Zod schemas in `src/lib/schemas/money.ts` are the
 * single validation boundary (ADR-16). These functions only reshape strings.
 */

import type { DomainError, Result } from '@/lib/result';
import { ok } from '@/lib/result';
import * as services from '@/server/services';
import type { WriteCtx } from '@/server/services';

const text = (form: FormData, key: string): string | undefined => {
  const value = form.get(key);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

const required = (form: FormData, key: string): string => text(form, key) ?? '';

/** `travel, food` → `['travel', 'food']`. Empty input means no tags, not one empty tag. */
const tagList = (form: FormData, key = 'tags'): string[] =>
  (text(form, key) ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

export async function createAccount(ctx: WriteCtx, form: FormData): Promise<Result<unknown, DomainError>> {
  return services.createAccount(ctx, {
    name: required(form, 'name'),
    kind: required(form, 'kind'),
    institution: text(form, 'institution'),
    currencyCode: required(form, 'currencyCode'),
    openingBalance: text(form, 'openingBalance') ?? '0',
    openingDate: required(form, 'openingDate'),
    creditLimit: text(form, 'creditLimit'),
    notes: text(form, 'notes'),
  });
}

export async function setAccountActiveById(
  ctx: WriteCtx,
  form: FormData,
): Promise<Result<unknown, DomainError>> {
  return services.setAccountActive(ctx, required(form, 'id'), form.get('isActive') === 'true');
}

export async function deleteAccountById(
  ctx: WriteCtx,
  form: FormData,
): Promise<Result<void, DomainError>> {
  return services.deleteAccount(ctx, required(form, 'id'));
}

export async function createTransactionRecord(
  ctx: WriteCtx,
  form: FormData,
): Promise<Result<unknown, DomainError>> {
  return services.createTransaction(ctx, {
    kind: required(form, 'kind'),
    accountId: required(form, 'accountId'),
    categoryId: required(form, 'categoryId'),
    amount: required(form, 'amount'),
    bookedOn: required(form, 'bookedOn'),
    description: required(form, 'description'),
    notes: text(form, 'notes'),
    tags: tagList(form),
  });
}

export async function updateTransactionRecord(
  ctx: WriteCtx,
  form: FormData,
): Promise<Result<unknown, DomainError>> {
  return services.updateTransaction(ctx, required(form, 'id'), {
    accountId: text(form, 'accountId'),
    categoryId: text(form, 'categoryId'),
    amount: text(form, 'amount'),
    bookedOn: text(form, 'bookedOn'),
    description: text(form, 'description'),
    notes: text(form, 'notes') ?? null,
    tags: tagList(form),
  });
}

export async function deleteTransactionById(
  ctx: WriteCtx,
  form: FormData,
): Promise<Result<void, DomainError>> {
  return services.deleteTransaction(ctx, required(form, 'id'));
}

export interface TransferOutcome {
  readonly fxNote: string | null;
}

export async function createTransferRecord(
  ctx: WriteCtx,
  form: FormData,
): Promise<Result<TransferOutcome, DomainError>> {
  const result = await services.createTransfer(ctx, {
    fromAccountId: required(form, 'fromAccountId'),
    toAccountId: required(form, 'toAccountId'),
    amount: text(form, 'amount'),
    fromAmount: text(form, 'fromAmount'),
    toAmount: text(form, 'toAmount'),
    bookedOn: required(form, 'bookedOn'),
    description: required(form, 'description'),
    notes: text(form, 'notes'),
    tags: tagList(form),
  });

  if (!result.ok) return result;

  // A cross-currency transfer leaves a residual: the realised FX difference.
  // Surfaced rather than absorbed, so the user sees where it went.
  return ok({
    fxNote: services.hasFxResidual(result.value)
      ? 'Transfer recorded. The difference between the two amounts is a realised exchange effect — it is reported separately and is neither income nor spending.'
      : null,
  });
}

export async function createCategory(
  ctx: WriteCtx,
  form: FormData,
): Promise<Result<unknown, DomainError>> {
  return services.createCategory(ctx, {
    name: required(form, 'name'),
    kind: required(form, 'kind'),
    parentId: text(form, 'parentId') ?? null,
  });
}

export async function deleteCategoryById(
  ctx: WriteCtx,
  form: FormData,
): Promise<Result<void, DomainError>> {
  return services.deleteCategory(ctx, required(form, 'id'));
}

export async function createBudget(
  ctx: WriteCtx,
  form: FormData,
): Promise<Result<string, DomainError>> {
  return services.createBudget(ctx, {
    categoryId: required(form, 'categoryId'),
    period: required(form, 'period'),
    amount: required(form, 'amount'),
    currencyCode: required(form, 'currencyCode'),
    startsOn: required(form, 'startsOn'),
    endsOn: text(form, 'endsOn') ?? null,
  });
}

export async function deleteBudgetById(
  ctx: WriteCtx,
  form: FormData,
): Promise<Result<void, DomainError>> {
  return services.deleteBudget(ctx, required(form, 'id'));
}

export async function createRecurringRule(
  ctx: WriteCtx,
  form: FormData,
): Promise<Result<string, DomainError>> {
  const kind = required(form, 'kind');

  const template =
    kind === 'transfer'
      ? {
          kind,
          fromAccountId: required(form, 'fromAccountId'),
          toAccountId: required(form, 'toAccountId'),
          amount: required(form, 'amount'),
          description: required(form, 'description'),
          notes: text(form, 'notes'),
        }
      : {
          kind,
          accountId: required(form, 'accountId'),
          categoryId: required(form, 'categoryId'),
          amount: required(form, 'amount'),
          description: required(form, 'description'),
          notes: text(form, 'notes'),
        };

  return services.createRule(ctx, {
    name: required(form, 'name'),
    template,
    rrule: required(form, 'rrule'),
    startsOn: required(form, 'startsOn'),
    endsOn: text(form, 'endsOn') ?? null,
    autoPost: form.get('autoPost') === 'on',
  });
}

export async function deleteRuleById(
  ctx: WriteCtx,
  form: FormData,
): Promise<Result<void, DomainError>> {
  return services.deleteRule(ctx, required(form, 'id'));
}

export async function postOccurrenceById(
  ctx: WriteCtx,
  form: FormData,
): Promise<Result<{ readonly message: string }, DomainError>> {
  const result = await services.postOccurrence(ctx, required(form, 'id'), { allowFuture: true });
  if (!result.ok) return result;

  switch (result.value.status) {
    case 'posted':
      return ok({ message: 'Posted.' });
    case 'already_settled':
      return ok({ message: 'Already settled — nothing was posted a second time.' });
    case 'not_due':
      return ok({ message: `Not due until ${result.value.dueOn}.` });
  }
}

export async function skipOccurrenceById(
  ctx: WriteCtx,
  form: FormData,
): Promise<Result<unknown, DomainError>> {
  return services.skipOccurrence(ctx, required(form, 'id'));
}
