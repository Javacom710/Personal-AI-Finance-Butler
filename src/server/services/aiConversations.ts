import 'server-only';
import { and, asc, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { conflict, err, insufficientData, notFound, ok, validationFailed, type DomainError, type Result } from '../../lib/result';
import { aiConversations, aiMessages } from '../db/schema';
import type { Orchestrator } from '../ai/orchestrator';
import { answerReadOnlyQuestion, type ConversationTurn } from '../ai/assistant/question';
import { createAiReadCtx } from '../ai-read/internal';
import { withWriteCtxResult, type ReadCtx, type RequestCtx } from './_ctx';

export type ConversationView = typeof aiConversations.$inferSelect;
export type MessageView = typeof aiMessages.$inferSelect;
const idSchema = z.uuid();
const titleSchema = z.string().trim().min(1).max(120);
const invalidId = () => err(validationFailed({ conversationId: ['Choose a valid conversation.'] }));

export async function createConversation(ctx: RequestCtx, title: unknown = 'New conversation'): Promise<Result<ConversationView, DomainError>> {
  const parsed = titleSchema.safeParse(title);
  if (!parsed.success) return err(validationFailed({ title: ['Enter a title of 1–120 characters.'] }));
  return withWriteCtxResult(ctx, async w => {
    const [row] = await w.tx.insert(aiConversations).values({ userId: w.userId, title: parsed.data, createdAt: w.now, updatedAt: w.now }).returning();
    return ok(row!);
  });
}
export async function listConversations(ctx: ReadCtx, archived = false): Promise<ConversationView[]> {
  return ctx.db.select().from(aiConversations).where(and(eq(aiConversations.userId, ctx.userId), archived ? sql`${aiConversations.archivedAt} is not null` : isNull(aiConversations.archivedAt))).orderBy(desc(aiConversations.updatedAt), desc(aiConversations.id)).limit(50);
}
export async function getConversation(ctx: ReadCtx, id: unknown): Promise<Result<ConversationView, DomainError>> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return invalidId();
  const [row] = await ctx.db.select().from(aiConversations).where(and(eq(aiConversations.id, parsed.data), eq(aiConversations.userId, ctx.userId))).limit(1);
  return row ? ok(row) : err(notFound('conversation'));
}
export async function conversationMessages(ctx: ReadCtx, id: unknown): Promise<Result<MessageView[], DomainError>> {
  const conversation = await getConversation(ctx, id);
  if (!conversation.ok) return conversation;
  return ok(await ctx.db.select().from(aiMessages).where(eq(aiMessages.conversationId, conversation.value.id)).orderBy(asc(aiMessages.position)).limit(200));
}

