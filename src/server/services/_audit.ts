import 'server-only';

/**
 * The append-only audit writer (SCHEMA.md §11).
 *
 * Every mutation records what changed, in the same transaction as the change —
 * so a committed edit always has its audit row, and a rolled-back one leaves
 * none. The application role holds INSERT and SELECT on `audit_log` and nothing
 * else, so this writer *cannot* rewrite history even if asked to.
 *
 * The audit log is the one place financial figures are deliberately recorded in
 * full. That is the opposite of `src/server/log.ts`, which redacts them: a log
 * line is an operational record that gets shipped and tailed, while an audit row
 * is financial data living under the same protection as the ledger it describes.
 */

import type { DbTransaction } from '../db/client';
import { auditLog } from '../db/schema';

export type AuditActor = 'user' | 'system' | 'ai_confirmed';

export interface AuditEntry {
  readonly actor: AuditActor;
  /** `transaction.create`, `account.update`, `budget.delete`, … */
  readonly action: string;
  readonly entityType: string;
  readonly entityId?: string | null;
  readonly before?: unknown;
  readonly after?: unknown;
}

export interface AuditWriter {
  record(entry: AuditEntry): Promise<void>;
}

export function createAuditWriter(
  tx: DbTransaction,
  userId: string,
  requestId: string | null,
): AuditWriter {
  return {
    async record(entry: AuditEntry): Promise<void> {
      await tx.insert(auditLog).values({
        userId,
        actor: entry.actor,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        before: entry.before === undefined ? null : (entry.before as object),
        after: entry.after === undefined ? null : (entry.after as object),
        requestId,
      });
    },
  };
}
