import 'server-only';

/**
 * Position rebuilding — the bridge between the ledger and the derived cache
 * ([INVESTMENT-DOMAIN.md §4](../../../docs/INVESTMENT-DOMAIN.md#rebuild),
 * [ADR-06](../../../docs/DECISIONS.md#adr-06--holdings-are-derived-cached-and-rebuildable)).
 *
 * ```
 * rebuildPosition(userId, accountId, instrumentId):
 *   DELETE lot_disposals WHERE lot_id IN (lots for this position)
 *   DELETE tax_lots      WHERE (user, account, instrument)
 *   txns = SELECT ... ORDER BY trade_date, created_at, id
 *   result = replay(sortByReplayOrder(txns), instrument.cost_basis_method)
 *   INSERT lots, disposals
 *   UPSERT positions with result.position + the current investment_ledger_version
 * ```
 *
 * **This runs inside the same database transaction as the ledger mutation that
 * triggered it.** There is no window in which `positions` disagrees with the
 * ledger, and a replay that fails — an oversell introduced by a backdated sell —
 * rolls the whole mutation back rather than leaving derived state behind. A
 * mutation anywhere in a position's history re-replays that position's **entire**
 * history; there is no incremental-patch path, because incremental patching is
 * where derived state drifts.
 *
 * `positions.ledger_version` is stamped here as **provenance**. Nothing compares
 * it against `user_state.investment_ledger_version` to decide whether to
 * rebuild: that counter is global per user, so after any trade every position
 * but the one just rebuilt carries a lower value, and a staleness comparison
 * would report the whole portfolio stale forever.
 */

import { eq, sql } from 'drizzle-orm';

import { isoDate } from '../../lib/date';
import { Money, currency, toDbString, type CurrencyCode } from '../../lib/decimal/money';
import { Quantity, qToDbString } from '../../lib/decimal/quantity';
import { rToDbString, type Rate } from '../../lib/decimal/rate';
import { err, insufficientData, invariantViolation, ok, type DomainError, type Result } from '../../lib/result';
import { replay, type ReplayError, type ReplayTxn } from '../domain/lots/engine';
import type { CostBasisMethod } from '../domain/lots/fifo';
import type { InvestmentKind } from '../domain/lots/order';
import { instruments, investmentTransactions, lotDisposals, positions, taxLots } from '../db/schema';
import type { ReadCtx, WriteCtx } from './_ctx';
import { currentInvestmentLedgerVersion } from './_ctx';

export interface PositionKey {
  readonly accountId: string;
  readonly instrumentId: string;
}

interface LedgerRow {
  /** `db.execute` types its rows as a record; the named fields below are the contract. */
  [column: string]: unknown;
  id: string;
  kind: InvestmentKind;
  trade_date: string;
  created_at: Date;
  quantity: string | null;
  gross_amount: string | null;
  fees: string;
  taxes: string;
  net_amount_instrument: string;
  ratio_num: number | null;
  ratio_den: number | null;
  original_acquired_on: string | null;
  currency_code: string;
}

/**
 * Rebuild one `(account, instrument)` position from its whole ledger history.
 *
 * `version` is the value to stamp — the caller has already bumped it, in this
 * same transaction, so every position rebuilt by one mutation carries the same
 * stamp.
 */
