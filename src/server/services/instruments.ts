import 'server-only';

/**
 * Instruments — *what* is held, independent of *how much*
 * ([INVESTMENT-DOMAIN.md §1](../../../docs/INVESTMENT-DOMAIN.md#1-instruments)).
 *
 * Deliberately not coupled to any broker, exchange or provider: adding an asset
 * class is a migration on one enum plus an allocation label, because the lot
 * engine is class-agnostic.
 *
 * The one operation here that is not ordinary CRUD is **changing
 * `cost_basis_method`**, which rewrites derived history rather than mutating a
 * setting. It triggers a full rebuild of every position holding the instrument,
 * inside the same transaction, and is recorded in `audit_log`.
 */

import { and, asc, eq, sql } from 'drizzle-orm';

import { currency, type CurrencyCode } from '../../lib/decimal/money';
import {
  createInstrumentSchema,
  updateInstrumentSchema,
  type CreateInstrumentInput,
  type UpdateInstrumentInput,
} from '../../lib/schemas/investments';
import { conflict, err, ok, validationFailed, type DomainError, type Result } from '../../lib/result';
import type { AssetClass } from '../domain/pricing/valuation';
import type { CostBasisMethod } from '../domain/lots/fifo';
import { instruments, investmentTransactions, positions } from '../db/schema';
import type { ReadCtx, WriteCtx } from './_ctx';
import { bumpInvestmentLedgerVersion } from './_ctx';
import { requireOwnership, requireUnreferenced } from './_guards';
import { fieldErrors } from './_validation';
import { rebuildPositionsForInstrument } from './positions';

export interface InstrumentView {
  readonly id: string;
  readonly symbol: string;
  readonly exchange: string | null;
  readonly isin: string | null;
  readonly name: string;
  readonly assetClass: AssetClass;
  readonly currency: CurrencyCode;
  readonly country: string | null;
  readonly priceProvider: string | null;
  readonly costBasisMethod: CostBasisMethod;
  readonly isActive: boolean;
  /** How many ledger rows reference it — the delete guard, and useful on screen. */
  readonly transactionCount: number;
}

interface InstrumentRow {
  id: string;
  userId: string;
  symbol: string;
  exchange: string | null;
  isin: string | null;
  name: string;
  assetClass: AssetClass;
  currencyCode: string;
  country: string | null;
  priceProvider: string | null;
  costBasisMethod: CostBasisMethod;
  isActive: boolean;
}

// ----------------------------------------------------------------------- reads

export async function listInstruments(
  ctx: ReadCtx,
  options: { readonly includeInactive?: boolean } = {},
): Promise<InstrumentView[]> {
  const rows = (await ctx.db
    .select()
    .from(instruments)
    .where(
      options.includeInactive
        ? eq(instruments.userId, ctx.userId)
        : and(eq(instruments.userId, ctx.userId), eq(instruments.isActive, true)),
    )
    .orderBy(asc(instruments.symbol))) as InstrumentRow[];

  if (rows.length === 0) return [];

  const counts = await transactionCounts(ctx);
  return rows.map((row) => toView(row, counts.get(row.id) ?? 0));
}

export async function getInstrument(
  ctx: ReadCtx,
  id: string,
): Promise<Result<InstrumentView, DomainError>> {
  const [row] = (await ctx.db
    .select()
    .from(instruments)
    .where(eq(instruments.id, id))
    .limit(1)) as InstrumentRow[];

  const owned = requireOwnership(row, ctx.userId, 'instrument', id);
  if (!owned.ok) return owned;

  const counts = await transactionCounts(ctx, id);
  return ok(toView(owned.value, counts.get(id) ?? 0));
}

async function transactionCounts(ctx: ReadCtx, instrumentId?: string): Promise<Map<string, number>> {
  const result = await ctx.db.execute<{ instrument_id: string; n: string }>(sql`
    select instrument_id, count(*)::text as n
      from ${investmentTransactions}
     where user_id = ${ctx.userId} and instrument_id is not null
       ${instrumentId === undefined ? sql`` : sql`and instrument_id = ${instrumentId}`}
     group by instrument_id
  `);
  return new Map(result.rows.map((row) => [row.instrument_id, Number(row.n)]));
}

function toView(row: InstrumentRow, transactionCount: number): InstrumentView {
  return {
    id: row.id,
    symbol: row.symbol,
    exchange: row.exchange,
    isin: row.isin,
    name: row.name,
    assetClass: row.assetClass,
    currency: currency(row.currencyCode.trim()),
    country: row.country,
    priceProvider: row.priceProvider,
    costBasisMethod: row.costBasisMethod,
    isActive: row.isActive,
    transactionCount,
  };
}

// -------------------------------------------------------------------- commands

