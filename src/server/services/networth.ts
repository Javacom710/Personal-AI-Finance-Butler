import 'server-only';

/**
 * Net Worth at Cost — the read path
 * ([NET-WORTH-DESIGN.md §9](../../../docs/NET-WORTH-DESIGN.md),
 * [ADR-23](../../../docs/DECISIONS.md), [ADR-24](../../../docs/DECISIONS.md)).
 *
 * ```
 * Server Component
 *   → netWorthAsOf(ctx, T)
 *       → repository        five set-based fetches: accounts + movements, lots +
 *                           disposals, valuations, liability balances (FX is
 *                           already loaded on ctx)
 *       → DOMAIN (pure)     eligibility → components → compose → reconcile
 *   → typed result incl. coverage, exclusions and the contributions map
 * ```
 *
 * **This service exports no function taking a `WriteCtx`** (invariant I-32). Net
 * worth is an aggregation, not a ledger: it opens no transaction, writes no row,
 * and has nothing to mutate with. That is what makes "the AI cannot change net
 * worth" a type error rather than a policy.
 *
 * **Nothing is cached and nothing is stored** (ADR-24). A month-end series is
 * the same five fetches followed by one fold per date — not one computation per
 * point — so correcting a transaction dated last March leaves every figure from
 * March onward right on the next read, with no snapshot to invalidate.
 *
 * Every figure it returns comes from `src/server/domain/`, and every input comes
 * from a service that already owns it: `deriveBalance()` for balances,
 * `tax_lots`/`lot_disposals` for investment cost, `ctx.fx` for rates. Nothing is
 * reimplemented here.
 */

import { eq, sql } from 'drizzle-orm';

import { compareDates, isoDate, type IsoDate } from '../../lib/date';
import {
  add,
  currency,
  Money,
  mulRate,
  neg,
  sub,
  sum,
  type CurrencyCode,
  type Money as MoneyValue,
} from '../../lib/decimal/money';
import { Rate } from '../../lib/decimal/rate';
import { ok, type DomainError, type Result } from '../../lib/result';
import {
  accountEligible,
  inForce,
  lotEligible,
  manualAssetEligible,
} from '../domain/networth/eligibility';
import {
  compose,
  type ComponentInput,
  type NetWorthResult,
} from '../domain/networth/compose';
import type { NetWorthGroup } from '../domain/networth/keys';
import { reconcile, type Reconciliation } from '../domain/networth/reconcile';
import {
  bridge,
  noFlows,
  type BridgeFlows,
  type NetWorthBridge,
} from '../domain/networth/bridge';
import { openingContribution, type AccountKind } from '../domain/ledger/balance';
import {
  accounts,
  assetValuations,
  investmentTransactions,
  liabilities,
  liabilityBalances,
  lotDisposals,
  manualAssets,
  taxLots,
  transactionEntries,
  transactions,
} from '../db/schema';
import type { ReadCtx } from './_ctx';

export type { NetWorthResult } from '../domain/networth/compose';
export type { Reconciliation } from '../domain/networth/reconcile';
export type { NetWorthBridge } from '../domain/networth/bridge';

// ------------------------------------------------------------------ raw shapes

interface RawAccount {
  readonly id: string;
  readonly name: string;
  readonly kind: AccountKind;
  readonly currency: CurrencyCode;
  readonly openingBalance: MoneyValue;
  readonly openingDate: IsoDate;
}

/** One dated cash movement, in the account's own currency. */
interface RawMovement {
  readonly accountId: string;
  readonly on: IsoDate;
  readonly amount: MoneyValue;
}

interface RawLot {
  readonly accountId: string;
  readonly accountName: string;
  readonly instrumentId: string;
  readonly symbol: string;
  readonly instrumentCurrency: CurrencyCode;
  readonly openedOn: IsoDate;
  /** `cost_total × fx_rate_to_base` — already base currency, at the acquisition rate. */
  readonly baseCostTotal: MoneyValue;
  readonly lotId: string;
}

interface RawDisposal {
  readonly lotId: string;
  readonly closedOn: IsoDate;
  /** `cost_consumed × lot.fx_rate_to_base` — the same acquisition rate as the lot. */
  readonly baseCostConsumed: MoneyValue;
}

interface RawAsset {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly currency: CurrencyCode;
  readonly acquiredOn: IsoDate | null;
  readonly disposedOn: IsoDate | null;
  readonly valuations: readonly { readonly asOf: IsoDate; readonly value: MoneyValue }[];
}