export async function rebuildPosition(
  ctx: WriteCtx,
  key: PositionKey,
  version: bigint,
): Promise<Result<void, DomainError>> {
  const [instrument] = await ctx.tx
    .select({
      id: instruments.id,
      userId: instruments.userId,
      currencyCode: instruments.currencyCode,
      costBasisMethod: instruments.costBasisMethod,
      symbol: instruments.symbol,
    })
    .from(instruments)
    .where(eq(instruments.id, key.instrumentId))
    .limit(1);

  if (!instrument || instrument.userId !== ctx.userId) {
    return err(invariantViolation('rebuild', 'Rebuild referenced an instrument that is not the caller\'s.'));
  }

  const instrumentCurrency = currency(instrument.currencyCode.trim());

  // Delete before replaying: the rebuild is complete, not incremental. Disposals
  // first, because they reference the lots.
  await ctx.tx.execute(sql`
    delete from ${lotDisposals}
     where lot_id in (
       select id from ${taxLots}
        where user_id = ${ctx.userId}
          and account_id = ${key.accountId}
          and instrument_id = ${key.instrumentId}
     )
  `);
  await ctx.tx.execute(sql`
    delete from ${taxLots}
     where user_id = ${ctx.userId}
       and account_id = ${key.accountId}
       and instrument_id = ${key.instrumentId}
  `);

  const { rows } = await ctx.tx.execute<LedgerRow>(sql`
    select id::text, kind::text as kind, trade_date::text, created_at,
           quantity::text, gross_amount::text, fees::text, taxes::text,
           net_amount_instrument::text, ratio_num, ratio_den,
           original_acquired_on::text, currency_code
      from ${investmentTransactions}
     where user_id = ${ctx.userId}
       and account_id = ${key.accountId}
       and instrument_id = ${key.instrumentId}
     order by trade_date asc, created_at asc, id asc
  `);

  if (rows.length === 0) {
    // Nothing left to derive. The position row goes too — it would otherwise
    // survive as a zero-quantity ghost of a deleted history, which is different
    // from a position genuinely sold down to zero (edge case 18).
    await ctx.tx.execute(sql`
      delete from ${positions}
       where user_id = ${ctx.userId}
         and account_id = ${key.accountId}
         and instrument_id = ${key.instrumentId}
    `);
    return ok(undefined);
  }

  const txns = rows.map((row) => toReplayTxn(row, instrumentCurrency, ctx));
  const replayed = replay(txns, {
    method: instrument.costBasisMethod as CostBasisMethod,
    currency: instrumentCurrency,
    baseCurrency: ctx.base,
  });

  if (!replayed.ok) return err(toDomainError(replayed.error, instrument.symbol));

  const { lots, disposals, totals } = replayed.value;

  // Lots first, then disposals, which reference them. `key` is the engine's
  // stable within-replay index; the database id is only known after the insert.
  const lotIdByKey = new Map<number, string>();
  if (lots.length > 0) {
    const inserted = await ctx.tx
      .insert(taxLots)
      .values(
        lots.map((lot) => ({
          userId: ctx.userId,
          accountId: key.accountId,
          instrumentId: key.instrumentId,
          openedByTxnId: lot.openedByTxnId,
          openedOn: lot.openedOn,
          acquiredOn: lot.acquiredOn,
          originalQuantity: qToDbString(lot.originalQuantity),
          remainingQuantity: qToDbString(lot.remainingQuantity),
          costTotal: toDbString(lot.costTotal),
          remainingCost: toDbString(lot.remainingCost),
          currencyCode: instrumentCurrency,
          fxRateToBase: rToDbString(lot.fxRateToBase),
        })),
      )
      .returning({ id: taxLots.id });

    lots.forEach((lot, index) => {
      const row = inserted[index];
      if (!row) throw new Error('Insert of tax lots returned fewer rows than it was given.');
      lotIdByKey.set(lot.key, row.id);
    });
  }

  if (disposals.length > 0) {
    await ctx.tx.insert(lotDisposals).values(
      disposals.map((disposal) => {
        const lotId = lotIdByKey.get(disposal.lotKey);
        if (lotId === undefined) throw new Error('A disposal referenced a lot that was not inserted.');
        return {
          userId: ctx.userId,
          lotId,
          closedByTxnId: disposal.closedByTxnId,
          closedOn: disposal.closedOn,
          quantity: qToDbString(disposal.quantity),
          proceeds: toDbString(disposal.proceeds),
          costConsumed: toDbString(disposal.costConsumed),
          realizedPnl: toDbString(disposal.realizedPnl),
          fxRateToBase: rToDbString(disposal.fxRateToBase),
          baseRealizedPnl: toDbString(disposal.baseRealizedPnl),
          baseFxComponent: toDbString(disposal.baseFxComponent),
          holdingDays: disposal.holdingDays,
        };
      }),
    );
  }

  await ctx.tx
    .insert(positions)
    .values({
      userId: ctx.userId,
      accountId: key.accountId,
      instrumentId: key.instrumentId,
      quantity: qToDbString(totals.quantity),
      costBasis: toDbString(totals.costBasis),
      baseCostBasis: toDbString(totals.baseCostBasis),
      realizedPnl: toDbString(totals.realizedPnl),
      incomeTotal: toDbString(totals.incomeTotal),
      feesTotal: toDbString(totals.feesTotal),
      taxesTotal: toDbString(totals.taxesTotal),
      firstTradeOn: totals.firstTradeOn,
      lastTradeOn: totals.lastTradeOn,
      ledgerVersion: version,
      computedAt: ctx.now,
    })
    .onConflictDoUpdate({
      target: [positions.userId, positions.accountId, positions.instrumentId],
      set: {
        quantity: qToDbString(totals.quantity),
        costBasis: toDbString(totals.costBasis),
        baseCostBasis: toDbString(totals.baseCostBasis),
        realizedPnl: toDbString(totals.realizedPnl),
        incomeTotal: toDbString(totals.incomeTotal),
        feesTotal: toDbString(totals.feesTotal),
        taxesTotal: toDbString(totals.taxesTotal),
        firstTradeOn: totals.firstTradeOn,
        lastTradeOn: totals.lastTradeOn,
        ledgerVersion: version,
        computedAt: ctx.now,
      },
    });

  return ok(undefined);
}

/** Every `(account, instrument)` pair the instrument appears in. */
export async function rebuildPositionsForInstrument(
  ctx: WriteCtx,
  instrumentId: string,
  version: bigint,
): Promise<Result<void, DomainError>> {
  const { rows } = await ctx.tx.execute<{ account_id: string }>(sql`
    select distinct account_id
      from ${investmentTransactions}
     where user_id = ${ctx.userId} and instrument_id = ${instrumentId}
     order by account_id
  `);

  for (const row of rows) {
    const rebuilt = await rebuildPosition(ctx, { accountId: row.account_id, instrumentId }, version);
    if (!rebuilt.ok) return rebuilt;
  }
  return ok(undefined);
}

