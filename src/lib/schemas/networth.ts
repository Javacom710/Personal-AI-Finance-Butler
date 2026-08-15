/**
 * The validation boundary for the net-worth domain (ADR-16).
 *
 * Phase 5 adds exactly two writable entities — manual assets and liabilities —
 * and both are **append-only series plus a header**. There is no schema here for
 * updating a valuation or a balance, because there is no such operation:
 * revaluing inserts a new row, and correcting a wrong one is a delete plus an
 * insert that the audit log records in full. Updating in place would
 * retroactively rewrite every historical net worth derived from it
 * ([FINANCIAL-DOMAIN.md §9.4](../../../docs/FINANCIAL-DOMAIN.md#94-asset-and-liability-lifecycle)).
 *
 * Net worth itself has **no write schema at all**. It is an aggregation, not a
 * ledger.
 */

import { z } from 'zod';

import { isIsoDate } from '../date';
import { MONEY_MAX_MINOR, MONEY_SCALE } from '../decimal/money';
import { parseFixed } from '../decimal/scaled';

const uuidSchema = z.uuid('Not a valid identifier.');

const isoDateSchema = z
  .string()
  .trim()
  .refine(isIsoDate, { message: 'Enter a date as YYYY-MM-DD.' });

const nameSchema = z.string().trim().min(1, 'Enter a name.').max(120, 'Keep the name under 120 characters.');
const notesSchema = z.string().trim().min(1).max(2000).optional().or(z.literal('').transform(() => undefined));

const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'A currency is a three-letter ISO code, such as INR.');

/**
 * A value that may be zero but never negative — a valuation, an outstanding
 * balance, an acquisition cost. The **sign is applied by the net-worth
 * calculator**, from the side the source sits on, never carried in the number
 * (ADR-25). A negative outstanding would be an asset wearing the wrong table.
 */
const nonNegativeAmountSchema = z
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
    if (parsed.value < 0n) {
      ctx.addIssue({ code: 'custom', message: 'Enter zero or a positive amount.' });
    }
  });

// -------------------------------------------------------------- manual assets

export const manualAssetKindSchema = z.enum([
  'property',
  'vehicle',
  'gold_physical',
  'collectible',
  'receivable',
  'other',
]);

/**
 * Creating an asset requires a first valuation: an asset with none is
 * *eligible but unvalued*, which is **excluded and named** from every figure
 * rather than counted as zero (FINANCIAL-DOMAIN.md §9.3). Requiring it at
 * creation means the excluded path is reached only by asking for a date before
 * the first valuation, which is a real question rather than a data gap.
 */
export const createManualAssetSchema = z
  .object({
    name: nameSchema,
    kind: manualAssetKindSchema,
    currencyCode: currencyCodeSchema,
    acquiredOn: isoDateSchema.optional().or(z.literal('').transform(() => undefined)),
    acquisitionCost: nonNegativeAmountSchema.optional().or(z.literal('').transform(() => undefined)),
    /** The first valuation. `valuedOn` defaults to `acquiredOn`, else today. */
    value: nonNegativeAmountSchema,
    valuedOn: isoDateSchema.optional().or(z.literal('').transform(() => undefined)),
    notes: notesSchema,
  })
  .superRefine((value, ctx) => {
    if (value.acquiredOn && value.valuedOn && value.valuedOn < value.acquiredOn) {
      ctx.addIssue({
        code: 'custom',
        path: ['valuedOn'],
        message: 'An asset cannot be valued before it was acquired.',
      });
    }
  });

export type CreateManualAssetInput = z.infer<typeof createManualAssetSchema>;

