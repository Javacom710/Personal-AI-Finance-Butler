import 'server-only';

/**
 * Proposal schemas — what a model may hand back when it drafts a write
 * ([AI-SYSTEM.md §9](../../../../docs/AI-SYSTEM.md)). Pure: no provider, no
 * database, no resolution of hints to ids.
 *
 * Defined here rather than in the Phase 9 proposal flow because the Phase 8
 * `parse` suite must measure **the schema production will use**. A suite scored
 * against a look-alike would certify a contract nothing enforces.
 */

import { z } from 'zod';

/** An exact, non-negative decimal. A string, never a JSON number (ADR-04). */
const decimalAmount = z.string().regex(/^\d+(\.\d{1,4})?$/, 'a decimal string such as "1250" or "12.50"');

export const TransactionProposal = z
  .object({
    kind: z.enum(['income', 'expense', 'transfer']),
    bookedOn: z.iso.date(),
    description: z.string().min(1).max(200),
    /**
     * `null` when the user stated no amount. Without this the schema forces a
     * model to invent one to stay valid — the corpus's `missing-amount` cases
     * exist to catch exactly that. A `null` amount never becomes a record: the
     * proposal opens in edit mode with the field highlighted (§9 step 6).
     */
    amount: decimalAmount.nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/, 'an ISO 4217 code such as "INR"'),
    accountHint: z.string().min(1).max(100).nullable(),
    toAccountHint: z.string().min(1).max(100).nullable(),
    categoryHint: z.string().min(1).max(100).nullable(),
    tags: z.array(z.string().min(1).max(40)).max(5),
    notes: z.string().max(500).nullable(),
    confidence: z.enum(['high', 'medium', 'low']),
    ambiguities: z.array(z.string().min(1).max(200)).max(5),
  })
  .strict();

export type TransactionProposal = z.infer<typeof TransactionProposal>;

/**
 * A category suggestion for one transaction (`classifyTransaction`).
 *
 * Built per request from the user's own categories **of the transaction's
 * kind**, as `"Parent"` or `"Parent > Child"` paths, so the answer space is an
 * enum: a model cannot invent a category, and an income category for an
 * expense is a schema failure rather than a near miss. `null` means the model
 * cannot tell, which is a valid answer — `Other` is a claim that the
 * transaction fits nothing, and is not the same thing.
 */
export function categorySuggestionSchema(paths: readonly [string, ...string[]]) {
  return z
    .object({
      category: z.enum(paths).nullable(),
      confidence: z.enum(['high', 'medium', 'low']),
    })
    .strict();
}

export type CategorySuggestion = z.infer<ReturnType<typeof categorySuggestionSchema>>;

/** The separator between a parent and a child category in a path. */
export const CATEGORY_PATH_SEPARATOR = ' > ';
