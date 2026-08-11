/**
 * The validation boundary for the investment domain (ADR-16).
 *
 * Same rules as `money.ts`, one scale further: **quantities and per-unit prices
 * are strings too**, and are validated by the same `parseFixed` that `Quantity`
 * and `UnitPrice` construct from — so a value that passes validation is a value
 * that can be constructed, and a NAV of `123.45678900` survives the boundary
 * instead of being truncated by a JSON number.
 *
 * **The caller supplies a positive quantity and a `kind`; the engine decides the
 * sign.** There is no signed-quantity input anywhere here, which removes the
 * largest class of data-entry bug on this ledger exactly as it does on the money
 * one.
 */

import { z } from 'zod';

import { MONEY_MAX_MINOR, MONEY_SCALE } from '../decimal/money';
import { PRICE_MAX_UNITS, PRICE_SCALE } from '../decimal/price';
import { QTY_MAX_UNITS, QTY_SCALE } from '../decimal/quantity';
import { parseFixed } from '../decimal/scaled';
import { currencyCodeSchema, isoDateSchema, uuidSchema } from './money';

// ------------------------------------------------------------------ primitives

/**
 * An optional field that a form submits as an empty string.
 *
 * `schema.optional().or(z.literal('').transform(() => undefined))` looks
 * equivalent and is not: `''` satisfies the **first** branch of the union — a
 * string is a string — so the `.or()` never runs and the value arrives as `''`
 * rather than `undefined`. Downstream, `Money.of('')` then throws out of a
 * service. Preprocessing removes the blank before any branch is tried.
 */
const optionalText = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema.optional(),
  );

/** A strictly positive number of units, at `NUMERIC(28,8)`. */
export const quantitySchema = z
  .string()
  .trim()
  .min(1, 'Enter a quantity.')
  .max(40, 'That quantity is too long to be real.')
  .superRefine((value, ctx) => {
    const parsed = parseFixed(value, { scale: QTY_SCALE, maxMagnitude: QTY_MAX_UNITS });
    if (!parsed.ok) {
      ctx.addIssue({ code: 'custom', message: parsed.error.message });
      return;
    }
    if (parsed.value <= 0n) {
      ctx.addIssue({ code: 'custom', message: 'Enter a positive quantity — the kind decides the sign.' });
    }
  });

/** A per-unit price at `NUMERIC(20,8)`. Zero is permitted: a bonus-issue basis is zero. */
export const unitPriceSchema = z
  .string()
  .trim()
  .min(1, 'Enter a price.')
  .max(40, 'That price is too long to be real.')
  .superRefine((value, ctx) => {
    const parsed = parseFixed(value, { scale: PRICE_SCALE, maxMagnitude: PRICE_MAX_UNITS });
    if (!parsed.ok) {
      ctx.addIssue({ code: 'custom', message: parsed.error.message });
      return;
    }
    if (parsed.value < 0n) ctx.addIssue({ code: 'custom', message: 'A price cannot be negative.' });
  });

/** A charge — fees and taxes are non-negative magnitudes, never signed. */
const chargeAmountSchema = z
  .string()
  .trim()
  .max(40)
  .superRefine((value, ctx) => {
    if (value === '') return;
    const parsed = parseFixed(value, { scale: MONEY_SCALE, maxMagnitude: MONEY_MAX_MINOR });
    if (!parsed.ok) {
      ctx.addIssue({ code: 'custom', message: parsed.error.message });
      return;
    }
    if (parsed.value < 0n) ctx.addIssue({ code: 'custom', message: 'A charge cannot be negative.' });
  });

export const chargeSchema = optionalText(chargeAmountSchema);

const positiveAmountSchema = z
  .string()
  .trim()
  .min(1, 'Enter an amount.')
  .max(40)
  .superRefine((value, ctx) => {
    const parsed = parseFixed(value, { scale: MONEY_SCALE, maxMagnitude: MONEY_MAX_MINOR });
    if (!parsed.ok) {
      ctx.addIssue({ code: 'custom', message: parsed.error.message });
      return;
    }
    if (parsed.value <= 0n) ctx.addIssue({ code: 'custom', message: 'Enter a positive amount.' });
  });

export const assetClassSchema = z.enum([
  'equity',
  'mutual_fund',
  'etf',
  'bond',
  'fixed_deposit',
  'gold',
  'crypto',
  'cash_equivalent',
  'other',
]);

export const costBasisMethodSchema = z.enum(['fifo', 'average', 'specific_id']);

export const investmentKindSchema = z.enum([
  'buy',
  'sell',
  'dividend',
  'interest',
  'fee',
  'tax',
  'bonus',
  'split',
  'mf_purchase',
  'mf_redemption',
  'transfer_in',
  'transfer_out',
]);

const notesSchema = optionalText(z.string().trim().max(2000));

// ----------------------------------------------------------------- instruments

const symbolSchema = z
  .string()
  .trim()
  .min(1, 'Enter a symbol or scheme code.')
  .max(64, 'Keep the symbol under 64 characters.')
  .toUpperCase();

const exchangeSchema = optionalText(z.string().trim().max(32).toUpperCase());

/** ISIN: two country letters, nine alphanumerics, one check digit. */
const isinSchema = optionalText(
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/, 'An ISIN is 12 characters, such as INE002A01018.'),
);

