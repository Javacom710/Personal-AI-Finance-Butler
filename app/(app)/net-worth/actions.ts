'use server';

/**
 * Server actions for the Net Worth area.
 *
 * Every one is its own entry point, reachable directly by POST — so every one
 * calls `requireSession` itself rather than trusting the layout (SECURITY.md
 * §2). Authentication happens here; **authorization happens in the services**,
 * per entity.
 *
 * **There is no action that writes net worth**, because there is nothing to
 * write: net worth is derived on every read (ADR-24). The actions below touch
 * only the two Phase 5 entities that are genuinely stored.
 *
 * A `'use server'` module may export only async functions — the shared state
 * shape lives in `../money/form-state.ts`, and
 * `tests/unit/server-actions.test.ts` guards the rule.
 */

import { revalidatePath } from 'next/cache';

import { requireSession } from '@/server/auth/guards';
import { createReadCtx, withWriteCtxResult, type WriteCtx } from '@/server/services';
import type { DomainError, Result } from '@/lib/result';
import { failure, success, type ActionState } from '../money/form-state';
import {
  closeLiabilityFromForm,
  createAssetFromForm,
  createLiabilityFromForm,
  deleteAssetById,
  deleteLiabilityById,
  disposeAssetFromForm,
  recordBalanceFromForm,
  revalueAssetFromForm,
} from './_operations';

/**
 * `withWriteCtxResult`, not `withWriteCtx`: returning an error value from inside
 * an open transaction does not undo the writes already made in it (D-26).
 * Creating an asset inserts a header *and* its first valuation, so a failure on
 * the second must not leave the first behind.
 */
async function withCtx<T>(
  fn: (ctx: WriteCtx) => Promise<Result<T, DomainError>>,
): Promise<Result<T, DomainError>> {
  const session = await requireSession('/net-worth');
  const read = await createReadCtx(session.userId);
  if (!read.ok) throw new Error(read.error.message);
  return withWriteCtxResult(read.value, fn);
}

function refresh(): void {
  revalidatePath('/net-worth');
  revalidatePath('/net-worth/assets');
  revalidatePath('/net-worth/liabilities');
  revalidatePath('/net-worth/history');
  revalidatePath('/net-worth/change');
}

// -------------------------------------------------------------- manual assets

export async function createAssetAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const result = await withCtx((ctx) => createAssetFromForm(ctx, form));
  if (!result.ok) return failure(result.error);
  refresh();
  return success('Asset added, with its first valuation.');
}

export async function revalueAssetAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const result = await withCtx((ctx) => revalueAssetFromForm(ctx, form));
  if (!result.ok) return failure(result.error);
  refresh();
  return success('Valuation recorded. Earlier figures are unchanged.');
}

export async function disposeAssetAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const result = await withCtx((ctx) => disposeAssetFromForm(ctx, form));
  if (!result.ok) return failure(result.error);
  refresh();
  return success('Disposed. It stops counting from that date and stays in every earlier figure.');
}

export async function deleteAssetAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const id = form.get('assetId');
  if (typeof id !== 'string') return failure({ code: 'not_found', message: 'No asset given.' } as DomainError);
  const result = await withCtx((ctx) => deleteAssetById(ctx, id));
  if (!result.ok) return failure(result.error);
  refresh();
  return success('Asset deleted.');
}

// ---------------------------------------------------------------- liabilities

export async function createLiabilityAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const result = await withCtx((ctx) => createLiabilityFromForm(ctx, form));
  if (!result.ok) return failure(result.error);
  refresh();
  return success('Liability added.');
}

export async function recordBalanceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const result = await withCtx((ctx) => recordBalanceFromForm(ctx, form));
  if (!result.ok) return failure(result.error);
  refresh();
  return success('Balance recorded. Earlier figures are unchanged.');
}

export async function closeLiabilityAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const result = await withCtx((ctx) => closeLiabilityFromForm(ctx, form));
  if (!result.ok) return failure(result.error);
  refresh();
  return success('Closed, with a zero balance recorded on that date.');
}

export async function deleteLiabilityAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = form.get('liabilityId');
  if (typeof id !== 'string') {
    return failure({ code: 'not_found', message: 'No liability given.' } as DomainError);
  }
  const result = await withCtx((ctx) => deleteLiabilityById(ctx, id));
  if (!result.ok) return failure(result.error);
  refresh();
  return success('Liability deleted.');
}
