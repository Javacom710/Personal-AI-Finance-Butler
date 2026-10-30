import 'server-only';

/**
 * Manual assets and their valuation series
 * ([FINANCIAL-DOMAIN.md §9.4](../../../docs/FINANCIAL-DOMAIN.md#94-asset-and-liability-lifecycle)).
 *
 * Anything of value that is not an account balance and not an instrument:
 * property, a vehicle, physical gold, a collectible, a receivable.
 *
 * **Valuations are a time series, not a field.** There is no `revalue` that
 * updates a row — revaluing inserts, and the value in force at a date is the
 * greatest `as_of <= date`. This is the same rule as balances, for the same
 * reason: updating in place retroactively rewrites every historical net worth
 * derived from it.
 *
 * **Disposal sets a date, not a flag** (ADR-26). `is_active` follows for the UI
 * and is read by no calculation; an asset sold today must still appear in last
 * year's figure.
 */

import { and, asc, desc, eq, sql } from 'drizzle-orm';

import { isoDate, type IsoDate } from '../../lib/date';
import { currency, Money, toDbString, type CurrencyCode } from '../../lib/decimal/money';
import {
  createManualAssetSchema,
  disposeAssetSchema,
  revalueAssetSchema,
  updateManualAssetSchema,
  type CreateManualAssetInput,
} from '../../lib/schemas/networth';
import { conflict, err, notFound, ok, validationFailed, type DomainError, type Result } from '../../lib/result';
import { assetValuations, manualAssets } from '../db/schema';
import type { ReadCtx, WriteCtx } from './_ctx';
import { requireOwnership } from './_guards';
import { fieldErrors } from './_validation';

export type ManualAssetKind =
  | 'property'
  | 'vehicle'
  | 'gold_physical'
  | 'collectible'
  | 'receivable'
  | 'other';

export interface ValuationView {
  readonly id: string;
  readonly asOf: IsoDate;
  readonly value: Money;
  readonly source: string;
  readonly note: string | null;
}

export interface ManualAssetView {
  readonly id: string;
  readonly name: string;
  readonly kind: ManualAssetKind;
  readonly currency: CurrencyCode;
  readonly acquiredOn: IsoDate | null;
  readonly acquisitionCost: Money | null;
  readonly disposedOn: IsoDate | null;
  readonly isActive: boolean;
  readonly notes: string | null;
  /** The valuation in force **today**. `null` when the asset has none yet. */
  readonly currentValue: Money | null;
  readonly currentValueOn: IsoDate | null;
  readonly valuationCount: number;
}

interface AssetRow {
  id: string;
  userId: string;
  name: string;
  kind: ManualAssetKind;
  currencyCode: string;
  acquiredOn: string | null;
  acquisitionCost: string | null;
  disposedOn: string | null;
  isActive: boolean;
  notes: string | null;
}

// -------------------------------------------------------------------- queries

export interface ListAssetsOptions {
  /** Include assets disposed on or before today. Historical reads never filter. */
  readonly includeDisposed?: boolean;
}

export async function listManualAssets(
  ctx: ReadCtx,
  options: ListAssetsOptions = {},
): Promise<ManualAssetView[]> {
  const rows = (await ctx.db
    .select()
    .from(manualAssets)
    .where(eq(manualAssets.userId, ctx.userId))
    .orderBy(asc(manualAssets.name))) as AssetRow[];

  const visible = options.includeDisposed
    ? rows
    : rows.filter((r) => r.disposedOn === null || r.disposedOn > ctx.today);

  if (visible.length === 0) return [];

  const latest = await latestValuations(ctx, ctx.today);
  return visible.map((row) => toAssetView(row, latest.get(row.id)));
}

export async function getManualAsset(
  ctx: ReadCtx,
  id: string,
): Promise<Result<{ asset: ManualAssetView; valuations: ValuationView[] }, DomainError>> {
  const [row] = (await ctx.db
    .select()
    .from(manualAssets)
    .where(eq(manualAssets.id, id))
    .limit(1)) as AssetRow[];

  const owned = requireOwnership(row, ctx.userId, 'manual asset', id);
  if (!owned.ok) return owned;

  const assetCurrency = currency(owned.value.currencyCode.trim());
  const series = await ctx.db
    .select()
    .from(assetValuations)
    .where(and(eq(assetValuations.userId, ctx.userId), eq(assetValuations.assetId, id)))
    .orderBy(desc(assetValuations.asOf));

  const valuations: ValuationView[] = series.map((v) => ({
    id: v.id,
    asOf: isoDate(v.asOf),
    value: Money.fromDbString(v.value, assetCurrency),
    source: v.source,
    note: v.note,
  }));

  const inForceToday = valuations.find((v) => v.asOf <= ctx.today) ?? null;

  return ok({
    asset: toAssetView(owned.value, inForceToday === null ? undefined : { value: inForceToday.value, asOf: inForceToday.asOf, count: valuations.length }),
    valuations,
  });
}

