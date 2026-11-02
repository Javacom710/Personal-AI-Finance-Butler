import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './identity';
import type { ProposalErrors, TransactionDraft } from '../../../lib/schemas/ai-entry';

export const proposalStatus = pgEnum('proposal_status', ['pending', 'applied', 'rejected', 'expired', 'invalid']);
/** Phase 9 transaction proposals only; conversations and other proposal kinds are deferred. */
export const aiProposals = pgTable('ai_proposals', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull().default('transaction'),
  rawPayload: jsonb('raw_payload').$type<string>().notNull(),
  normalized: jsonb('normalized').$type<TransactionDraft>(),
  validationErrors: jsonb('validation_errors').$type<ProposalErrors>(),
  status: proposalStatus('status').notNull().default('pending'),
  appliedEntityId: uuid('applied_entity_id'),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index('ai_proposals_pending_idx').on(t.userId, t.createdAt.desc()).where(sql`${t.status} = 'pending'`),
  check('ai_proposals_transaction_only', sql`${t.kind} = 'transaction'`),
  check('ai_proposals_expiry', sql`${t.expiresAt} = ${t.createdAt} + interval '24 hours'`),
  check('ai_proposals_applied_fields', sql`(${t.status} = 'applied') = (${t.appliedAt} is not null and ${t.appliedEntityId} is not null)`),
]);