/** The header only. Neither the currency nor the valuation series is editable here. */
export const updateManualAssetSchema = z.object({
  name: nameSchema.optional(),
  kind: manualAssetKindSchema.optional(),
  acquiredOn: isoDateSchema.nullish(),
  acquisitionCost: nonNegativeAmountSchema.nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

export type UpdateManualAssetInput = z.infer<typeof updateManualAssetSchema>;

export const revalueAssetSchema = z.object({
  assetId: uuidSchema,
  asOf: isoDateSchema,
  value: nonNegativeAmountSchema,
  note: z.string().trim().min(1).max(400).optional().or(z.literal('').transform(() => undefined)),
});

export type RevalueAssetInput = z.infer<typeof revalueAssetSchema>;

/**
 * Disposal sets a **date**, not a flag: an asset sold today must still appear in
 * last year's figure (ADR-26). `is_active` follows for the UI and is read by no
 * calculation.
 */
export const disposeAssetSchema = z.object({
  assetId: uuidSchema,
  disposedOn: isoDateSchema,
});

export type DisposeAssetInput = z.infer<typeof disposeAssetSchema>;

// ---------------------------------------------------------------- liabilities

export const liabilityKindSchema = z.enum([
  'home_loan',
  'auto_loan',
  'personal_loan',
  'student_loan',
  'credit_card',
  'other',
]);

/**
 * Two shapes, discriminated by `linkedAccountId`:
 *
 * - **transacted** — set. The liability contributes **nothing** to net worth;
 *   the linked account contributes, by sign. No balance is accepted, because
 *   `liability_balances` is ignored for this shape and storing a figure nothing
 *   reads is how a second source of truth begins.
 * - **scheduled** — null. A first `openingBalance` is required, because the
 *   series *is* the source.
 */
export const createLiabilitySchema = z
  .object({
    name: nameSchema,
    kind: liabilityKindSchema,
    linkedAccountId: uuidSchema.optional().or(z.literal('').transform(() => undefined)),
    currencyCode: currencyCodeSchema,
    principalOriginal: nonNegativeAmountSchema.optional().or(z.literal('').transform(() => undefined)),
    /**
     * Descriptive only. Nothing computes an amortisation schedule from these.
     *
     * `.min(1)` is load-bearing: without it an empty string satisfies the first
     * branch and never reaches the `.or`, so a blank form field arrives as `''`
     * and `Rate.parseUserInput('')` rejects it — a required-field error on a
     * field the form marked optional.
     */
    interestRate: z
      .string()
      .trim()
      .min(1)
      .max(20)
      .optional()
      .or(z.literal('').transform(() => undefined)),
    emiAmount: nonNegativeAmountSchema.optional().or(z.literal('').transform(() => undefined)),
    startedOn: isoDateSchema.optional().or(z.literal('').transform(() => undefined)),
    endsOn: isoDateSchema.optional().or(z.literal('').transform(() => undefined)),
    /** Scheduled shape only: the first outstanding figure and its date. */
    openingBalance: nonNegativeAmountSchema.optional().or(z.literal('').transform(() => undefined)),
    openingBalanceOn: isoDateSchema.optional().or(z.literal('').transform(() => undefined)),
    notes: notesSchema,
  })
  .superRefine((value, ctx) => {
    if (value.linkedAccountId) {
      if (value.openingBalance) {
        ctx.addIssue({
          code: 'custom',
          path: ['openingBalance'],
          message:
            'A liability linked to an account takes its outstanding balance from that account. ' +
            'Remove the balance, or unlink the account.',
        });
      }
      return;
    }
    if (!value.openingBalance) {
      ctx.addIssue({
        code: 'custom',
        path: ['openingBalance'],
        message: 'A liability with no linked account needs an outstanding balance to start from.',
      });
    }
  });

export type CreateLiabilityInput = z.infer<typeof createLiabilitySchema>;

export const updateLiabilitySchema = z.object({
  name: nameSchema.optional(),
  kind: liabilityKindSchema.optional(),
  principalOriginal: nonNegativeAmountSchema.nullish(),
  interestRate: z.string().trim().min(1).max(20).nullish(),
  emiAmount: nonNegativeAmountSchema.nullish(),
  startedOn: isoDateSchema.nullish(),
  endsOn: isoDateSchema.nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

export type UpdateLiabilityInput = z.infer<typeof updateLiabilitySchema>;

/** Scheduled liabilities only — a transacted one moves through its account. */
export const recordLiabilityBalanceSchema = z.object({
  liabilityId: uuidSchema,
  asOf: isoDateSchema,
  outstanding: nonNegativeAmountSchema,
});

export type RecordLiabilityBalanceInput = z.infer<typeof recordLiabilityBalanceSchema>;

/**
 * Closing writes a **terminal `outstanding = 0` row** before setting the flag
 * (invariant I-28). Under a date-driven rule the flag changes nothing, so
 * without the zero row the last non-zero balance would stay in force forever.
 */
export const closeLiabilitySchema = z.object({
  liabilityId: uuidSchema,
  closedOn: isoDateSchema,
});

export type CloseLiabilityInput = z.infer<typeof closeLiabilitySchema>;

// ------------------------------------------------------------------ net worth

/** The only "input" net worth has: a date. It writes nothing. */
export const netWorthQuerySchema = z.object({
  asOf: isoDateSchema.optional(),
});

export type NetWorthQuery = z.infer<typeof netWorthQuerySchema>;