interface RawLiability {
  readonly id: string;
  readonly name: string;
  readonly currency: CurrencyCode;
  /** `null` ⟹ scheduled, and the series below is authoritative. */
  readonly linkedAccountId: string | null;
  readonly balances: readonly { readonly asOf: IsoDate; readonly outstanding: MoneyValue }[];
}

/** Everything net worth needs, fetched once regardless of how many dates follow. */
interface NetWorthSources {
  readonly accounts: readonly RawAccount[];
  readonly movements: readonly RawMovement[];
  readonly lots: readonly RawLot[];
  readonly disposals: readonly RawDisposal[];
  readonly assets: readonly RawAsset[];
  readonly liabilities: readonly RawLiability[];
}

// ----------------------------------------------------------------- the fetches

/**
 * Five set-based fetches. **No date bound is applied here** — the bound is a
 * pure predicate applied per point, which is what lets a 60-point series cost
 * the same five queries as a single date (ADR-24).
 */
async function loadSources(ctx: ReadCtx): Promise<NetWorthSources> {
  const [accountRows, movementRows, lotRows, disposalRows, assetRows, liabilityRows] =
    await Promise.all([
      ctx.db
        .select({
          id: accounts.id,
          name: accounts.name,
          kind: accounts.kind,
          currencyCode: accounts.currencyCode,
          openingBalance: accounts.openingBalance,
          openingDate: accounts.openingDate,
        })
        .from(accounts)
        // No `is_active` filter, deliberately and permanently: an account closed
        // this morning must still appear in last year's figure (I-26).
        .where(eq(accounts.userId, ctx.userId)),

      // Both ledgers, unioned. Every rupee of movement is in exactly one (I-13),
      // and `deriveBalance()` sums both unconditionally.
      ctx.db.execute<{ account_id: string; on: string; amount: string; currency_code: string }>(sql`
        select e.account_id::text as account_id, t.booked_on::text as on,
               e.amount::text as amount, e.currency_code as currency_code
          from ${transactionEntries} e
          join ${transactions} t on t.id = e.transaction_id
         where t.user_id = ${ctx.userId}
        union all
        select i.account_id::text, i.trade_date::text, i.net_amount::text, a.currency_code
          from ${investmentTransactions} i
          join ${accounts} a on a.id = i.account_id
         where i.user_id = ${ctx.userId}
      `),

      ctx.db.execute<{
        lot_id: string;
        account_id: string;
        account_name: string;
        instrument_id: string;
        symbol: string;
        instrument_currency: string;
        opened_on: string;
        base_cost_total: string;
      }>(sql`
        select l.id::text            as lot_id,
               l.account_id::text    as account_id,
               a.name                as account_name,
               l.instrument_id::text as instrument_id,
               ins.symbol            as symbol,
               ins.currency_code     as instrument_currency,
               l.opened_on::text     as opened_on,
               round(l.cost_total * l.fx_rate_to_base, 4)::text as base_cost_total
          from ${taxLots} l
          join accounts a on a.id = l.account_id
          join instruments ins on ins.id = l.instrument_id
         where l.user_id = ${ctx.userId}
      `),

      // Valued at the LOT's acquisition rate, not the disposal's: this figure
      // reverses basis out of the position, and basis was capitalised at
      // acquisition. Using the disposal rate here would leave a currency
      // movement inside the cost block, where INVESTMENT-DOMAIN.md §6.4 says it
      // must not be.
      ctx.db.execute<{ lot_id: string; closed_on: string; base_cost_consumed: string }>(sql`
        select d.lot_id::text   as lot_id,
               d.closed_on::text as closed_on,
               round(d.cost_consumed * l.fx_rate_to_base, 4)::text as base_cost_consumed
          from ${lotDisposals} d
          join ${taxLots} l on l.id = d.lot_id
         where d.user_id = ${ctx.userId}
      `),

      ctx.db.execute<{
        id: string;
        name: string;
        kind: string;
        currency_code: string;
        acquired_on: string | null;
        disposed_on: string | null;
        valuations: { as_of: string; value: string }[] | null;
      }>(sql`
        select m.id::text as id, m.name, m.kind::text as kind, m.currency_code,
               m.acquired_on::text as acquired_on, m.disposed_on::text as disposed_on,
               coalesce(
                 (select json_agg(json_build_object('as_of', v.as_of::text, 'value', v.value::text)
                                  order by v.as_of)
                    from ${assetValuations} v where v.asset_id = m.id),
                 '[]'::json
               ) as valuations
          from ${manualAssets} m
         where m.user_id = ${ctx.userId}
      `),

      ctx.db.execute<{
        id: string;
        name: string;
        currency_code: string;
        linked_account_id: string | null;
        balances: { as_of: string; outstanding: string }[] | null;
      }>(sql`
        select l.id::text as id, l.name, l.currency_code,
               l.linked_account_id::text as linked_account_id,
               coalesce(
                 (select json_agg(json_build_object('as_of', b.as_of::text,
                                                    'outstanding', b.outstanding::text)
                                  order by b.as_of)
                    from ${liabilityBalances} b where b.liability_id = l.id),
                 '[]'::json
               ) as balances
          from ${liabilities} l
         where l.user_id = ${ctx.userId}
      `),
    ]);

  const accountCurrency = new Map(
    accountRows.map((a) => [a.id, currency(a.currencyCode.trim())]),
  );

  return {
    accounts: accountRows.map((a) => {
      const c = accountCurrency.get(a.id)!;
      return {
        id: a.id,
        name: a.name,
        kind: a.kind as AccountKind,
        currency: c,
        openingBalance: Money.fromDbString(a.openingBalance, c),
        openingDate: isoDate(a.openingDate),
      };
    }),
    movements: movementRows.rows.map((m) => ({
      accountId: m.account_id,
      on: isoDate(m.on),
      amount: Money.fromDbString(m.amount, currency(m.currency_code.trim())),
    })),
    lots: lotRows.rows.map((l) => ({
      lotId: l.lot_id,
      accountId: l.account_id,
      accountName: l.account_name,
      instrumentId: l.instrument_id,
      symbol: l.symbol,
      instrumentCurrency: currency(l.instrument_currency.trim()),
      openedOn: isoDate(l.opened_on),
      baseCostTotal: Money.fromDbString(l.base_cost_total, ctx.base),
    })),
    disposals: disposalRows.rows.map((d) => ({
      lotId: d.lot_id,
      closedOn: isoDate(d.closed_on),
      baseCostConsumed: Money.fromDbString(d.base_cost_consumed, ctx.base),
    })),
    assets: assetRows.rows.map((a) => {
      const c = currency(a.currency_code.trim());
      return {
        id: a.id,
        name: a.name,
        kind: a.kind,
        currency: c,
        acquiredOn: a.acquired_on === null ? null : isoDate(a.acquired_on),
        disposedOn: a.disposed_on === null ? null : isoDate(a.disposed_on),
        valuations: (a.valuations ?? []).map((v) => ({
          asOf: isoDate(v.as_of),
          value: Money.fromDbString(v.value, c),
        })),
      };
    }),
    liabilities: liabilityRows.rows.map((l) => {
      const c = currency(l.currency_code.trim());
      return {
        id: l.id,
        name: l.name,
        currency: c,
        linkedAccountId: l.linked_account_id,
        balances: (l.balances ?? []).map((b) => ({
          asOf: isoDate(b.as_of),
          outstanding: Money.fromDbString(b.outstanding, c),
        })),
      };
    }),
  };
}

