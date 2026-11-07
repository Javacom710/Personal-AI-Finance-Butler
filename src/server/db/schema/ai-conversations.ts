import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, jsonb, pgEnum, pgTable, smallint, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { users } from './identity';
import type { QuestionAnswer } from '../../ai/assistant/question';

export const aiRole = pgEnum('ai_role', ['user', 'assistant']);
export const aiConversations = pgTable('ai_conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title'),
  revision: integer('revision').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, t => [index('ai_conversations_user_idx').on(t.userId, t.updatedAt.desc()), check('ai_conversations_revision', sql`${t.revision} between 0 and 100`)]);
export type StoredQuestionContent = { text: string } | { answer: QuestionAnswer };
export const aiMessages = pgTable('ai_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => aiConversations.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  role: aiRole('role').notNull(),
  content: jsonb('content').$type<StoredQuestionContent>().notNull(),
  task: text('task'),
  tier: smallint('tier'),
  model: text('model'),
  fallbackDepth: smallint('fallback_depth').notNull().default(0),
  finishReason: text('finish_reason'),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  costMicros: bigint('cost_micros', { mode: 'number' }),
  latencyMs: integer('latency_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  unique('ai_messages_position_unique').on(t.conversationId, t.position),
  index('ai_messages_model_idx').on(t.model, t.createdAt.desc()),
  check('ai_messages_position_role', sql`${t.position} between 0 and 199 and ((${t.role} = 'user' and ${t.position} % 2 = 0) or (${t.role} = 'assistant' and ${t.position} % 2 = 1))`),
  check('ai_messages_tier', sql`${t.tier} is null or ${t.tier} between 1 and 5`),
  check('ai_messages_nonnegative', sql`${t.fallbackDepth} >= 0 and (${t.promptTokens} is null or ${t.promptTokens} >= 0) and (${t.completionTokens} is null or ${t.completionTokens} >= 0) and (${t.latencyMs} is null or ${t.latencyMs} >= 0) and (${t.costMicros} is null or ${t.costMicros} >= 0)`),
]);