interface LatestValuation {
  readonly value: Money;
  readonly asOf: IsoDate;
  readonly count: number;
}

/**
 * The valuation in force at `asOf` for every asset, in one pass.
 *
 * `DISTINCT ON` over the descending index — the greatest `as_of <= asOf` per
 * asset, which is `valuationInForce` for the whole set without a query per row.
 */
async function latestValuations(ctx: ReadCtx, asOf: IsoDate): Promise<Map<string, LatestValuation>> {
  const { rows } = await ctx.db.execute<{
    asset_id: string;
    value: string;
    as_of: string;
    currency_code: string;
    n: string;
  }>(sql`
    select distinct on (v.asset_id)
           v.asset_id::text as asset_id,
           v.value::text    as value,
           v.as_of::text    as as_of,
           a.currency_code  as currency_code,
           (select count(*) from ${assetValuations} c where c.asset_id = v.asset_id)::text as n
      from ${assetValuations} v
      join ${manualAssets} a on a.id = v.asset_id
     where v.user_id = ${ctx.userId} and v.as_of <= ${asOf}
     order by v.asset_id, v.as_of desc
  `);

  return new Map(
    rows.map((r) => [
      r.asset_id,
      {
        value: Money.fromDbString(r.value, currency(r.currency_code.trim())),
        asOf: isoDate(r.as_of),
        count: Number(r.n),
      },
    ]),
  );
}

function toAssetView(row: AssetRow, latest: LatestValuation | undefined): ManualAssetView {
  const assetCurrency = currency(row.currencyCode.trim());
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    currency: assetCurrency,
    acquiredOn: row.acquiredOn === null ? null : isoDate(row.acquiredOn),
    acquisitionCost:
      row.acquisitionCost === null ? null : Money.fromDbString(row.acquisitionCost, assetCurrency),
    disposedOn: row.disposedOn === null ? null : isoDate(row.disposedOn),
    isActive: row.isActive,
    notes: row.notes,
    currentValue: latest?.value ?? null,
    currentValueOn: latest?.asOf ?? null,
    valuationCount: latest?.count ?? 0,
  };
}

// ------------------------------------------------------------------- commands

export async function createManualAsset(
  ctx: WriteCtx,
  raw: unknown,
): Promise<Result<ManualAssetView, DomainError>> {
  const parsed = createManualAssetSchema.safeParse(raw);
  if (!parsed.success) return err(fieldErrors(parsed.error));
  const input: CreateManualAssetInput = parsed.data;

  const assetCurrency = currency(input.currencyCode);
  const value = Money.parseUserInput(input.value, assetCurrency);
  if (!value.ok) return err(validationFailed({ value: [value.error.message] }));

  let acquisitionCost: Money | null = null;
  if (input.acquisitionCost !== undefined) {
    const parsedCost = Money.parseUserInput(input.acquisitionCost, assetCurrency);
    if (!parsedCost.ok) return err(validationFailed({ acquisitionCost: [parsedCost.error.message] }));
    acquisitionCost = parsedCost.value;
  }

  const duplicate = await findAssetByName(ctx, input.name);
  if (duplicate) return err(conflict(`An asset named "${input.name}" already exists.`));

  const [inserted] = await ctx.tx
    .insert(manualAssets)
    .values({
      userId: ctx.userId,
      name: input.name,
      kind: input.kind,
      currencyCode: assetCurrency,
      acquiredOn: input.acquiredOn ?? null,
      acquisitionCost: acquisitionCost === null ? null : toDbString(acquisitionCost),
      notes: input.notes ?? null,
    })
    .returning();

  if (inserted === undefined) throw new Error('Insert of a manual asset returned no row.');

  // Both required: an asset with no valuation is *eligible but unvalued*, which
  // is excluded and named from every figure rather than counted as zero.
  await ctx.tx.insert(assetValuations).values({
    userId: ctx.userId,
    assetId: inserted.id,
    asOf: input.valuedOn ?? input.acquiredOn ?? ctx.today,
    value: toDbString(value.value),
    source: 'manual',
  });

  await ctx.audit.record({
    actor: 'user',
    action: 'manual_asset.create',
    entityType: 'manual_asset',
    entityId: inserted.id,
    after: inserted,
  });

  const view = await getManualAsset(ctx, inserted.id);
  return view.ok ? ok(view.value.asset) : view;
}

