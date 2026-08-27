/**
 * Fixtures for the investment integration layer.
 *
 * Everything goes through the **application services**, so a fixture the
 * services would reject cannot exist. `rawSql` is the deliberate exception, used
 * by the constraint tests whose whole purpose is to prove the database refuses a
 * row even when the service layer is bypassed — a rule enforced only in
 * TypeScript is not enforced against a restore, a script, or `psql`.
 */

import { sql } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { isoDate } from '@/lib/date';
import { currency } from '@/lib/decimal/money';
import { UnitPrice } from '@/lib/decimal/price';
import type { DomainError, Result } from '@/lib/result';
import { exchangeCloseInstant, resolveMic } from '@/server/market-data/exchanges';
import { storePriceObservations } from '@/server/services/market-data';
import {
  createInstrument,
  createInvestmentTransaction,
  setManualPrice,
  withWriteCtxResult,
  type ReadCtx,
  type WriteCtx,
} from '@/server/services';
import { must, rawSql, write, type MoneyFixture } from './money-harness';

/**
 * A command that rolls back when it returns an error.
 *
 * Every investment mutation goes through this, because the rebuild that can
 * reject it runs *after* the row is inserted — so "returns an error" and "wrote
 * nothing" are only the same statement inside `withWriteCtxResult`.
 */
function writeResult<T>(
  ctx: ReadCtx,
  fn: (w: WriteCtx) => Promise<Result<T, DomainError>>,
): Promise<Result<T, DomainError>> {
  return withWriteCtxResult(ctx, fn);
}

export interface InstrumentSpec {
  readonly symbol: string;
  readonly name?: string;
  readonly exchange?: string;
  readonly assetClass?:
    | 'equity'
    | 'mutual_fund'
    | 'etf'
    | 'bond'
    | 'fixed_deposit'
    | 'gold'
    | 'crypto'
    | 'cash_equivalent'
    | 'other';
  readonly currencyCode?: string;
  readonly country?: string;
}

export async function makeInstrument(ctx: ReadCtx, spec: InstrumentSpec): Promise<string> {
  const created = await write(ctx, (w) =>
    createInstrument(w, {
      symbol: spec.symbol,
      name: spec.name ?? spec.symbol,
      exchange: spec.exchange ?? 'NSE',
      assetClass: spec.assetClass ?? 'equity',
      currencyCode: spec.currencyCode ?? 'INR',
      country: spec.country ?? 'IN',
      costBasisMethod: 'fifo',
    }),
  );
  return must(created).id;
}

export interface TradeSpec {
  readonly accountId: string;
  readonly instrumentId: string;
  readonly on: string;
  readonly qty: string;
  readonly price: string;
  readonly fees?: string;
  readonly taxes?: string;
  readonly notes?: string;
}

export async function recordBuy(ctx: ReadCtx, spec: TradeSpec, kind: 'buy' | 'mf_purchase' = 'buy') {
  return writeResult(ctx, (w) =>
    createInvestmentTransaction(w, {
      kind,
      accountId: spec.accountId,
      instrumentId: spec.instrumentId,
      tradeDate: spec.on,
      quantity: spec.qty,
      price: spec.price,
      fees: spec.fees ?? '',
      taxes: spec.taxes ?? '',
      notes: spec.notes ?? '',
    }),
  );
}

export async function recordSell(ctx: ReadCtx, spec: TradeSpec, kind: 'sell' | 'mf_redemption' = 'sell') {
  return writeResult(ctx, (w) =>
    createInvestmentTransaction(w, {
      kind,
      accountId: spec.accountId,
      instrumentId: spec.instrumentId,
      tradeDate: spec.on,
      quantity: spec.qty,
      price: spec.price,
      fees: spec.fees ?? '',
      taxes: spec.taxes ?? '',
      notes: spec.notes ?? '',
    }),
  );
}

export async function recordDividend(
  ctx: ReadCtx,
  spec: {
    readonly accountId: string;
    readonly instrumentId?: string;
    readonly on: string;
    readonly gross: string;
    readonly fees?: string;
    readonly taxes?: string;
  },
  kind: 'dividend' | 'interest' = 'dividend',
) {
  return writeResult(ctx, (w) =>
    createInvestmentTransaction(w, {
      kind,
      accountId: spec.accountId,
      ...(spec.instrumentId === undefined ? {} : { instrumentId: spec.instrumentId }),
      tradeDate: spec.on,
      grossAmount: spec.gross,
      fees: spec.fees ?? '',
      taxes: spec.taxes ?? '',
    }),
  );
}

export async function recordCharge(
  ctx: ReadCtx,
  spec: {
    readonly accountId: string;
    readonly instrumentId?: string;
    readonly on: string;
    readonly amount: string;
  },
  kind: 'fee' | 'tax' = 'fee',
) {
  return writeResult(ctx, (w) =>
    createInvestmentTransaction(w, {
      kind,
      accountId: spec.accountId,
      ...(spec.instrumentId === undefined ? {} : { instrumentId: spec.instrumentId }),
      tradeDate: spec.on,
      amount: spec.amount,
    }),
  );
}