// ------------------------------------------------------------------- the fold

/**
 * Which display group an account's contribution belongs to, by kind and side.
 *
 * Both halves classify on the **side first**, because an account against its
 * expected sign is a different thing from the same account behaving normally:
 *
 * - a `bank` account in debit is an **overdraft**, not a card and not a loan;
 * - a `credit_card` or `loan` in credit is money the issuer owes back — an
 *   asset (ADR-25), but **not cash**. Grouping it under "Cash and bank" would
 *   file a receivable from a card issuer alongside a current account, which
 *   reads as spendable money. It goes under "Other assets", where the row's own
 *   name still says which card it is.
 */
function accountGroup(kind: AccountKind, isLiability: boolean): NetWorthGroup {
  if (isLiability) {
    if (kind === 'credit_card') return 'credit_card';
    if (kind === 'loan') return 'loans';
    return 'overdrawn_accounts';
  }
  if (kind === 'credit_card' || kind === 'loan') return 'other_assets';
  if (kind === 'brokerage') return 'brokerage_cash';
  if (kind === 'other') return 'other_assets';
  return 'cash';
}

const ASSET_KIND_GROUP: Record<string, NetWorthGroup> = {
  property: 'property',
  vehicle: 'vehicle',
  gold_physical: 'gold_physical',
  collectible: 'collectible',
  receivable: 'receivable',
  other: 'other_assets',
};

