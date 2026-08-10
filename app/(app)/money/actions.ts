'use server';

/**
 * Server actions for the money area.
 *
 * Every one of these is its own entry point, reachable directly by POST — so
 * every one calls `requireSession` itself rather than trusting the layout
 * (SECURITY.md §2). Authentication happens here; **authorization happens in the
 * services**, per entity, which is why these functions do almost nothing beyond
 * translating a `FormData` into a service call.
 *
 * A `'use server'` module may export only async functions: every export becomes
 * a callable endpoint. `tests/unit/server-actions.test.ts` guards that rule —
 * the shared state shape lives in `form-state.ts`.
 */

import { revalidatePath } from 'next/cache';

import { requireSession } from '@/server/auth/guards';
import { createReadCtx, materialiseOccurrences, withWriteCtx, type WriteCtx } from '@/server/services';
import {
  createAccount,
  createBudget,
  createCategory,
  createRecurringRule,
  createTransactionRecord,
  createTransferRecord,
  deleteAccountById,
  deleteBudgetById,
  deleteCategoryById,
  deleteRuleById,
  deleteTransactionById,
  postOccurrenceById,
  setAccountActiveById,
  skipOccurrenceById,
  updateTransactionRecord,
} from './_operations';
import { failure, success, type ActionState } from './form-state';

async function withCtx<T>(fn: (ctx: WriteCtx) => Promise<T>): Promise<T> {
  const session = await requireSession('/money');
  const read = await createReadCtx(session.userId);
  if (!read.ok) throw new Error(read.error.message);
  return withWriteCtx(read.value, fn);
}

function refresh(): void {
  revalidatePath('/money');
  revalidatePath('/money/accounts');
  revalidatePath('/money/transactions');
  revalidatePath('/money/budgets');
  revalidatePath('/money/recurring');
  revalidatePath('/money/categories');
}

export async function createAccountAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const result = await withCtx((ctx) => createAccount(ctx, form));
  if (!result.ok) return failure(result.error);
  refresh();
  return success('Account created.');
}

export async function setAccountActiveAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const result = await withCtx((ctx) => setAccountActiveById(ctx, form));
  if (!result.ok) return failure(result.error);
  refresh();
  return success(form.get('isActive') === 'true' ? 'Account reopened.' : 'Account closed.');
}

export async function deleteAccountAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const result = await withCtx((ctx) => deleteAccountById(ctx, form));
  if (!result.ok) return failure(result.error);
  refresh();
  return success('Account deleted.');
}

export async function createTransactionAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const result = await withCtx((ctx) => createTransactionRecord(ctx, form));
  if (!result.ok) return failure(result.error);
  refresh();
  return success('Recorded.');
}

export async function createTransferAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const result = await withCtx((ctx) => createTransferRecord(ctx, form));
  if (!result.ok) return failure(result.error);
  refresh();
  return success(
    result.value.fxNote ?? 'Transfer recorded. It counts as neither income nor spending.',
  );
}

export async function updateTransactionAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const result = await withCtx((ctx) => updateTransactionRecord(ctx, form));
  if (!result.ok) return failure(result.error);
  refresh();
  return success('Updated. Every balance from that date onward is recomputed on the next read.');
}

export async function deleteTransactionAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const result = await withCtx((ctx) => deleteTransactionById(ctx, form));
  if (!result.ok) return failure(result.error);
  refresh();
  return success('Deleted.');
}

export async function createCategoryAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const result = await withCtx((ctx) => createCategory(ctx, form));
  if (!result.ok) return failure(result.error);
  refresh();
  return success('Category created.');
}

export async function deleteCategoryAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const result = await withCtx((ctx) => deleteCategoryById(ctx, form));
  if (!result.ok) return failure(result.error);
  refresh();
  return success('Category deleted.');
}

export async function createBudgetAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const result = await withCtx((ctx) => createBudget(ctx, form));
  if (!result.ok) return failure(result.error);
  refresh();
  return success('Budget created.');
}

export async function deleteBudgetAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const result = await withCtx((ctx) => deleteBudgetById(ctx, form));
  if (!result.ok) return failure(result.error);
  refresh();
  return success('Budget removed.');
}

export async function createRecurringRuleAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const result = await withCtx((ctx) => createRecurringRule(ctx, form));
  if (!result.ok) return failure(result.error);
  refresh();
  return success('Recurring rule created.');
}

export async function deleteRecurringRuleAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const result = await withCtx((ctx) => deleteRuleById(ctx, form));
  if (!result.ok) return failure(result.error);
  refresh();
  return success('Rule deleted. Transactions it already posted are untouched.');
}

export async function postOccurrenceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const result = await withCtx((ctx) => postOccurrenceById(ctx, form));
  if (!result.ok) return failure(result.error);
  refresh();
  return success(result.value.message);
}

export async function skipOccurrenceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const result = await withCtx((ctx) => skipOccurrenceById(ctx, form));
  if (!result.ok) return failure(result.error);
  refresh();
  return success('Skipped.');
}

/** Materialise upcoming occurrences on demand, so the page is not waiting on a cron run. */
export async function refreshRecurringAction(
  _prev: ActionState,
  _form: FormData,
): Promise<ActionState> {
  const result = await withCtx((ctx) => materialiseOccurrences(ctx));
  if (!result.ok) return failure(result.error);
  refresh();
  return success(`${result.value.created} upcoming occurrence(s) scheduled.`);
}
