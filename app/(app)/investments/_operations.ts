/**
 * `FormData` → service call, for the investment area.
 *
 * Kept out of `actions.ts` because that module may export only async server
 * functions. Nothing here validates: `src/lib/schemas/investments.ts` is the
 * single validation boundary (ADR-16), and these functions only reshape strings.
 *
 * **No function here supplies a sign.** The forms collect a positive quantity
 * and a kind; the service derives every sign, gross amount and net amount from
 * them — which is what stops a mis-typed minus from becoming a wrong holding.
 */

import type { DomainError, Result } from '@/lib/result';
import * as services from '@/server/services';
import type { WriteCtx } from '@/server/services';

const text = (form: FormData, key: string): string | undefined => {
  const value = form.get(key);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

const required = (form: FormData, key: string): string => text(form, key) ?? '';

export async function createInstrumentRecord(
  ctx: WriteCtx,
  form: FormData,
): Promise<Result<unknown, DomainError>> {
  return services.createInstrument(ctx, {
    symbol: required(form, 'symbol'),
    exchange: text(form, 'exchange'),
    isin: text(form, 'isin'),
    name: required(form, 'name'),
    assetClass: required(form, 'assetClass'),
    currencyCode: required(form, 'currencyCode'),
    country: text(form, 'country'),
    costBasisMethod: 'fifo',
  });
}

export async function setInstrumentActiveById(
  ctx: WriteCtx,
  form: FormData,
): Promise<Result<unknown, DomainError>> {
  return services.updateInstrument(ctx, required(form, 'id'), {
    isActive: form.get('isActive') === 'true',
  });
}

export async function deleteInstrumentById(
  ctx: WriteCtx,
  form: FormData,
): Promise<Result<void, DomainError>> {
  return services.deleteInstrument(ctx, required(form, 'id'));
}

export async function setPriceRecord(
  ctx: WriteCtx,
  form: FormData,
): Promise<Result<unknown, DomainError>> {
  return services.setManualPrice(ctx, {
    instrumentId: required(form, 'instrumentId'),
    price: required(form, 'price'),
    asOf: text(form, 'asOf'),
  });
}

/**
 * One entry point for every ledger kind.
 *
 * The discriminated union in `createInvestmentTransactionSchema` decides which
 * fields matter, so the form can omit the ones its kind does not use and the
 * schema will reject anything missing — rather than this function guessing.
 */
export async function createInvestmentTransactionRecord(
  ctx: WriteCtx,
  form: FormData,
): Promise<Result<unknown, DomainError>> {
  const kind = required(form, 'kind');

  const common = {
    kind,
    accountId: required(form, 'accountId'),
    tradeDate: required(form, 'tradeDate'),
    settlementDate: text(form, 'settlementDate'),
    notes: text(form, 'notes'),
  };

  switch (kind) {
    case 'buy':
    case 'sell':
    case 'mf_purchase':
    case 'mf_redemption':
      return services.createInvestmentTransaction(ctx, {
        ...common,
        instrumentId: required(form, 'instrumentId'),
        quantity: required(form, 'quantity'),
        price: required(form, 'price'),
        fees: text(form, 'fees'),
        taxes: text(form, 'taxes'),
      });

    case 'dividend':
    case 'interest':
      return services.createInvestmentTransaction(ctx, {
        ...common,
        instrumentId: text(form, 'instrumentId'),
        grossAmount: required(form, 'grossAmount'),
        fees: text(form, 'fees'),
        taxes: text(form, 'taxes'),
      });

    case 'fee':
    case 'tax':
      return services.createInvestmentTransaction(ctx, {
        ...common,
        instrumentId: text(form, 'instrumentId'),
        amount: required(form, 'amount'),
      });

    case 'split':
    case 'bonus':
      return services.createInvestmentTransaction(ctx, {
        ...common,
        instrumentId: required(form, 'instrumentId'),
        ratioNum: required(form, 'ratioNum'),
        ratioDen: required(form, 'ratioDen'),
      });

    case 'transfer_in':
      return services.createInvestmentTransaction(ctx, {
        ...common,
        instrumentId: required(form, 'instrumentId'),
        quantity: required(form, 'quantity'),
        price: required(form, 'price'),
        originalAcquiredOn: text(form, 'originalAcquiredOn'),
      });

    case 'transfer_out':
      return services.createInvestmentTransaction(ctx, {
        ...common,
        instrumentId: required(form, 'instrumentId'),
        quantity: required(form, 'quantity'),
        price: required(form, 'price'),
      });

    default:
      // The schema rejects it with a field error rather than this function
      // inventing a message the user cannot act on.
      return services.createInvestmentTransaction(ctx, common);
  }
}

export async function deleteInvestmentTransactionById(
  ctx: WriteCtx,
  form: FormData,
): Promise<Result<void, DomainError>> {
  return services.deleteInvestmentTransaction(ctx, required(form, 'id'));
}

export async function rebuildPositionsRecord(
  ctx: WriteCtx,
): Promise<Result<unknown, DomainError>> {
  return services.rebuildAllPositions(ctx);
}