/**
 * Every eligible source at `asOf`, as `compose()` wants them.
 *
 * Pure over the fetched data plus `ctx.fx`, which is a synchronous in-memory
 * lookup — so this runs once per point of a series with no further I/O.
 */
function componentsAt(
  ctx: ReadCtx,
  sources: NetWorthSources,
  asOf: IsoDate,
): ComponentInput[] {
  const out: ComponentInput[] = [];
  const rateFor = (from: CurrencyCode) => {
    const selection = ctx.fx.rate(from, ctx.base, asOf);
    return selection.ok ? { rate: selection.value.rate, asOf: selection.value.asOf } : null;
  };

  // ---- accounts: opening (gated by opening_date) + both ledgers, bounded by date
  const movementsByAccount = new Map<string, MoneyValue[]>();
  for (const m of sources.movements) {
    if (compareDates(m.on, asOf) > 0) continue;
    const list = movementsByAccount.get(m.accountId);
    if (list) list.push(m.amount);
    else movementsByAccount.set(m.accountId, [m.amount]);
  }

  for (const account of sources.accounts) {
    // An account that did not exist at `asOf` is ABSENT, not zero — so it cannot
    // be confused with one that genuinely held nothing (ADR-26).
    if (!accountEligible(account.openingDate, asOf)) continue;

    const opening = openingContribution(account.openingBalance, account.openingDate, asOf);
    const balance = add(
      opening,
      sum(movementsByAccount.get(account.id) ?? [], account.currency),
    );
    const isLiability = balance.minor < 0n;

    out.push({
      key: { t: 'account', accountId: account.id },
      label: account.name,
      group: accountGroup(account.kind, isLiability),
      native: balance,
      sourceRef: { type: 'account', id: account.id },
      fx: rateFor(account.currency),
    });
  }

  // ---- investments at COST, as of the date
  //
  // Derived from the lot tables bounded by `opened_on` / `closed_on`, NEVER from
  // `positions`, which is today's cache and has no date bound (ADR-06). Exact
  // for three reasons: a split or bonus touches no money, FIFO's total order
  // gives replay a prefix property, and I-20 makes the subtraction residue-free.
  const consumedByLot = new Map<string, bigint>();
  for (const d of sources.disposals) {
    if (compareDates(d.closedOn, asOf) > 0) continue;
    consumedByLot.set(d.lotId, (consumedByLot.get(d.lotId) ?? 0n) + d.baseCostConsumed.minor);
  }

  interface PositionAccumulator {
    minor: bigint;
    accountName: string;
    symbol: string;
    instrumentCurrency: CurrencyCode;
  }
  const positions = new Map<string, PositionAccumulator>();

  for (const lot of sources.lots) {
    // `opened_on`, never `acquired_on` — a transfer_in carries the acquisition
    // date back, and using it would count the value in both accounts for the
    // whole intervening period (I-23).
    if (!lotEligible(lot.openedOn, asOf)) continue;

    const remaining = lot.baseCostTotal.minor - (consumedByLot.get(lot.lotId) ?? 0n);
    const k = `${lot.accountId}:${lot.instrumentId}`;
    const existing = positions.get(k);
    if (existing) existing.minor += remaining;
    else
      positions.set(k, {
        minor: remaining,
        accountName: lot.accountName,
        symbol: lot.symbol,
        instrumentCurrency: lot.instrumentCurrency,
      });
  }

  for (const [k, position] of positions) {
    const [accountId, instrumentId] = k.split(':') as [string, string];
    out.push({
      key: { t: 'position', accountId, instrumentId },
      label: `${position.symbol} · ${position.accountName}`,
      group: 'investments',
      // Already base: `tax_lots.fx_rate_to_base` was applied at acquisition and
      // is never revalued, so no conversion happens here (INVESTMENT-DOMAIN.md §6.4).
      native: Money.fromMinor(position.minor, ctx.base),
      sourceRef: { type: 'instrument', id: instrumentId },
      fx: { rate: Rate.one(), asOf },
      sourceCurrency: position.instrumentCurrency,
    });
  }

  // ---- manual assets
  for (const asset of sources.assets) {
    const startOn =
      asset.acquiredOn ??
      (asset.valuations.length > 0
        ? asset.valuations.reduce((a, b) => (compareDates(a.asOf, b.asOf) <= 0 ? a : b)).asOf
        : null);

    if (!manualAssetEligible({ startOn, disposedOn: asset.disposedOn }, asOf)) continue;

    const valuation = inForce(asset.valuations, asOf);
    const group = ASSET_KIND_GROUP[asset.kind] ?? 'other_assets';

    if (valuation === null) {
      // Eligible but unvalued at this date: EXCLUDED and named, never zero. A
      // flat contributing ₹0 to a headline figure is a materially wrong number
      // presented as a right one (FINANCIAL-DOMAIN.md §9.3).
      out.push({
        key: { t: 'asset', assetId: asset.id },
        label: asset.name,
        group,
        native: Money.zero(asset.currency),
        sourceRef: { type: 'manual_asset', id: asset.id },
        fx: null,
        unvalued: true,
      });
      continue;
    }

    out.push({
      key: { t: 'asset', assetId: asset.id },
      label: asset.name,
      group,
      native: valuation.value,
      sourceRef: { type: 'manual_asset', id: asset.id },
      fx: rateFor(asset.currency),
    });
  }

  // ---- liabilities
  for (const liability of sources.liabilities) {
    // A TRANSACTED liability contributes nothing: the linked account contributes,
    // by sign. This is the double-count guard (I-8), and it is a `continue`
    // rather than a zero so the row does not appear in the breakdown at all.
    if (liability.linkedAccountId !== null) continue;

    const balance = inForce(liability.balances, asOf);
    if (balance === null) continue; // the debt did not exist yet

    out.push({
      key: { t: 'liability', liabilityId: liability.id },
      label: liability.name,
      group: 'loans',
      // Stored as a non-negative magnitude; the SIGN is applied here, which is
      // what puts it on the liability side through the same `sideOfAmount` every
      // other component uses.
      native: neg(balance.outstanding),
      sourceRef: { type: 'liability', id: liability.id },
      fx: rateFor(liability.currency),
    });
  }

  return out;
}

