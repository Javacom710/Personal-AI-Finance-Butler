/**
 * Fixtures for the net-worth integration layer.
 *
 * Everything goes through the **application services**, so a fixture the
 * services would reject cannot exist. Net worth itself is read-only, so there is
 * nothing here that writes one — its inputs are accounts, the two ledgers, and
 * the two Phase 5 series.
 */

import { Pool } from 'pg';

import type { IsoDate } from '@/lib/date';
import { toDbString } from '@/lib/decimal/money';
import {
  closeLiability,
  createLiability,
  createManualAsset,
  disposeAsset,
  recordLiabilityBalance,
  revalueAsset,
  type RequestCtx,
} from '@/server/services';
import { must, write } from './money-harness';

export interface ManualAssetSpec {
  readonly name: string;
  readonly kind?: 'property' | 'vehicle' | 'gold_physical' | 'collectible' | 'receivable' | 'other';
  readonly currencyCode?: string;
  readonly value: string;
  readonly valuedOn?: string;
  readonly acquiredOn?: string;
  readonly acquisitionCost?: string;
}

export async function makeAsset(ctx: RequestCtx, spec: ManualAssetSpec): Promise<string> {
  const created = await write(ctx, (w) =>
    createManualAsset(w, {
      name: spec.name,
      kind: spec.kind ?? 'property',
      currencyCode: spec.currencyCode ?? 'INR',
      value: spec.value,
      valuedOn: spec.valuedOn ?? '',
      acquiredOn: spec.acquiredOn ?? '',
      acquisitionCost: spec.acquisitionCost ?? '',
    }),
  );
  return must(created).id;
}

export async function revalue(
  ctx: RequestCtx,
  assetId: string,
  asOf: string,
  value: string,
): Promise<void> {
  must(await write(ctx, (w) => revalueAsset(w, { assetId, asOf, value })));
}

export async function dispose(ctx: RequestCtx, assetId: string, disposedOn: string): Promise<void> {
  must(await write(ctx, (w) => disposeAsset(w, { assetId, disposedOn })));
}

export interface LiabilitySpec {
  readonly name: string;
  readonly kind?: 'home_loan' | 'auto_loan' | 'personal_loan' | 'student_loan' | 'credit_card' | 'other';
  readonly currencyCode?: string;
  /** Scheduled shape: the first outstanding figure. Omit to link an account instead. */
  readonly openingBalance?: string;
  readonly openingBalanceOn?: string;
  readonly linkedAccountId?: string;
  readonly interestRate?: string;
  readonly emiAmount?: string;
  readonly startedOn?: string;
}

export async function makeLiability(ctx: RequestCtx, spec: LiabilitySpec): Promise<string> {
  const created = await write(ctx, (w) =>
    createLiability(w, {
      name: spec.name,
      kind: spec.kind ?? 'home_loan',
      currencyCode: spec.currencyCode ?? 'INR',
      openingBalance: spec.openingBalance ?? '',
      openingBalanceOn: spec.openingBalanceOn ?? '',
      linkedAccountId: spec.linkedAccountId ?? '',
      interestRate: spec.interestRate ?? '',
      emiAmount: spec.emiAmount ?? '',
      startedOn: spec.startedOn ?? '',
    }),
  );
  return must(created).id;
}

export async function recordBalance(
  ctx: RequestCtx,
  liabilityId: string,
  asOf: string,
  outstanding: string,
): Promise<void> {
  must(await write(ctx, (w) => recordLiabilityBalance(w, { liabilityId, asOf, outstanding })));
}

export async function closeIt(ctx: RequestCtx, liabilityId: string, closedOn: string): Promise<void> {
  must(await write(ctx, (w) => closeLiability(w, { liabilityId, closedOn })));
}

/** `netWorth` as a plain string, for readable assertions. */
export function nw(result: { readonly netWorth: { minor: bigint; currency: string } }): string {
  return toDbString(result.netWorth as never);
}

// ----------------------------------------------------------------- truncation

let adminPool: Pool | null = null;

const NET_WORTH_TABLES = [
  'asset_valuations',
  'manual_assets',
  'liability_balances',
  'liabilities',
] as const;

/**
 * The Phase 5 tables, emptied between tests.
 *
 * Ordered dependants-first even though `CASCADE` would handle it: an explicit
 * order is a statement about which table owns which, and it does not change
 * silently when a foreign key is added.
 */
export async function truncateNetWorth(): Promise<void> {
  if (!adminPool) {
    const url = process.env['TEST_DATABASE_URL'];
    if (!url) throw new Error('TEST_DATABASE_URL is not set.');
    adminPool = new Pool({ connectionString: url, max: 2 });
  }
  await adminPool.query(
    `truncate table ${NET_WORTH_TABLES.map((t) => `"${t}"`).join(', ')} restart identity cascade`,
  );
}

export async function closeNetWorthHarness(): Promise<void> {
  if (adminPool) {
    await adminPool.end();
    adminPool = null;
  }
}

export type { IsoDate };
export { must, write };