export async function createInstrument(
  ctx: WriteCtx,
  raw: unknown,
): Promise<Result<InstrumentView, DomainError>> {
  const parsed = createInstrumentSchema.safeParse(raw);
  if (!parsed.success) return err(fieldErrors(parsed.error));
  const input: CreateInstrumentInput = parsed.data;

  if (input.costBasisMethod !== 'fifo') {
    // Rejected rather than accepted-and-ignored: a portfolio quietly valued by
    // a method the engine does not implement is worse than one that refuses.
    return err(
      validationFailed({
        costBasisMethod: ['Only FIFO is implemented. Average and specific-identification are not.'],
      }),
    );
  }

  const existing = await ctx.tx
    .select({ id: instruments.id })
    .from(instruments)
    .where(
      and(
        eq(instruments.userId, ctx.userId),
        eq(instruments.symbol, input.symbol),
        input.exchange === undefined
          ? sql`${instruments.exchange} is null`
          : eq(instruments.exchange, input.exchange),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return err(
      conflict(
        `${input.symbol}${input.exchange === undefined ? '' : ` on ${input.exchange}`} already exists.`,
      ),
    );
  }

  const [inserted] = await ctx.tx
    .insert(instruments)
    .values({
      userId: ctx.userId,
      symbol: input.symbol,
      exchange: input.exchange ?? null,
      isin: input.isin ?? null,
      name: input.name,
      assetClass: input.assetClass,
      currencyCode: input.currencyCode,
      country: input.country ?? null,
      costBasisMethod: input.costBasisMethod,
    })
    .returning({ id: instruments.id });

  if (!inserted) throw new Error('Insert of an instrument returned no row.');

  await ctx.audit.record({
    actor: 'user',
    action: 'instrument.create',
    entityType: 'instrument',
    entityId: inserted.id,
    after: { symbol: input.symbol, exchange: input.exchange ?? null, currency: input.currencyCode },
  });

  return getInstrument(ctx, inserted.id);
}

export async function updateInstrument(
  ctx: WriteCtx,
  id: string,
  raw: unknown,
): Promise<Result<InstrumentView, DomainError>> {
  const parsed = updateInstrumentSchema.safeParse(raw);
  if (!parsed.success) return err(fieldErrors(parsed.error));
  const input: UpdateInstrumentInput = parsed.data;

  const [existing] = (await ctx.tx
    .select()
    .from(instruments)
    .where(eq(instruments.id, id))
    .limit(1)) as InstrumentRow[];

  const owned = requireOwnership(existing, ctx.userId, 'instrument', id);
  if (!owned.ok) return owned;

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) patch['name'] = input.name;
  if (input.isin !== undefined) patch['isin'] = input.isin;
  if (input.country !== undefined) patch['country'] = input.country;
  if (input.assetClass !== undefined) patch['assetClass'] = input.assetClass;
  if (input.isActive !== undefined) patch['isActive'] = input.isActive;

  const methodChanged =
    input.costBasisMethod !== undefined && input.costBasisMethod !== owned.value.costBasisMethod;

  if (input.costBasisMethod !== undefined) {
    if (input.costBasisMethod !== 'fifo') {
      return err(
        validationFailed({
          costBasisMethod: ['Only FIFO is implemented. Average and specific-identification are not.'],
        }),
      );
    }
    patch['costBasisMethod'] = input.costBasisMethod;
  }

  // Neither `symbol`, `exchange` nor `currency_code` is editable. All three are
  // identity, and changing the currency would silently reinterpret every
  // historical price, gross amount, fee and tax on the instrument.
  await ctx.tx.update(instruments).set(patch).where(eq(instruments.id, id));

  await ctx.audit.record({
    actor: 'user',
    action: 'instrument.update',
    entityType: 'instrument',
    entityId: id,
    before: owned.value,
    after: patch,
  });

  if (methodChanged) {
    // A method change rewrites derived history: realised P&L on already-settled
    // disposals moves. Every position holding this instrument is rebuilt inside
    // this transaction, so there is no window in which they disagree.
    const version = await bumpInvestmentLedgerVersion(ctx);
    const rebuilt = await rebuildPositionsForInstrument(ctx, id, version);
    if (!rebuilt.ok) return rebuilt;
  }

  return getInstrument(ctx, id);
}

/**
 * Delete an instrument that has never been traded.
 *
 * One with ledger history cannot be deleted — `ON DELETE RESTRICT` on
 * `investment_transactions.instrument_id` enforces it, and this guard reports it
 * as a sentence rather than as a foreign-key error. Deactivate it instead: an
 * inactive instrument keeps its history and leaves the pickers.
 */
export async function deleteInstrument(ctx: WriteCtx, id: string): Promise<Result<void, DomainError>> {
  const [existing] = (await ctx.tx
    .select()
    .from(instruments)
    .where(eq(instruments.id, id))
    .limit(1)) as InstrumentRow[];

  const owned = requireOwnership(existing, ctx.userId, 'instrument', id);
  if (!owned.ok) return owned;

  const [{ n } = { n: '0' }] = (
    await ctx.tx.execute<{ n: string }>(sql`
      select count(*)::text as n from ${investmentTransactions} where instrument_id = ${id}
    `)
  ).rows;

  const unreferenced = requireUnreferenced(
    Number(n),
    'instrument',
    'Deactivate it instead — its history stays and it leaves the pickers.',
  );
  if (!unreferenced.ok) return unreferenced;

  await ctx.tx.delete(positions).where(eq(positions.instrumentId, id));
  await ctx.tx.delete(instruments).where(eq(instruments.id, id));

  await ctx.audit.record({
    actor: 'user',
    action: 'instrument.delete',
    entityType: 'instrument',
    entityId: id,
    before: owned.value,
  });

  return ok(undefined);
}