export async function recordCorporateAction(
  ctx: ReadCtx,
  spec: {
    readonly accountId: string;
    readonly instrumentId: string;
    readonly on: string;
    readonly num: number;
    readonly den: number;
  },
  kind: 'split' | 'bonus' = 'split',
) {
  return writeResult(ctx, (w) =>
    createInvestmentTransaction(w, {
      kind,
      accountId: spec.accountId,
      instrumentId: spec.instrumentId,
      tradeDate: spec.on,
      ratioNum: spec.num,
      ratioDen: spec.den,
    }),
  );
}

export async function recordTransferIn(
  ctx: ReadCtx,
  spec: {
    readonly accountId: string;
    readonly instrumentId: string;
    readonly on: string;
    readonly qty: string;
    readonly price: string;
    readonly acquiredOn?: string;
  },
) {
  return writeResult(ctx, (w) =>
    createInvestmentTransaction(w, {
      kind: 'transfer_in',
      accountId: spec.accountId,
      instrumentId: spec.instrumentId,
      tradeDate: spec.on,
      quantity: spec.qty,
      price: spec.price,
      originalAcquiredOn: spec.acquiredOn ?? '',
    }),
  );
}

export async function recordTransferOut(
  ctx: ReadCtx,
  spec: {
    readonly accountId: string;
    readonly instrumentId: string;
    readonly on: string;
    readonly qty: string;
    readonly price: string;
  },
) {
  return writeResult(ctx, (w) =>
    createInvestmentTransaction(w, {
      kind: 'transfer_out',
      accountId: spec.accountId,
      instrumentId: spec.instrumentId,
      tradeDate: spec.on,
      quantity: spec.qty,
      price: spec.price,
    }),
  );
}

export async function priceIt(
  ctx: ReadCtx,
  instrumentId: string,
  price: string,
  asOf?: string,
): Promise<void> {
  const result = await write(ctx, (w) =>
    setManualPrice(w, {
      instrumentId,
      price,
      asOf: asOf ?? '',
    }),
  );
  must(result as Result<unknown, DomainError>);
}

/**
 * Store a historical close, and advance the quote with it.
 *
 * The **service** path, not a raw insert: `storePriceObservations` enforces
 * I-33/I-34 (currency), I-35 (one source per series) and I-36 (the age-guarded
 * quote), so a fixture the market-data layer would refuse cannot exist here
 * either.
 *
 * `observedAt` defaults to the exchange's close on that trading date, which is
 * what SCHEMA.md §5 requires a stored quote's `as_of` to be — never midnight and
 * never the fetch time.
 */
export async function storeClose(
  ctx: ReadCtx,
  spec: {
    readonly instrumentId: string;
    readonly on: string;
    readonly close: string;
    readonly currencyCode?: string;
    readonly source?: string;
    readonly observedAt?: Date;
    readonly kind?: 'eod' | 'nav' | 'continuous';
  },
): Promise<void> {
  const tradingDate = isoDate(spec.on);
  const venue = resolveMic('NSE');
  const observedAt =
    spec.observedAt ??
    (venue === null ? new Date(`${spec.on}T10:00:00Z`) : (exchangeCloseInstant(venue, tradingDate) ?? new Date(`${spec.on}T10:00:00Z`)));

  const outcome = await write(ctx, (w) =>
    storePriceObservations(w, [
      {
        instrumentId: spec.instrumentId,
        close: UnitPrice.of(spec.close),
        currency: currency(spec.currencyCode ?? 'INR'),
        tradingDate,
        observedAt,
        kind: spec.kind ?? 'eod',
        source: spec.source ?? 'test-feed',
        providerRef: null,
      },
    ]),
  );

  if (outcome.stored !== 1) {
    throw new Error(
      `storeClose: the observation was refused (${JSON.stringify(outcome.rejected)}). ` +
        'A fixture the market-data layer would reject must not be forced into the table.',
    );
  }
}

/** An open corporate-action detection, which suppresses the instrument\'s value (ADR-29). */
export async function detectSplit(
  userId: string,
  spec: {
    readonly instrumentId: string;
    readonly exDate: string;
    readonly num: number;
    readonly den: number;
  },
): Promise<void> {
  await rawSql(
    `insert into corporate_action_detections
       (user_id, instrument_id, kind, ex_date, ratio_num, ratio_den, source, detected_at)
     values ($1, $2, 'split', $3, $4, $5, 'test-feed', now())
     on conflict do nothing`,
    [userId, spec.instrumentId, spec.exDate, spec.num, spec.den],
  );
}

// ------------------------------------------------------------------- readers

