/**
 * The validation boundary for the money domain (ADR-16).
 *
 * One definition per input shape, shared by server actions today and by AI
 * proposal schemas in Phase 9 — `z.toJSONSchema()` generates the model-facing
 * schema from exactly these objects, so what the model is told and what the
 * server accepts cannot drift apart.
 *
 * **Amounts are strings, never JSON numbers.** `0.1 + 0.2` is the reason: a
 * number that has been through a JSON parser has already lost the guarantee
 * that makes `Money` exact. Every amount here is validated by the same
 * `parseFixed` the `Money` constructor uses, so a value that passes validation
 * is a value that can be constructed.
 */

import { z } from 'zod';

import { isIsoDate } from '../date';
import { MONEY_MAX_MINOR, MONEY_SCALE } from '../decimal/money';
import { parseFixed } from '../decimal/scaled';
import { parseRrule } from '../date/rrule';

// ------------------------------------------------------------------ primitives

export const uuidSchema = z.uuid('Not a valid identifier.');

export const isoDateSchema = z
  .string()
  .trim()
  .refine(isIsoDate, { message: 'Enter a date as YYYY-MM-DD.' });

/**
 * A decimal amount as text. Rejects anything `Money.parseUserInput` would
 * reject, including ambiguous digit grouping (`1,5` means one and a half in
 * much of Europe and fifteen elsewhere — see D-16), more than four decimal
 * places, and values beyond `NUMERIC(20,4)`.
 */
export const amountSchema = z
  .string()
  .trim()
  .min(1, 'Enter an amount.')
  .max(40, 'That amount is too long to be real.')
  .superRefine((value, ctx) => {
    const parsed = parseFixed(value, { scale: MONEY_SCALE, maxMagnitude: MONEY_MAX_MINOR });
    if (!parsed.ok) {
      ctx.addIssue({ code: 'custom', message: parsed.error.message });
      return;
    }
    if (parsed.value <= 0n) {
      // The sign comes from the transaction kind, never from the number
      // (FINANCIAL-DOMAIN.md §4). A negative amount here is either a typo or an
      // attempt to encode direction twice.
      ctx.addIssue({ code: 'custom', message: 'Enter a positive amount.' });
    }
  });

/** An amount that may legitimately be zero or negative — an opening balance on a credit card. */
export const signedAmountSchema = z
  .string()
  .trim()
  .min(1, 'Enter an amount.')
  .max(40)
  .superRefine((value, ctx) => {
    const parsed = parseFixed(value, { scale: MONEY_SCALE, maxMagnitude: MONEY_MAX_MINOR });
    if (!parsed.ok) ctx.addIssue({ code: 'custom', message: parsed.error.message });
  });

export const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'A currency is a three-letter ISO code, such as INR.');

const nameSchema = z.string().trim().min(1, 'Enter a name.').max(120, 'Keep the name under 120 characters.');
const descriptionSchema = z
  .string()
  .trim()
  .min(1, 'Describe what this was.')
  .max(400, 'Keep the description under 400 characters.');
const notesSchema = z.string().trim().max(2000).optional().or(z.literal('').transform(() => undefined));

/**
 * 0–8 tags per transaction (FINANCIAL-DOMAIN.md §5). Trimmed, internal
 * whitespace collapsed; matching is case-insensitive, which is enforced by a
 * unique index on `lower(name)` rather than by normalising the stored value.
 */
export const tagNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(48)
  .transform((s) => s.replace(/\s+/g, ' '));

export const tagListSchema = z.array(tagNameSchema).max(8, 'At most 8 tags.').default([]);

// -------------------------------------------------------------------- accounts

export const accountKindSchema = z.enum([
  'bank',
  'cash',
  'credit_card',
  'wallet',
  'brokerage',
  'loan',
  'other',
]);

export const createAccountSchema = z
  .object({
    name: nameSchema,
    kind: accountKindSchema,
    institution: z.string().trim().max(120).optional().or(z.literal('').transform(() => undefined)),
    currencyCode: currencyCodeSchema,
    openingBalance: signedAmountSchema.default('0'),
    openingDate: isoDateSchema,
    creditLimit: signedAmountSchema.optional().or(z.literal('').transform(() => undefined)),
    notes: notesSchema,
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'credit_card' && !value.creditLimit) {
      ctx.addIssue({
        code: 'custom',
        path: ['creditLimit'],
        message: 'A credit card needs a limit — available credit cannot be shown without one.',
      });
    }
  });

export type CreateAccountInput = z.infer<typeof createAccountSchema>;

export const updateAccountSchema = z.object({
  name: nameSchema.optional(),
  institution: z.string().trim().max(120).nullish(),
  creditLimit: signedAmountSchema.nullish(),
  notes: z.string().trim().max(2000).nullish(),
  displayOrder: z.number().int().min(0).max(9999).optional(),
});

export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

// ------------------------------------------------------------------ categories

export const categoryKindSchema = z.enum(['income', 'expense']);

