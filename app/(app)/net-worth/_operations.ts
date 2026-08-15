import 'server-only';

/**
 * Form-data → service-call translation for the Net Worth area.
 *
 * Kept out of `actions.ts` because a `'use server'` module may export only async
 * functions: every export there becomes a callable endpoint
 * (`tests/unit/server-actions.test.ts` guards the rule).
 *
 * **Net worth itself appears nowhere in this file.** It is read-only — an
 * aggregation, not a ledger — so the only writes Phase 5 has are to manual
 * assets and liabilities.
 */

import {
  closeLiability,
  createLiability,
  createManualAsset,
  deleteLiability,
  deleteManualAsset,
  disposeAsset,
  recordLiabilityBalance,
  revalueAsset,
  type WriteCtx,
} from '@/server/services';

function text(form: FormData, field: string): string {
  const value = form.get(field);
  return typeof value === 'string' ? value.trim() : '';
}

// -------------------------------------------------------------- manual assets

export async function createAssetFromForm(ctx: WriteCtx, form: FormData) {
  return createManualAsset(ctx, {
    name: text(form, 'name'),
    kind: text(form, 'kind'),
    currencyCode: text(form, 'currencyCode'),
    value: text(form, 'value'),
    valuedOn: text(form, 'valuedOn'),
    acquiredOn: text(form, 'acquiredOn'),
    acquisitionCost: text(form, 'acquisitionCost'),
    notes: text(form, 'notes'),
  });
}

export async function revalueAssetFromForm(ctx: WriteCtx, form: FormData) {
  return revalueAsset(ctx, {
    assetId: text(form, 'assetId'),
    asOf: text(form, 'asOf'),
    value: text(form, 'value'),
    note: text(form, 'note'),
  });
}

export async function disposeAssetFromForm(ctx: WriteCtx, form: FormData) {
  return disposeAsset(ctx, {
    assetId: text(form, 'assetId'),
    disposedOn: text(form, 'disposedOn'),
  });
}

export async function deleteAssetById(ctx: WriteCtx, id: string) {
  return deleteManualAsset(ctx, id);
}

// ---------------------------------------------------------------- liabilities

export async function createLiabilityFromForm(ctx: WriteCtx, form: FormData) {
  return createLiability(ctx, {
    name: text(form, 'name'),
    kind: text(form, 'kind'),
    currencyCode: text(form, 'currencyCode'),
    linkedAccountId: text(form, 'linkedAccountId'),
    openingBalance: text(form, 'openingBalance'),
    openingBalanceOn: text(form, 'openingBalanceOn'),
    principalOriginal: text(form, 'principalOriginal'),
    interestRate: text(form, 'interestRate'),
    emiAmount: text(form, 'emiAmount'),
    startedOn: text(form, 'startedOn'),
    endsOn: text(form, 'endsOn'),
    notes: text(form, 'notes'),
  });
}

export async function recordBalanceFromForm(ctx: WriteCtx, form: FormData) {
  return recordLiabilityBalance(ctx, {
    liabilityId: text(form, 'liabilityId'),
    asOf: text(form, 'asOf'),
    outstanding: text(form, 'outstanding'),
  });
}

export async function closeLiabilityFromForm(ctx: WriteCtx, form: FormData) {
  return closeLiability(ctx, {
    liabilityId: text(form, 'liabilityId'),
    closedOn: text(form, 'closedOn'),
  });
}

export async function deleteLiabilityById(ctx: WriteCtx, id: string) {
  return deleteLiability(ctx, id);
}