/**
 * Rebuild the whole portfolio — `npm run rebuild:positions`.
 *
 * Must produce **byte-identical** output to the incremental path, which is
 * asserted in the integration tests. It bumps the ledger version once and stamps
 * every position with it, so a full rebuild is distinguishable in `audit_log`
 * from the trades that preceded it.
 */
export async function rebuildAllPositions(
  ctx: WriteCtx,
): Promise<Result<{ readonly rebuilt: number }, DomainError>> {
  const version = await currentInvestmentLedgerVersion(ctx);

  const { rows } = await ctx.tx.execute<{ account_id: string; instrument_id: string }>(sql`
    select distinct account_id, instrument_id
      from ${investmentTransactions}
     where user_id = ${ctx.userId} and instrument_id is not null
     order by account_id, instrument_id
  `);

  for (const row of rows) {
    const rebuilt = await rebuildPosition(
      ctx,
      { accountId: row.account_id, instrumentId: row.instrument_id },
      version,
    );
    if (!rebuilt.ok) return rebuilt;
  }

  await ctx.audit.record({
    actor: 'system',
    action: 'positions.rebuild_all',
    entityType: 'position',
    entityId: ctx.userId,
    after: { positions: rows.length, ledgerVersion: version.toString() },
  });

  return ok({ rebuilt: rows.length });
}

/** Positions a mutation touched, so the caller rebuilds exactly those. */
export async function positionsTouchedByTransaction(
  ctx: ReadCtx,
  transactionId: string,
): Promise<PositionKey[]> {
  const { rows } = await ctx.db.execute<{ account_id: string; instrument_id: string | null }>(sql`
    select account_id, instrument_id
      from ${investmentTransactions}
     where id = ${transactionId} and user_id = ${ctx.userId}
  `);
  return rows
    .filter((row): row is { account_id: string; instrument_id: string } => row.instrument_id !== null)
    .map((row) => ({ accountId: row.account_id, instrumentId: row.instrument_id }));
}

// ------------------------------------------------------------------- mapping

/**
 * One ledger row as the engine needs it.
 *
 * The FX rate is resolved **per row and per role**: an acquire is dated by the
 * lot's `acquired_on` — for a `transfer_in`, the *carried* date — so the
 * destination lot's base-currency basis equals the source lot's and a transfer
 * manufactures no currency gain. A disposal is dated by `trade_date`, which is
 * what lets realised P&L split into a price and a currency component.
 *
 * A missing rate throws rather than returning a `Result`: the service refuses
 * the mutation up front when no rate exists, so reaching this during a rebuild
 * means an FX row was deleted after the fact, which is a data-integrity fault
 * and not an expected outcome.
 */
function toReplayTxn(row: LedgerRow, instrumentCurrency: CurrencyCode, ctx: ReadCtx): ReplayTxn {
  const tradeDate = isoDate(row.trade_date);
  const acquiredOn = row.original_acquired_on === null ? tradeDate : isoDate(row.original_acquired_on);
  const rateDate = row.kind === 'transfer_in' ? acquiredOn : tradeDate;

  const selection = ctx.fx.rate(instrumentCurrency, ctx.base, rateDate);
  if (!selection.ok) {
    throw new Error(
      `No exchange rate from ${instrumentCurrency} to ${ctx.base} on or before ${rateDate}, ` +
        `needed to replay investment transaction ${row.id}. The service refuses a mutation without one, ` +
        'so this means a rate row was removed after the fact.',
    );
  }

  return {
    id: row.id,
    kind: row.kind,
    tradeDate,
    createdAt: row.created_at,
    quantity: row.quantity === null ? null : Quantity.fromDbString(row.quantity),
    grossAmount:
      row.gross_amount === null ? null : Money.fromDbString(row.gross_amount, instrumentCurrency),
    fees: Money.fromDbString(row.fees, instrumentCurrency),
    taxes: Money.fromDbString(row.taxes, instrumentCurrency),
    netAmountInstrument: Money.fromDbString(row.net_amount_instrument, instrumentCurrency),
    ratioNum: row.ratio_num,
    ratioDen: row.ratio_den,
    originalAcquiredOn: row.original_acquired_on === null ? null : acquiredOn,
    fxInstrumentToBase: selection.value.rate,
  };
}

function toDomainError(error: ReplayError, symbol: string): DomainError {
  if (error.kind === 'oversell') {
    return insufficientData(
      'oversell',
      `You are selling ${qToDbString(error.shortBy)} more units of ${symbol} than are held on ` +
        `${error.tradeDate} — ${qToDbString(error.held)} are held as of that date. ` +
        'Check for a missing purchase, bonus or split.',
    );
  }
  return invariantViolation(
    'I-19',
    `This corporate action would reduce a ${symbol} lot opened on ${error.lotOpenedOn} to zero units ` +
      'while it still carries cost. Record the residual units as a sale first.',
  );
}

export { type Rate };