export const createInstrumentSchema = z.object({
  symbol: symbolSchema,
  exchange: exchangeSchema,
  isin: isinSchema,
  name: z.string().trim().min(1, 'Enter a name.').max(200),
  assetClass: assetClassSchema,
  currencyCode: currencyCodeSchema,
  country: optionalText(
    z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, 'A country is a two-letter ISO code, such as IN.'),
  ),
  costBasisMethod: costBasisMethodSchema.default('fifo'),
});

export const updateInstrumentSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  isin: isinSchema,
  country: optionalText(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/)),
  assetClass: assetClassSchema.optional(),
  isActive: z.boolean().optional(),
  /**
   * Changing this **rewrites derived history**: realised P&L on already-settled
   * disposals moves. The service triggers a full rebuild of every position
   * holding the instrument inside the same transaction, and the UI must warn
   * before applying it.
   */
  costBasisMethod: costBasisMethodSchema.optional(),
});

/**
 * `symbol`, `exchange` and `currency_code` are absent by design. All three are
 * identity: the first two are the unique key, and changing the currency would
 * silently reinterpret every historical `price`, `gross_amount`, `fees` and
 * `taxes` on the instrument — the same reasoning that makes an account's
 * currency immutable (OD-5).
 */

// ---------------------------------------------------------- transaction shapes

const commonTransactionFields = {
  accountId: uuidSchema,
  tradeDate: isoDateSchema,
  settlementDate: optionalText(isoDateSchema),
  notes: notesSchema,
};

/** `buy`, `mf_purchase`, `sell`, `mf_redemption` — a trade with a quantity and a price. */
export const tradeSchema = z.object({
  ...commonTransactionFields,
  kind: z.enum(['buy', 'sell', 'mf_purchase', 'mf_redemption']),
  instrumentId: uuidSchema,
  quantity: quantitySchema,
  price: unitPriceSchema,
  fees: chargeSchema,
  taxes: chargeSchema,
});

/** `dividend`, `interest` — `grossAmount` is the DECLARED amount, `taxes` the withholding. */
export const incomeSchema = z.object({
  ...commonTransactionFields,
  kind: z.enum(['dividend', 'interest']),
  /** Null only for account-level interest on idle cash (§6.2). */
  instrumentId: uuidSchema.optional(),
  grossAmount: positiveAmountSchema,
  fees: chargeSchema,
  taxes: chargeSchema,
});

/** `fee`, `tax` — a standalone charge. `instrumentId` omitted makes it portfolio-level. */
export const chargeTransactionSchema = z.object({
  ...commonTransactionFields,
  kind: z.enum(['fee', 'tax']),
  instrumentId: uuidSchema.optional(),
  amount: positiveAmountSchema,
});

/** `split`, `bonus` — a ratio and nothing else. */
export const corporateActionSchema = z.object({
  ...commonTransactionFields,
  kind: z.enum(['split', 'bonus']),
  instrumentId: uuidSchema,
  /** New units per `ratioDen` old. A 1:5 split is `5 : 1`; a 5:1 reverse split is `1 : 5`. */
  ratioNum: z.coerce.number().int().positive('A ratio numerator must be a positive whole number.'),
  ratioDen: z.coerce.number().int().positive('A ratio denominator must be a positive whole number.'),
});

/** `transfer_in` — carries basis **and** the original acquisition date. No fees, no cash. */
export const transferInSchema = z.object({
  ...commonTransactionFields,
  kind: z.literal('transfer_in'),
  instrumentId: uuidSchema,
  quantity: quantitySchema,
  /** The carried basis per unit, from the source account's lots. */
  price: unitPriceSchema,
  /**
   * The **original** purchase date. Omitting it resets a long-term holding to
   * short-term, which is a materially wrong tax classification — so the form
   * asks for it, and the service defaults it to the trade date only when the
   * user explicitly leaves it blank.
   */
  originalAcquiredOn: optionalText(isoDateSchema),
});

export const transferOutSchema = z.object({
  ...commonTransactionFields,
  kind: z.literal('transfer_out'),
  instrumentId: uuidSchema,
  quantity: quantitySchema,
  /** Recorded for the ledger and for account-scope XIRR; it does not affect P&L. */
  price: unitPriceSchema,
});

export const createInvestmentTransactionSchema = z.discriminatedUnion('kind', [
  tradeSchema,
  incomeSchema,
  chargeTransactionSchema,
  corporateActionSchema,
  transferInSchema,
  transferOutSchema,
]);

export type CreateInstrumentInput = z.infer<typeof createInstrumentSchema>;
export type UpdateInstrumentInput = z.infer<typeof updateInstrumentSchema>;
export type CreateInvestmentTransactionInput = z.infer<typeof createInvestmentTransactionSchema>;

// -------------------------------------------------------------- manual pricing

/**
 * A price the user entered by hand.
 *
 * Phase 4's only price source. Phase 6 adds provider adapters that write to the
 * same table; nothing about this input changes when they do.
 */
export const setManualPriceSchema = z.object({
  instrumentId: uuidSchema,
  price: unitPriceSchema,
  /** When the price was **true**, not when it was entered. Defaults to now. */
  asOf: optionalText(z.iso.datetime({ offset: true })),
});

export type SetManualPriceInput = z.infer<typeof setManualPriceSchema>;

// ------------------------------------------------------------------- filtering

export const investmentTransactionFilterSchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  accountId: uuidSchema.optional(),
  instrumentId: uuidSchema.optional(),
  kind: investmentKindSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export type InvestmentTransactionFilter = z.infer<typeof investmentTransactionFilterSchema>;
