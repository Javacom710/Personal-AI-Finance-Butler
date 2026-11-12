'use server';
import { revalidatePath } from 'next/cache';
import { requireSession } from '@/server/auth/guards';
import { applyTransactionProposal, createReadCtx, rejectTransactionProposal } from '@/server/services';
import { failure, success, type ActionState } from '../form-state';
import type { ProposalReviewState, ReviewEdits } from './review-state';
import { redirect } from 'next/navigation';
import { isTier1GenerationReleased } from '@/server/ai-feature-release';
import { composeTier1Features } from '@/server/ai-tier1-features';

/** Hard release boundary: no runtime/provider is composed before lineup approval. */
export async function draftTransactionAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession('/money/proposals');
  if (!isTier1GenerationReleased()) return { status: 'error', message: 'Natural-language drafts are awaiting setup approval. Please use manual entry for now.', fieldErrors: {} };
  const ctx = await createReadCtx(session.userId);
  if (!ctx.ok) return failure(ctx.error);
  const result = await composeTier1Features(ctx.value).draftTransaction(form instanceof FormData ? form.get('text') : null);
  if (!result.ok) return failure(result.error);
  revalidatePath('/money/proposals');
  redirect('/money/proposals');
}
export async function confirmTransactionProposalAction(previous: ProposalReviewState, form: FormData): Promise<ProposalReviewState> {
  const session = await requireSession('/money/proposals');
  const text = (key: string) => { const v = form.get(key); return typeof v === 'string' ? v : ''; };
  const edits: ReviewEdits = {
    kind: text('kind'), bookedOn: text('bookedOn'), description: text('description'),
    amount: text('amount'), currency: text('currency'), accountId: text('accountId'),
    toAccountId: text('toAccountId'), categoryId: text('categoryId'), toAmount: text('toAmount'),
    notes: text('notes'), tags: text('tags'),
  };
  const revision = Number.isSafeInteger(previous.revision) ? (previous.revision ?? 0) + 1 : 1;
  const ctx = await createReadCtx(session.userId);
  if (!ctx.ok) return { ...failure(ctx.error), edits, revision };
  const nullable = (key: string) => text(key).trim() || null;
  const result = await applyTransactionProposal(ctx.value, {
    proposalId: text('proposalId'), confirmed: text('confirmed') === 'true', reviewAcknowledged: text('reviewAcknowledged') === 'true',
    values: { kind: text('kind'), bookedOn: text('bookedOn'), description: text('description'), amount: text('amount'), currency: text('currency'), accountId: text('accountId'), toAccountId: nullable('toAccountId'), categoryId: nullable('categoryId'), toAmount: nullable('toAmount'), notes: nullable('notes'), tags: text('tags').split(',').map(t => t.trim()).filter(Boolean) },
  });
  if (!result.ok) return { ...failure(result.error), edits, revision };
  for (const route of ['/money', '/money/proposals', '/money/transactions', '/money/accounts', '/money/budgets', '/net-worth', '/net-worth/market']) revalidatePath(route);
  return success('Transaction recorded after your confirmation.');
}
export async function rejectTransactionProposalAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession('/money/proposals');
  const ctx = await createReadCtx(session.userId);
  if (!ctx.ok) return failure(ctx.error);
  const result = await rejectTransactionProposal(ctx.value, form.get('proposalId'));
  if (!result.ok) return failure(result.error);
  revalidatePath('/money/proposals');
  return success('Draft rejected. No financial record was created.');
}
