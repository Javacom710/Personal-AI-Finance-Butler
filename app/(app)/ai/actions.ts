'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createReadCtx, createConversation, renameConversation, archiveConversation, deleteConversation } from '@/server/services';
import { failure, success, type ActionState } from '../money/form-state';
import { requireSession } from '@/server/auth/guards';
import { isTier1GenerationReleased } from '@/server/ai-feature-release';
import { composeTier1Features } from '@/server/ai-tier1-features';
type QuestionActionState = ActionState | { status: 'unavailable'; message: string };

/** No runtime is composed before the owner accepts a measured lineup. */
export async function askFinanceQuestionAction(_previous?: QuestionActionState, form?: FormData): Promise<QuestionActionState> {
  const session = await requireSession('/ai');
  if (!isTier1GenerationReleased()) return { status: 'unavailable', message: 'The financial assistant is awaiting setup approval. Your question has not been sent to a model.' };
  const ctx = await createReadCtx(session.userId);
  if (!ctx.ok) return failure(ctx.error);
  const result = await composeTier1Features(ctx.value).askConversation(form instanceof FormData ? form.get('conversationId') : null, form instanceof FormData ? form.get('question') : null);
  if (!result.ok) return failure(result.error);
  revalidatePath('/ai', 'layout');
  redirect(`/ai/conversations/${result.value.conversationId}`);
}

/** Conversation metadata/content management never invokes a model. */
export async function manageConversationAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession('/ai');
  const ctx = await createReadCtx(session.userId);
  if (!ctx.ok) return failure(ctx.error);
  const id = form.get('conversationId');
  let result;
  switch (form.get('operation')) {
    case 'create': result = await createConversation(ctx.value, form.get('title')); break;
    case 'rename': result = await renameConversation(ctx.value, id, form.get('title')); break;
    case 'archive': result = await archiveConversation(ctx.value, id, true); break;
    case 'restore': result = await archiveConversation(ctx.value, id, false); break;
    case 'delete': result = await deleteConversation(ctx.value, id, form.get('confirmed') === 'true'); break;
    default: return { status: 'error', message: 'Choose a valid conversation action.', fieldErrors: {} };
  }
  if (!result.ok) return failure(result.error);
  revalidatePath('/ai', 'layout');
  if (form.get('operation') === 'delete') redirect('/ai');
  return success('Conversation updated.');
}