export async function updateManualAsset(
  ctx: WriteCtx,
  id: string,
  raw: unknown,
): Promise<Result<ManualAssetView, DomainError>> {
  const parsed = updateManualAssetSchema.safeParse(raw);
  if (!parsed.success) return err(fieldErrors(parsed.error));
  const input = parsed.data;

  const [existing] = (await ctx.tx
    .select()
    .from(manualAssets)
    .where(eq(manualAssets.id, id))
    .limit(1)) as AssetRow[];
  const owned = requireOwnership(existing, ctx.userId, 'manual asset', id);
  if (!owned.ok) return owned;

  const assetCurrency = currency(owned.value.currencyCode.trim());
  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if (input.name !== undefined && input.name !== owned.value.name) {
    const duplicate = await findAssetByName(ctx, input.name);
    if (duplicate) return err(conflict(`An asset named "${input.name}" already exists.`));
    patch['name'] = input.name;
  }
  if (input.kind !== undefined) patch['kind'] = input.kind;
  if (input.acquiredOn !== undefined) patch['acquiredOn'] = input.acquiredOn || null;
  if (input.notes !== undefined) patch['notes'] = input.notes || null;
  if (input.acquisitionCost !== undefined) {
    if (input.acquisitionCost === null || input.acquisitionCost === '') {
      patch['acquisitionCost'] = null;
    } else {
      const cost = Money.parseUserInput(input.acquisitionCost, assetCurrency);
      if (!cost.ok) return err(validationFailed({ acquisitionCost: [cost.error.message] }));
      patch['acquisitionCost'] = toDbString(cost.value);
    }
  }

  // The currency is not editable: every valuation row is denominated in it, so
  // changing it would silently reinterpret the whole series.
  const [updated] = await ctx.tx.update(manualAssets).set(patch).where(eq(manualAssets.id, id)).returning();
  if (updated === undefined) throw new Error('Update of a manual asset returned no row.');

  await ctx.audit.record({
    actor: 'user',
    action: 'manual_asset.update',
    entityType: 'manual_asset',
    entityId: id,
    before: owned.value,
    after: updated,
  });

  const view = await getManualAsset(ctx, id);
  return view.ok ? ok(view.value.asset) : view;
}

/** Record a new valuation. **Never updates an existing row.** */
export async function revalueAsset(
  ctx: WriteCtx,
  raw: unknown,
): Promise<Result<ValuationView, DomainError>> {
  const parsed = revalueAssetSchema.safeParse(raw);
  if (!parsed.success) return err(fieldErrors(parsed.error));
  const input = parsed.data;

  const [existing] = (await ctx.tx
    .select()
    .from(manualAssets)
    .where(eq(manualAssets.id, input.assetId))
    .limit(1)) as AssetRow[];
  const owned = requireOwnership(existing, ctx.userId, 'manual asset', input.assetId);
  if (!owned.ok) return owned;

  const assetCurrency = currency(owned.value.currencyCode.trim());
  const value = Money.parseUserInput(input.value, assetCurrency);
  if (!value.ok) return err(validationFailed({ value: [value.error.message] }));

  if (owned.value.acquiredOn !== null && input.asOf < owned.value.acquiredOn) {
    return err(
      validationFailed({ asOf: ['An asset cannot be valued before it was acquired.'] }),
    );
  }

  // Checked before the insert rather than caught after it: a constraint
  // violation aborts the whole Postgres transaction, and nothing translates
  // database errors (R-4).
  const [clash] = await ctx.tx
    .select({ id: assetValuations.id })
    .from(assetValuations)
    .where(and(eq(assetValuations.assetId, input.assetId), eq(assetValuations.asOf, input.asOf)))
    .limit(1);
  if (clash) {
    return err(
      conflict(
        `${owned.value.name} already has a valuation dated ${input.asOf}. ` +
          'Delete that one first — a valuation is a record, not a field to overwrite.',
      ),
    );
  }

  const [inserted] = await ctx.tx
    .insert(assetValuations)
    .values({
      userId: ctx.userId,
      assetId: input.assetId,
      asOf: input.asOf,
      value: toDbString(value.value),
      source: 'manual',
      note: input.note ?? null,
    })
    .returning();

  if (inserted === undefined) throw new Error('Insert of an asset valuation returned no row.');

  await ctx.audit.record({
    actor: 'user',
    action: 'manual_asset.revalue',
    entityType: 'manual_asset',
    entityId: input.assetId,
    after: inserted,
  });

  return ok({
    id: inserted.id,
    asOf: isoDate(inserted.asOf),
    value: Money.fromDbString(inserted.value, assetCurrency),
    source: inserted.source,
    note: inserted.note,
  });
}