// -------------------------------------------------------------------- queries

export interface NetWorthOptions {
  /** Defaults to today in the user's timezone. */
  readonly asOf?: IsoDate;
}

/** **Net Worth at Cost** on one date. */
export async function netWorthAsOf(
  ctx: ReadCtx,
  options: NetWorthOptions = {},
): Promise<Result<NetWorthResult, DomainError>> {
  const asOf = options.asOf ?? ctx.today;
  const sources = await loadSources(ctx);
  return ok(composeAt(ctx, sources, asOf));
}

function composeAt(ctx: ReadCtx, sources: NetWorthSources, asOf: IsoDate): NetWorthResult {
  return compose(componentsAt(ctx, sources, asOf), {
    asOf,
    base: ctx.base,
    basis: 'cost',
  });
}

export interface NetWorthPoint {
  readonly asOf: IsoDate;
  readonly result: NetWorthResult;
}

/**
 * A series over the given dates — **five fetches and one fold per point**, not
 * one computation per point.
 *
 * The last point of a series ending today is byte-identical to
 * `netWorthAsOf(today)` because both go through the same `composeAt`
 * (invariant I-29).
 */
export async function netWorthSeries(
  ctx: ReadCtx,
  dates: readonly IsoDate[],
): Promise<NetWorthPoint[]> {
  if (dates.length === 0) return [];
  const sources = await loadSources(ctx);
  return dates.map((asOf) => ({ asOf, result: composeAt(ctx, sources, asOf) }));
}

/** The reconciliation for one date: *"why is Net Worth at Cost ₹X?"* */
export async function netWorthReconciliation(
  ctx: ReadCtx,
  options: NetWorthOptions = {},
): Promise<Result<{ result: NetWorthResult; reconciliation: Reconciliation }, DomainError>> {
  const computed = await netWorthAsOf(ctx, options);
  if (!computed.ok) return computed;
  return ok({ result: computed.value, reconciliation: reconcile(computed.value) });
}

// --------------------------------------------------------------------- bridge

/**
 * The change bridge over `(from, to]`.
 *
 * Every flow below is fetched for the **half-open** period: a movement dated
 * exactly `from` is already inside the opening figure, so counting it again
 * would put it on both sides of the identity.
 */
