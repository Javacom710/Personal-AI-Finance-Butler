/**
 * Builders for lot-engine tests.
 *
 * Every case in INVESTMENT-DOMAIN.md §12 is "a plain array of transactions in,
 * expected lots/disposals/position out — no database, no mocks" (TESTING.md §3),
 * and these exist so a test reads as the trade it describes rather than as
 * twelve field assignments.
 *
 * `gross` is computed from `|quantity| × price` exactly as the database `CHECK`
 * `inv_txn_gross_identity` requires, so a fixture cannot express a row the
 * schema would reject.
 */

import { isoDate } from '@/lib/date';
import { Money, add, currency, neg, sub, toDbString, type CurrencyCode, type Money as Amount } from '@/lib/decimal/money';
import { Quantity, qAbs } from '@/lib/decimal/quantity';
import { Rate } from '@/lib/decimal/rate';
import { UnitPrice, perUnit, valueOf } from '@/lib/decimal/price';
import type { ReplayOptions, ReplayTxn } from '@/server/domain/lots/engine';

export const INR = currency('INR');
export const USD = currency('USD');

export const FIFO_INR: ReplayOptions = { method: 'fifo', currency: INR, baseCurrency: INR };
export const FIFO_USD_IN_INR: ReplayOptions = { method: 'fifo', currency: USD, baseCurrency: INR };

let sequence = 0;

/** Reset between tests so ids and `created_at` are reproducible per case. */
export function resetSequence(): void {
  sequence = 0;
}

function nextId(): string {
  sequence += 1;
  return `txn-${sequence.toString().padStart(4, '0')}`;
}

/**
 * `created_at` advances with the sequence, so "insertion order" is a real,
 * controllable input — which is exactly what the order-independence tests need
 * to vary.
 */
function nextCreatedAt(): Date {
  return new Date(Date.UTC(2020, 0, 1, 0, 0, sequence));
}

interface Common {
  readonly on: string;
  readonly id?: string;
  readonly createdAt?: Date;
  /** Instrument → base. Defaults to 1, which is the same-currency case. */
  readonly fx?: string;
  readonly currency?: CurrencyCode;
}

function base(spec: Common): Pick<ReplayTxn, 'id' | 'tradeDate' | 'createdAt' | 'fxInstrumentToBase'> {
  const id = spec.id ?? nextId();
  const createdAt = spec.createdAt ?? nextCreatedAt();
  return {
    id,
    tradeDate: isoDate(spec.on),
    createdAt,
    fxInstrumentToBase: spec.fx === undefined ? Rate.one() : Rate.of(spec.fx),
  };
}

const zeroIn = (c: CurrencyCode | undefined): Amount => Money.zero(c ?? INR);

export interface TradeSpec extends Common {
  readonly qty: string;
  readonly price: string;
  readonly fees?: string;
  readonly taxes?: string;
}

/** `buy` / `mf_purchase`: cash out is `−(gross + fees + taxes)`; the lot opens at that total. */
export function buy(spec: TradeSpec, kind: 'buy' | 'mf_purchase' = 'buy'): ReplayTxn {
  const c = spec.currency ?? INR;
  const quantity = Quantity.of(spec.qty);
  const price = UnitPrice.of(spec.price);
  const gross = valueOf(qAbs(quantity), price, c, 'half_up');
  const fees = spec.fees === undefined ? Money.zero(c) : Money.of(spec.fees, c);
  const taxes = spec.taxes === undefined ? Money.zero(c) : Money.of(spec.taxes, c);
  return {
    ...base(spec),
    kind,
    quantity: qAbs(quantity),
    grossAmount: gross,
    fees,
    taxes,
    netAmountInstrument: neg(add(add(gross, fees), taxes)),
    ratioNum: null,
    ratioDen: null,
    originalAcquiredOn: null,
  };
}

/** `sell` / `mf_redemption`: cash in is `gross − fees − taxes`; lots close FIFO. */
export function sell(spec: TradeSpec, kind: 'sell' | 'mf_redemption' = 'sell'): ReplayTxn {
  const c = spec.currency ?? INR;
  const quantity = qAbs(Quantity.of(spec.qty));
  const price = UnitPrice.of(spec.price);
  const gross = valueOf(quantity, price, c, 'half_up');
  const fees = spec.fees === undefined ? Money.zero(c) : Money.of(spec.fees, c);
  const taxes = spec.taxes === undefined ? Money.zero(c) : Money.of(spec.taxes, c);
  return {
    ...base(spec),
    kind,
    quantity: Quantity.fromUnits(-quantity.units),
    grossAmount: gross,
    fees,
    taxes,
    netAmountInstrument: sub(sub(gross, fees), taxes),
    ratioNum: null,
    ratioDen: null,
    originalAcquiredOn: null,
  };
}