export interface LotSnapshot {
  readonly openedOn: string;
  readonly acquiredOn: string;
  readonly originalQuantity: string;
  readonly remainingQuantity: string;
  readonly costTotal: string;
  readonly remainingCost: string;
}

/** Lots for a position, oldest first — the order FIFO consumes them in. */
export async function lotSnapshot(userId: string, instrumentId: string): Promise<LotSnapshot[]> {
  const { rows } = await db().execute<{
    opened_on: string;
    acquired_on: string;
    original_quantity: string;
    remaining_quantity: string;
    cost_total: string;
    remaining_cost: string;
  }>(sql`
    select opened_on::text, acquired_on::text, original_quantity::text,
           remaining_quantity::text, cost_total::text, remaining_cost::text
      from tax_lots
     where user_id = ${userId} and instrument_id = ${instrumentId}
     order by opened_on asc, id asc
  `);
  return rows.map((row) => ({
    openedOn: row.opened_on,
    acquiredOn: row.acquired_on,
    originalQuantity: row.original_quantity,
    remainingQuantity: row.remaining_quantity,
    costTotal: row.cost_total,
    remainingCost: row.remaining_cost,
  }));
}

export interface PositionSnapshot {
  readonly quantity: string;
  readonly costBasis: string;
  readonly baseCostBasis: string;
  readonly realizedPnl: string;
  readonly incomeTotal: string;
  readonly feesTotal: string;
  readonly taxesTotal: string;
  readonly ledgerVersion: string;
}

export async function positionSnapshot(
  userId: string,
  instrumentId: string,
): Promise<PositionSnapshot | null> {
  const { rows } = await db().execute<{
    quantity: string;
    cost_basis: string;
    base_cost_basis: string;
    realized_pnl: string;
    income_total: string;
    fees_total: string;
    taxes_total: string;
    ledger_version: string;
  }>(sql`
    select quantity::text, cost_basis::text, base_cost_basis::text, realized_pnl::text,
           income_total::text, fees_total::text, taxes_total::text, ledger_version::text
      from positions
     where user_id = ${userId} and instrument_id = ${instrumentId}
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    quantity: row.quantity,
    costBasis: row.cost_basis,
    baseCostBasis: row.base_cost_basis,
    realizedPnl: row.realized_pnl,
    incomeTotal: row.income_total,
    feesTotal: row.fees_total,
    taxesTotal: row.taxes_total,
    ledgerVersion: row.ledger_version,
  };
}

/**
 * A byte-level fingerprint of every derived row for a user.
 *
 * Used to assert that a rolled-back mutation left nothing behind, and that a
 * full rebuild produces output identical to the incremental path.
 */
export async function derivedFingerprint(userId: string): Promise<string> {
  const lots = await db().execute<{ signature: string }>(sql`
    select concat_ws('|', 'lot', account_id::text, instrument_id::text, opened_on::text,
                     acquired_on::text, original_quantity::text, remaining_quantity::text,
                     cost_total::text, remaining_cost::text, fx_rate_to_base::text) as signature
      from tax_lots where user_id = ${userId}
     order by instrument_id, opened_on, cost_total, original_quantity
  `);
  const disposals = await db().execute<{ signature: string }>(sql`
    select concat_ws('|', 'disposal', d.closed_on::text, d.quantity::text, d.proceeds::text,
                     d.cost_consumed::text, d.realized_pnl::text, d.base_realized_pnl::text,
                     d.base_fx_component::text, d.holding_days::text) as signature
      from lot_disposals d
     where d.user_id = ${userId}
     order by d.closed_on, d.quantity, d.proceeds, d.cost_consumed
  `);
  const pos = await db().execute<{ signature: string }>(sql`
    select concat_ws('|', 'position', account_id::text, instrument_id::text, quantity::text,
                     cost_basis::text, base_cost_basis::text, realized_pnl::text,
                     income_total::text, fees_total::text, taxes_total::text,
                     first_trade_on::text, last_trade_on::text) as signature
      from positions where user_id = ${userId}
     order by account_id, instrument_id
  `);

  return [...lots.rows, ...disposals.rows, ...pos.rows].map((r) => r.signature).join('\n');
}

export async function investmentLedgerVersion(userId: string): Promise<string> {
  const { rows } = await db().execute<{ v: string }>(sql`
    select investment_ledger_version::text as v from user_state where user_id = ${userId}
  `);
  return rows[0]?.v ?? '0';
}

/** The investment tables, emptied between tests. */
const INVESTMENT_TABLES = [
  'lot_disposals',
  'tax_lots',
  'positions',
  'investment_transactions',
  'instrument_quotes',
  'instrument_prices',
  'instruments',
] as const;

export async function truncateInvestments(): Promise<void> {
  await rawSql(
    `truncate table ${INVESTMENT_TABLES.map((t) => `"${t}"`).join(', ')} restart identity cascade`,
  );
}

export { must, rawSql, write };
export type { MoneyFixture };