export async function netWorthChange(
  ctx: ReadCtx,
  from: IsoDate,
  to: IsoDate,
): Promise<Result<NetWorthBridge, DomainError>> {
  const sources = await loadSources(ctx);
  const opening = composeAt(ctx, sources, from);
  const closing = composeAt(ctx, sources, to);
  const flows = await periodFlows(ctx, sources, from, to);
  return ok(bridge(opening, closing, flows));
}

async function periodFlows(
  ctx: ReadCtx,
  sources: NetWorthSources,
  from: IsoDate,
  to: IsoDate,
): Promise<BridgeFlows> {
  const base = ctx.base;

  const [cash, investment, realized] = await Promise.all([
    // Money-ledger income and expenses, in base. Transfers are excluded by the
    // kind filter and net to zero anyway for a same-currency pair.
    ctx.db.execute<{ income: string; expenses: string }>(sql`
      select coalesce(sum(e.base_amount) filter (where t.kind = 'income'), 0)::text  as income,
             coalesce(sum(-e.base_amount) filter (where t.kind = 'expense'), 0)::text as expenses
        from ${transactionEntries} e
        join ${transactions} t on t.id = e.transaction_id
       where t.user_id = ${ctx.userId} and t.booked_on > ${from} and t.booked_on <= ${to}
    `),

    // GROSS income and the charges, from the ledger's own base column.
    ctx.db.execute<{
      income: string;
      costs: string;
      transfers_in: string;
      transfers_out: string;
    }>(sql`
      select
        coalesce(sum(round(i.gross_amount * i.fx_rate_instrument_to_account * i.fx_rate_to_base, 4))
                 filter (where i.kind in ('dividend','interest')), 0)::text as income,
        -- Standalone fee/tax rows PLUS the withholding taken out of income. Summed
        -- as numerics and cast once: casting each term to text first and adding
        -- would be string concatenation, which Postgres rightly refuses.
        (coalesce(sum(round(abs(i.base_net_amount), 4))
                  filter (where i.kind in ('fee','tax')), 0)
         + coalesce(sum(round((i.fees + i.taxes) * i.fx_rate_instrument_to_account * i.fx_rate_to_base, 4))
                  filter (where i.kind in ('dividend','interest')), 0))::text as costs,
        coalesce(sum(round(i.gross_amount * i.fx_rate_instrument_to_account * i.fx_rate_to_base, 4))
                 filter (where i.kind = 'transfer_in'), 0)::text  as transfers_in,
        coalesce(sum(round(i.gross_amount * i.fx_rate_instrument_to_account * i.fx_rate_to_base, 4))
                 filter (where i.kind = 'transfer_out'), 0)::text as transfers_out
        from ${investmentTransactions} i
       where i.user_id = ${ctx.userId} and i.trade_date > ${from} and i.trade_date <= ${to}
    `),

    ctx.db.execute<{ total: string }>(sql`
      select coalesce(sum(d.base_realized_pnl), 0)::text as total
        from ${lotDisposals} d
       where d.user_id = ${ctx.userId} and d.closed_on > ${from} and d.closed_on <= ${to}
    `),
  ]);

  const cashRow = cash.rows[0] ?? { income: '0', expenses: '0' };
  const inv = investment.rows[0] ?? {
    income: '0',
    costs: '0',
    transfers_in: '0',
    transfers_out: '0',
  };

  const savings = sub(
    Money.fromDbString(cashRow.income, base),
    Money.fromDbString(cashRow.expenses, base),
  );

  // A MATCHED transfer pair nets to zero across two accounts and needs no line.
  // An UNMATCHED leg — shares gifted in, or an existing holding recorded when
  // the user started using the app — genuinely moves net worth with no cash, and
  // without this line the bridge cannot close.
  const investmentTransfers = sub(
    Money.fromDbString(inv.transfers_in, base),
    Money.fromDbString(inv.transfers_out, base),
  );

  const assetFlows = manualAssetFlows(sources, from, to, base);
  const liabilityChange = scheduledLiabilityChange(sources, from, to, base);

  return {
    savings,
    investmentIncome: Money.fromDbString(inv.income, base),
    investmentCosts: Money.fromDbString(inv.costs, base),
    realizedPnl: Money.fromDbString(realized.rows[0]?.total ?? '0', base),
    investmentTransfers,
    assetRevaluation: assetFlows.revaluation,
    assetAdditions: assetFlows.additions,
    liabilityChange,
    // Computed, never a plug. For a single-currency ledger every term below is
    // identically zero, which is what lets I-30 assert EXACT closure there.
    fxEffect: fxEffect(ctx, sources, from, to),
  };
}