export interface TransferInSpec extends Common {
  readonly qty: string;
  /** The carried basis, per unit. */
  readonly price: string;
  /** The ORIGINAL acquisition date. Omitted means the transfer date itself. */
  readonly acquiredOn?: string;
}

/** A transfer carries basis and the holding clock, and moves no cash and no fees. */
export function transferIn(spec: TransferInSpec): ReplayTxn {
  const c = spec.currency ?? INR;
  const quantity = qAbs(Quantity.of(spec.qty));
  const gross = valueOf(quantity, UnitPrice.of(spec.price), c, 'half_up');
  return {
    ...base(spec),
    kind: 'transfer_in',
    quantity,
    grossAmount: gross,
    fees: Money.zero(c),
    taxes: Money.zero(c),
    netAmountInstrument: Money.zero(c),
    ratioNum: null,
    ratioDen: null,
    originalAcquiredOn: spec.acquiredOn === undefined ? null : isoDate(spec.acquiredOn),
  };
}

export function transferOut(spec: Common & { readonly qty: string; readonly price: string }): ReplayTxn {
  const c = spec.currency ?? INR;
  const quantity = qAbs(Quantity.of(spec.qty));
  const gross = valueOf(quantity, UnitPrice.of(spec.price), c, 'half_up');
  return {
    ...base(spec),
    kind: 'transfer_out',
    quantity: Quantity.fromUnits(-quantity.units),
    grossAmount: gross,
    fees: Money.zero(c),
    taxes: Money.zero(c),
    netAmountInstrument: Money.zero(c),
    ratioNum: null,
    ratioDen: null,
    originalAcquiredOn: null,
  };
}

export interface IncomeSpec extends Common {
  /** The DECLARED amount. `income_total` accrues this, gross (I-12). */
  readonly gross: string;
  readonly fees?: string;
  /** Withholding — TDS. Accrues to `taxes_total`, never netted into income. */
  readonly taxes?: string;
}

export function dividend(spec: IncomeSpec, kind: 'dividend' | 'interest' = 'dividend'): ReplayTxn {
  const c = spec.currency ?? INR;
  const gross = Money.of(spec.gross, c);
  const fees = spec.fees === undefined ? Money.zero(c) : Money.of(spec.fees, c);
  const taxes = spec.taxes === undefined ? Money.zero(c) : Money.of(spec.taxes, c);
  return {
    ...base(spec),
    kind,
    quantity: null,
    grossAmount: gross,
    fees,
    taxes,
    netAmountInstrument: sub(sub(gross, fees), taxes),
    ratioNum: null,
    ratioDen: null,
    originalAcquiredOn: null,
  };
}

export const interest = (spec: IncomeSpec): ReplayTxn => dividend(spec, 'interest');

/** A standalone charge: no lot effect, accrues `|net_amount_instrument|`. */
export function feeRow(spec: Common & { readonly amount: string }, kind: 'fee' | 'tax' = 'fee'): ReplayTxn {
  const c = spec.currency ?? INR;
  return {
    ...base(spec),
    kind,
    quantity: null,
    grossAmount: null,
    fees: zeroIn(spec.currency),
    taxes: zeroIn(spec.currency),
    netAmountInstrument: neg(Money.of(spec.amount, c)),
    ratioNum: null,
    ratioDen: null,
    originalAcquiredOn: null,
  };
}

export const taxRow = (spec: Common & { readonly amount: string }): ReplayTxn => feeRow(spec, 'tax');

export interface RatioSpec extends Common {
  /** New units per `den` old. A 1:5 split is `num: 5, den: 1`. */
  readonly num: number;
  readonly den: number;
}

function corporateAction(spec: RatioSpec, kind: 'split' | 'bonus'): ReplayTxn {
  const c = spec.currency ?? INR;
  return {
    ...base(spec),
    kind,
    quantity: null,
    grossAmount: null,
    fees: Money.zero(c),
    taxes: Money.zero(c),
    netAmountInstrument: Money.zero(c),
    ratioNum: spec.num,
    ratioDen: spec.den,
    originalAcquiredOn: null,
  };
}

export const split = (spec: RatioSpec): ReplayTxn => corporateAction(spec, 'split');
export const bonus = (spec: RatioSpec): ReplayTxn => corporateAction(spec, 'bonus');

// ------------------------------------------------------------------ asserters

/** `toDbString` on every money field, so a failure prints figures rather than bigints. */
export const money = (m: Amount): string => toDbString(m);

export const derivedPerUnit = (m: Amount, q: Quantity): string =>
  perUnit(m, q, 'half_up').units.toString();

export { Quantity, Money, Rate, UnitPrice };
