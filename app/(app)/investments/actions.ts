'use server';

/**
 * Server actions for the investment area.
 *
 * Every one is its own entry point, reachable directly by POST, so every one
 * calls `requireSession` itself rather than trusting the layout (SECURITY.md
 * §2). Authentication happens here; **authorization happens in the services**,
 * per entity.
 *
 * Mutations run through `withWriteCtxResult`, not `withWriteCtx`: an investment
 * write can fail *after* its row is inserted — the rebuild that follows it
 * discovers an oversell — and only the `Result` form rolls that back.
 */

import { revalidatePath } from 'next/cache';

import { requireSession } from '@/server/auth/guards';
import type { DomainError, Result } from '@/lib/result';
import { createReadCtx, withWriteCtxResult, type WriteCtx } from '@/server/services';
import {
  createInstrumentRecord,
  createInvestmentTransactionRecord,
  deleteInstrumentById,
  deleteInvestmentTransactionById,
  rebuildPositionsRecord,
  setInstrumentActiveById,
  setPriceRecord,
} from './_operations';
import { failure, success, type ActionState } from '../money/form-state';

async function withCtx<T>(
  fn: (ctx: WriteCtx) => Promise<Result<T, DomainError>>,
): Promise<Result<T, DomainError>> {
  const session = await requireSession('/investments');
  const read = await createReadCtx(session.userId);
  if (!read.ok) throw new Error(read.error.message);
  return withWriteCtxResult(read.value, fn);
}

function refresh(): void {
  revalidatePath('/investments');
  revalidatePath('/investments/instruments');
  revalidatePath('/investments/transactions');
  revalidatePath('/investments/allocation');
  revalidatePath('/investments/performance');
  // A trade moves brokerage cash, so every money surface that shows a balance
  // is stale the moment one lands.
  revalidatePath('/money');
  revalidatePath('/money/accounts');
}

export async function createInstrumentAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const result = await withCtx((ctx) => createInstrumentRecord(ctx, form));
  if (!result.ok) return failure(result.error);
  refresh();
  return success('Instrument added.');
}

export async function setInstrumentActiveAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const result = await withCtx((ctx) => setInstrumentActiveById(ctx, form));
  if (!result.ok) return failure(result.error);
  refresh();
  return success(form.get('isActive') === 'true' ? 'Instrument reactivated.' : 'Instrument deactivated.');
}

export async function deleteInstrumentAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const result = await withCtx((ctx) => deleteInstrumentById(ctx, form));
  if (!result.ok) return failure(result.error);
  refresh();
  return success('Instrument deleted.');
}

export async function setPriceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const result = await withCtx((ctx) => setPriceRecord(ctx, form));
  if (!result.ok) return failure(result.error);
  refresh();
  return success('Price recorded.');
}

export async function createInvestmentTransactionAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const result = await withCtx((ctx) => createInvestmentTransactionRecord(ctx, form));
  if (!result.ok) return failure(result.error);
  refresh();
  return success('Recorded.');
}

export async function deleteInvestmentTransactionAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const result = await withCtx((ctx) => deleteInvestmentTransactionById(ctx, form));
  if (!result.ok) return failure(result.error);
  refresh();
  return success('Deleted, and the position re-derived.');
}

export async function rebuildPositionsAction(_prev: ActionState): Promise<ActionState> {
  const result = await withCtx((ctx) => rebuildPositionsRecord(ctx));
  if (!result.ok) return failure(result.error);
  refresh();
  return success('Positions rebuilt from the ledger.');
}