/**
 * Manual assets split into two lines: revaluation of assets held throughout, and
 * additions/disposals within the period. Splitting them is what lets the user
 * tell "the flat is worth more" from "we bought a flat".
 */
function manualAssetFlows(
  sources: NetWorthSources,
  from: IsoDate,
  to: IsoDate,
  base: CurrencyCode,
): { revaluation: MoneyValue; additions: MoneyValue } {
  let revaluation = Money.zero(base);
  let additions = Money.zero(base);

  for (const asset of sources.assets) {
    const startOn =
      asset.acquiredOn ??
      (asset.valuations.length > 0
        ? asset.valuations.reduce((a, b) => (compareDates(a.asOf, b.asOf) <= 0 ? a : b)).asOf
        : null);

    const heldAtFrom = manualAssetEligible({ startOn, disposedOn: asset.disposedOn }, from);
    const heldAtTo = manualAssetEligible({ startOn, disposedOn: asset.disposedOn }, to);

    const atFrom = inForce(asset.valuations, from);
    const atTo = inForce(asset.valuations, to);

    // Held throughout → the movement is revaluation.
    if (heldAtFrom && heldAtTo) {
      if (atFrom !== null && atTo !== null) {
        revaluation = add(
          revaluation,
          Money.fromMinor(atTo.value.minor - atFrom.value.minor, base),
        );
      }
      continue;
    }
    // Acquired within the period → its whole value is an addition.
    if (!heldAtFrom && heldAtTo && atTo !== null) {
      additions = add(additions, Money.fromMinor(atTo.value.minor, base));
      continue;
    }
    // Disposed within the period → its last value leaves.
    if (heldAtFrom && !heldAtTo && atFrom !== null) {
      additions = add(additions, Money.fromMinor(-atFrom.value.minor, base));
    }
  }

  return { revaluation, additions };
}

/**
 * `−(scheduled liabilities at t1 − at t0)`.
 *
 * **Scheduled only.** A credit card and a transacted loan move through their
 * linked account, so their change is already inside `Savings` and the investment
 * lines; counting them here as well would subtract a card purchase twice.
 */
function scheduledLiabilityChange(
  sources: NetWorthSources,
  from: IsoDate,
  to: IsoDate,
  base: CurrencyCode,
): MoneyValue {
  let delta = 0n;
  for (const liability of sources.liabilities) {
    if (liability.linkedAccountId !== null) continue;
    const atFrom = inForce(liability.balances, from);
    const atTo = inForce(liability.balances, to);
    delta += (atTo?.outstanding.minor ?? 0n) - (atFrom?.outstanding.minor ?? 0n);
  }
  return Money.fromMinor(-delta, base);
}

/**
 * Revaluation of every non-base holding across the period.
 *
 * `Σ_c opening_native(c) × (rate_c(t1) − rate_c(t0))`, over each non-base
 * currency held in an account, a manual asset or a scheduled liability. The
 * investment block contributes nothing: its base figure is fixed at acquisition
 * rates and never revalued.
 *
 * Identically zero for a single-currency ledger, which is what makes I-30's
 * exact-closure assertion meaningful there rather than vacuous.
 */
function fxEffect(
  ctx: ReadCtx,
  sources: NetWorthSources,
  from: IsoDate,
  to: IsoDate,
): MoneyValue {
  const opening = componentsAt(ctx, sources, from);
  let total = 0n;

  for (const component of opening) {
    const nativeCurrency = component.native.currency;
    if (nativeCurrency === ctx.base) continue;

    const atFrom = ctx.fx.rate(nativeCurrency, ctx.base, from);
    const atTo = ctx.fx.rate(nativeCurrency, ctx.base, to);
    if (!atFrom.ok || !atTo.ok) continue;

    // Same rounding as every other conversion: half_up at MONEY_SCALE, matching
    // the mode the database CHECK constraints use.
    const before = Money.fromMinor(component.native.minor, ctx.base);
    total += mulRate(before, atTo.value.rate, 'half_up').minor;
    total -= mulRate(before, atFrom.value.rate, 'half_up').minor;
  }

  return Money.fromMinor(total, ctx.base);
}

export { noFlows };
