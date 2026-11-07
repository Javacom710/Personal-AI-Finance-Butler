import { z } from 'zod';
import { amountSchema, isoDateSchema, uuidSchema, tagListSchema } from './money';

const proposalAmount = amountSchema.pipe(z.string().regex(/^\d+(\.\d{1,4})?$/, 'Enter a decimal amount with a dot and no grouping symbols.'));

/** User-reviewed values, never model-controlled identifiers. All money stays text. */
export const reviewedTransactionSchema = z.object({
  kind: z.enum(['income', 'expense', 'transfer']),
  bookedOn: isoDateSchema,
  description: z.string().trim().min(1).max(400),
  amount: proposalAmount,
  currency: z.string().regex(/^[A-Z]{3}$/),
  accountId: uuidSchema,
  toAccountId: uuidSchema.nullable(),
  categoryId: uuidSchema.nullable(),
  toAmount: proposalAmount.nullable(),
  notes: z.string().max(2000).nullable(),
  tags: tagListSchema,
}).strict().superRefine((v, c) => {
  if (v.kind === 'transfer') {
    if (!v.toAccountId) c.addIssue({ code: 'custom', path: ['toAccountId'], message: 'Choose a destination account.' });
    if (v.toAccountId === v.accountId) c.addIssue({ code: 'custom', path: ['toAccountId'], message: 'Choose a different destination account.' });
    if (v.categoryId) c.addIssue({ code: 'custom', path: ['categoryId'], message: 'A transfer has no income or expense category.' });
  } else {
    if (!v.categoryId) c.addIssue({ code: 'custom', path: ['categoryId'], message: 'Choose a category.' });
    if (v.toAccountId || v.toAmount) c.addIssue({ code: 'custom', path: ['toAccountId'], message: 'Only transfers have a destination.' });
  }
});
export type ReviewedTransaction = z.infer<typeof reviewedTransactionSchema>;
export type TransactionDraft = { [K in keyof ReviewedTransaction]: ReviewedTransaction[K] | null };
export type ProposalErrors = Record<string, string[]>;