export const createCategorySchema = z.object({
  name: nameSchema,
  kind: categoryKindSchema,
  parentId: uuidSchema.nullish(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = z.object({
  name: nameSchema.optional(),
  isArchived: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

// ---------------------------------------------------------------- transactions

/**
 * Income and expense only. A transfer is a different shape with two accounts and
 * no category, so it gets its own schema rather than a set of optional fields
 * that are conditionally required.
 */
export const createTransactionSchema = z.object({
  kind: z.enum(['income', 'expense']),
  accountId: uuidSchema,
  categoryId: uuidSchema,
  amount: amountSchema,
  bookedOn: isoDateSchema,
  description: descriptionSchema,
  notes: notesSchema,
  tags: tagListSchema,
});

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

export const updateTransactionSchema = z.object({
  accountId: uuidSchema.optional(),
  categoryId: uuidSchema.optional(),
  amount: amountSchema.optional(),
  bookedOn: isoDateSchema.optional(),
  description: descriptionSchema.optional(),
  notes: z.string().trim().max(2000).nullish(),
  tags: z.array(tagNameSchema).max(8).optional(),
});

export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;

/**
 * A transfer.
 *
 * Same currency on both sides: supply `amount` only. Different currencies:
 * supply `fromAmount` and `toAmount`, the amounts actually debited and credited.
 * The residual between them in base currency is the realised FX difference, and
 * it is reported as `fxEffect` rather than absorbed (FINANCIAL-DOMAIN.md §4).
 */
export const createTransferSchema = z
  .object({
    fromAccountId: uuidSchema,
    toAccountId: uuidSchema,
    amount: amountSchema.optional(),
    fromAmount: amountSchema.optional(),
    toAmount: amountSchema.optional(),
    bookedOn: isoDateSchema,
    description: descriptionSchema,
    notes: notesSchema,
    tags: tagListSchema,
  })
  .superRefine((value, ctx) => {
    if (value.fromAccountId === value.toAccountId) {
      ctx.addIssue({
        code: 'custom',
        path: ['toAccountId'],
        message: 'A transfer must move money between two different accounts.',
      });
    }
    const hasPair = Boolean(value.fromAmount && value.toAmount);
    if (!value.amount && !hasPair) {
      ctx.addIssue({
        code: 'custom',
        path: ['amount'],
        message: 'Enter an amount, or both a debited and a credited amount for a cross-currency transfer.',
      });
    }
  });

export type CreateTransferInput = z.infer<typeof createTransferSchema>;

export const transactionFilterSchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  accountId: uuidSchema.optional(),
  categoryId: uuidSchema.optional(),
  kind: z.enum(['income', 'expense', 'transfer']).optional(),
  tagId: uuidSchema.optional(),
  search: z.string().trim().max(200).optional(),
  minAmount: amountSchema.optional(),
  maxAmount: amountSchema.optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
});

export type TransactionFilter = z.infer<typeof transactionFilterSchema>;

// --------------------------------------------------------------------- budgets

export const budgetPeriodSchema = z.enum(['monthly', 'quarterly', 'yearly']);

export const createBudgetSchema = z.object({
  categoryId: uuidSchema,
  period: budgetPeriodSchema,
  amount: amountSchema,
  currencyCode: currencyCodeSchema,
  startsOn: isoDateSchema,
  endsOn: isoDateSchema.nullish(),
});

export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;

export const updateBudgetSchema = z.object({
  amount: amountSchema.optional(),
  endsOn: isoDateSchema.nullish(),
  isActive: z.boolean().optional(),
});

export type UpdateBudgetInput = z.infer<typeof updateBudgetSchema>;

// ------------------------------------------------------------------- recurring

export const rruleSchema = z
  .string()
  .trim()
  .min(1, 'Choose how often this repeats.')
  .max(200)
  .superRefine((value, ctx) => {
    const parsed = parseRrule(value);
    if (!parsed.ok) ctx.addIssue({ code: 'custom', message: parsed.error.message });
  });

/**
 * `investment` is absent deliberately. The enum has the value because SCHEMA.md
 * defines it, but an investment template cannot be validated before the
 * investment ledger exists (Phase 4), and accepting one would store a template
 * nothing can post.
 */
export const recurringKindSchema = z.enum(['income', 'expense', 'transfer']);

const recurringTemplateSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('income'),
    accountId: uuidSchema,
    categoryId: uuidSchema,
    amount: amountSchema,
    description: descriptionSchema,
    notes: notesSchema,
  }),
  z.object({
    kind: z.literal('expense'),
    accountId: uuidSchema,
    categoryId: uuidSchema,
    amount: amountSchema,
    description: descriptionSchema,
    notes: notesSchema,
  }),
  z.object({
    kind: z.literal('transfer'),
    fromAccountId: uuidSchema,
    toAccountId: uuidSchema,
    amount: amountSchema,
    description: descriptionSchema,
    notes: notesSchema,
  }),
]);

export type RecurringTemplate = z.infer<typeof recurringTemplateSchema>;

export const createRecurringRuleSchema = z
  .object({
    name: nameSchema,
    template: recurringTemplateSchema,
    rrule: rruleSchema,
    startsOn: isoDateSchema,
    endsOn: isoDateSchema.nullish(),
    /** Default false: an amount that varies should be confirmed, not posted blind. */
    autoPost: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.endsOn && value.endsOn < value.startsOn) {
      ctx.addIssue({ code: 'custom', path: ['endsOn'], message: 'The end date is before the start date.' });
    }
  });

export type CreateRecurringRuleInput = z.infer<typeof createRecurringRuleSchema>;

export const updateRecurringRuleSchema = z.object({
  name: nameSchema.optional(),
  template: recurringTemplateSchema.optional(),
  rrule: rruleSchema.optional(),
  endsOn: isoDateSchema.nullish(),
  autoPost: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export type UpdateRecurringRuleInput = z.infer<typeof updateRecurringRuleSchema>;