/** Called by the future application composition root, never by a live action yet. */
export async function askConversation(ctx: RequestCtx, id: unknown, question: unknown, orchestrator: Orchestrator): Promise<Result<MessageView, DomainError>> {
  const text = z.string().trim().min(1).max(4000).safeParse(question);
  if (!text.success) return err(validationFailed({ question: ['Ask a question of 1–4,000 characters.'] }));
  const conversation = await getConversation(ctx, id);
  if (!conversation.ok) return conversation;
  const c = conversation.value;
  if (c.archivedAt || c.revision >= 100) return err(conflict('This conversation is archived or full. Start a new conversation.'));
  const recent = await ctx.db.select().from(aiMessages).where(eq(aiMessages.conversationId, c.id)).orderBy(desc(aiMessages.position)).limit(16);
  const history: ConversationTurn[] = recent.reverse().map(m => ({ role: m.role, content: 'text' in m.content ? m.content.text : m.content.answer.interpretation }));
  // Drop whole oldest exchanges. Tool results are deliberately not replayed as
  // fresh facts; each new question uses the existing prompt and current reads.
  while (history.reduce((n, m) => n + m.content.length, 0) > 16000) history.splice(0, 2);
  const answer = await answerReadOnlyQuestion(createAiReadCtx(ctx), orchestrator, text.data, history);
  if (!answer.ok) return err(insufficientData('assistant_unavailable', 'The assistant could not complete this question. No conversation messages were saved.'));
  // No database transaction/lock is held while the model is running. A revision
  // claim below rejects concurrent answers, archival and deletion without replay.
  return withWriteCtxResult(ctx, async w => {
    const [claimed] = await w.tx.update(aiConversations).set({ revision: c.revision + 1, updatedAt: w.now }).where(and(eq(aiConversations.id, c.id), eq(aiConversations.userId, w.userId), eq(aiConversations.revision, c.revision), isNull(aiConversations.archivedAt), lt(aiConversations.revision, 100))).returning();
    if (!claimed) return err(conflict('The conversation changed while answering. Review its latest messages before asking again.'));
    await w.tx.insert(aiMessages).values({ conversationId: c.id, position: c.revision * 2, role: 'user', content: { text: text.data }, createdAt: w.now });
    const usage = answer.value.usage;
    const [message] = await w.tx.insert(aiMessages).values({ conversationId: c.id, position: c.revision * 2 + 1, role: 'assistant', content: { answer: answer.value }, task: 'answerFinanceQuestion', tier: usage?.tier, model: answer.value.modelId, fallbackDepth: answer.value.fallbackDepth, finishReason: 'stop', promptTokens: usage?.promptTokens, completionTokens: usage?.completionTokens, latencyMs: usage?.latencyMs, costMicros: null, createdAt: w.now }).returning();
    return ok(message!);
  });
}
export async function renameConversation(ctx: RequestCtx, id: unknown, title: unknown): Promise<Result<void, DomainError>> {
  const parsed = titleSchema.safeParse(title);
  if (!parsed.success) return err(validationFailed({ title: ['Enter a title of 1–120 characters.'] }));
  if (!idSchema.safeParse(id).success) return invalidId();
  return withWriteCtxResult(ctx, async w => {
    const rows = await w.tx.update(aiConversations).set({ title: parsed.data, updatedAt: w.now }).where(and(eq(aiConversations.id, id as string), eq(aiConversations.userId, w.userId))).returning({ id: aiConversations.id });
    return rows.length ? ok(undefined) : err(notFound('conversation'));
  });
}
export async function archiveConversation(ctx: RequestCtx, id: unknown, archived: boolean): Promise<Result<void, DomainError>> {
  if (!idSchema.safeParse(id).success) return invalidId();
  return withWriteCtxResult(ctx, async w => {
    const rows = await w.tx.update(aiConversations).set({ archivedAt: archived ? w.now : null, updatedAt: w.now }).where(and(eq(aiConversations.id, id as string), eq(aiConversations.userId, w.userId))).returning({ id: aiConversations.id });
    return rows.length ? ok(undefined) : err(notFound('conversation'));
  });
}
export async function deleteConversation(ctx: RequestCtx, id: unknown, confirmed: unknown): Promise<Result<void, DomainError>> {
  if (confirmed !== true) return err(validationFailed({ confirmed: ['Confirm deletion of this conversation and its messages.'] }));
  if (!idSchema.safeParse(id).success) return invalidId();
  return withWriteCtxResult(ctx, async w => {
    const rows = await w.tx.delete(aiConversations).where(and(eq(aiConversations.id, id as string), eq(aiConversations.userId, w.userId))).returning({ id: aiConversations.id });
    return rows.length ? ok(undefined) : err(notFound('conversation'));
  });
}
/** Complete owner-scoped JSON export, with exact decimal strings and no logging. */
export async function exportConversation(ctx: ReadCtx, id: unknown) {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return invalidId();
  // A single statement gives export a consistent conversation/message snapshot.
  const rows = await ctx.db.select({ conversation: aiConversations, message: aiMessages }).from(aiConversations)
    .leftJoin(aiMessages, eq(aiMessages.conversationId, aiConversations.id))
    .where(and(eq(aiConversations.id, parsed.data), eq(aiConversations.userId, ctx.userId)))
    .orderBy(asc(aiMessages.position));
  if (!rows.length) return err(notFound('conversation'));
  return ok({ format: 'financeos-conversation-v1', conversation: rows[0]!.conversation, messages: rows.flatMap(row => row.message ? [row.message] : []) });
}