/**
 * Dispose of an asset.
 *
 * Sets `disposed_on`, which is what every calculation reads, and `is_active`
 * for the UI. The asset stops contributing from that date; every earlier figure
 * is unchanged. **The sale proceeds are recorded separately** as an ordinary
 * receipt into an account — this command moves no money, because a manual asset
 * has no ledger.
 */
export async function disposeAsset(
  ctx: WriteCtx,
  raw: unknown,
): Promise<Result<ManualAssetView, DomainError>> {
  const parsed = disposeAssetSchema.safeParse(raw);
  if (!parsed.success) return err(fieldErrors(parsed.error));
  const input = parsed.data;

  const [existing] = (await ctx.tx
    .select()
    .from(manualAssets)
    .where(eq(manualAssets.id, input.assetId))
    .limit(1)) as AssetRow[];
  const owned = requireOwnership(existing, ctx.userId, 'manual asset', input.assetId);
  if (!owned.ok) return owned;

  if (owned.value.acquiredOn !== null && input.disposedOn < owned.value.acquiredOn) {
    return err(
      validationFailed({ disposedOn: ['An asset cannot be disposed of before it was acquired.'] }),
    );
  }

  await ctx.tx
    .update(manualAssets)
    .set({ disposedOn: input.disposedOn, isActive: false, updatedAt: new Date() })
    .where(eq(manualAssets.id, input.assetId));

  await ctx.audit.record({
    actor: 'user',
    action: 'manual_asset.dispose',
    entityType: 'manual_asset',
    entityId: input.assetId,
    before: { disposedOn: owned.value.disposedOn, isActive: owned.value.isActive },
    after: { disposedOn: input.disposedOn, isActive: false },
  });

  const view = await getManualAsset(ctx, input.assetId);
  return view.ok ? ok(view.value.asset) : view;
}

/**
 * Delete an asset that carries no valuation history beyond its first.
 *
 * Deleting valuation history destroys past net-worth figures, so an asset that
 * has been revalued is disposed of rather than deleted.
 */
export async function deleteManualAsset(
  ctx: WriteCtx,
  id: string,
): Promise<Result<void, DomainError>> {
  const [existing] = (await ctx.tx
    .select()
    .from(manualAssets)
    .where(eq(manualAssets.id, id))
    .limit(1)) as AssetRow[];
  const owned = requireOwnership(existing, ctx.userId, 'manual asset', id);
  if (!owned.ok) return owned;

  const [{ n } = { n: 0 }] = await ctx.tx
    .select({ n: sql<number>`count(*)::int` })
    .from(assetValuations)
    .where(eq(assetValuations.assetId, id));

  if (n > 1) {
    return err(
      conflict(
        `${owned.value.name} has ${n} valuations. Deleting them would rewrite past net-worth ` +
          'figures — dispose of it instead, which keeps the history and stops it counting.',
      ),
    );
  }

  await ctx.tx.delete(manualAssets).where(eq(manualAssets.id, id));
  await ctx.audit.record({
    actor: 'user',
    action: 'manual_asset.delete',
    entityType: 'manual_asset',
    entityId: id,
    before: owned.value,
  });

  return ok(undefined);
}

/** Remove one valuation. The asset keeps the rest of its series. */
export async function deleteValuation(
  ctx: WriteCtx,
  valuationId: string,
): Promise<Result<void, DomainError>> {
  const [row] = await ctx.tx
    .select()
    .from(assetValuations)
    .where(eq(assetValuations.id, valuationId))
    .limit(1);

  if (!row) return err(notFound('asset valuation', valuationId));
  if (row.userId !== ctx.userId) return err(notFound('asset valuation', valuationId));

  const [{ n } = { n: 0 }] = await ctx.tx
    .select({ n: sql<number>`count(*)::int` })
    .from(assetValuations)
    .where(eq(assetValuations.assetId, row.assetId));

  if (n <= 1) {
    return err(
      conflict(
        'An asset needs at least one valuation. Delete the asset itself, or record a ' +
          'replacement valuation first.',
      ),
    );
  }

  await ctx.tx.delete(assetValuations).where(eq(assetValuations.id, valuationId));
  await ctx.audit.record({
    actor: 'user',
    action: 'manual_asset.valuation_delete',
    entityType: 'manual_asset',
    entityId: row.assetId,
    before: row,
  });

  return ok(undefined);
}

// -------------------------------------------------------------------- helpers

async function findAssetByName(ctx: WriteCtx, name: string): Promise<string | null> {
  const [row] = await ctx.tx
    .select({ id: manualAssets.id })
    .from(manualAssets)
    .where(and(eq(manualAssets.userId, ctx.userId), eq(manualAssets.name, name)))
    .limit(1);
  return row?.id ?? null;
}
