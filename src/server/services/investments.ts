import 'server-only';

/**
 * Investment transactions (INVESTMENT-DOMAIN.md §3, INVESTMENT-ENGINE-DESIGN §6.1).
 *
 * ```
 * createInvestmentTransaction(ctx: WriteCtx, input) →
 *   1. VALIDATE    Zod parse
 *   2. AUTHORIZE   resolve account + instrument; requireOwnership; require active
 *   3. RESOLVE     instrument→account and account→base rates for trade_date
 *   4. ENGINE      buildInvestmentRow() — signs derived from `kind`
 *   5. BEGIN
 *        INSERT investment_transactions
 *        rebuildPosition(user, account, instrument)   -- may return err(oversell)
 *        INSERT audit_log
 *        UPDATE user_state SET investment_ledger_version = … + 1
 *      COMMIT                                          -- oversell → ROLLBACK
 * ```
 *
 * Step 4 mirrors the money side's `buildEntries()`: **the caller supplies a
 * positive quantity and a `kind`; this layer decides the sign.** That removes
 * the largest class of data-entry bug on both ledgers.
 *
 * ## The three-denomination cash chain (OD-5)
 *
 * ```
 * net_amount_instrument   instrument currency   every per-kind identity holds HERE
 *         × fx_rate_instrument_to_account
 * net_amount              account currency      deriveBalance() sums THIS
 *         × fx_rate_to_base
 * base_net_amount         base currency         aggregates run on THIS
 * ```
 *
 * Each link is a database `CHECK`, so the derivation cannot drift. The rate is
 * exactly `1` when the instrument and the account share a currency — which is
 * the common case, and where the chain collapses.
 *
 * **No mirroring `transactions` row is ever written** (I-13). `deriveBalance()`
 * sums both ledgers unconditionally, so a mirror would credit a ₹500 dividend
 * twice.
 */

import { and, desc, eq, sql, type SQL } from 'drizzle-orm';

import { compareDates, isoDate, type IsoDate } from '../../lib/date';
import {
  Money,
  add,
  currency,
  mulRate,
  neg,
  sub,
  toDbString,
  type CurrencyCode,
} from '../../lib/decimal/money';
import { Quantity, qAbs, qToDbString, type Quantity as Qty } from '../../lib/decimal/quantity';
import { Rate, rToDbString } from '../../lib/decimal/rate';
import { UnitPrice, pToDbString, valueOf, type UnitPrice as Price } from '../../lib/decimal/price';
import {
  createInvestmentTransactionSchema,
  investmentTransactionFilterSchema,
  type CreateInvestmentTransactionInput,
  type InvestmentTransactionFilter,
} from '../../lib/schemas/investments';
import {
  err,
  insufficientData,
  notFound,
  ok,
  validationFailed,
  type DomainError,
  type Result,
} from '../../lib/result';
import type { InvestmentKind } from '../domain/lots/order';
import { accounts, instruments, investmentTransactions } from '../db/schema';
import type { ReadCtx, WriteCtx } from './_ctx';
import { bumpInvestmentLedgerVersion } from './_ctx';
import { requireActiveAccount, requireOnOrAfterOpening, requireOwnership } from './_guards';
import { fieldErrors } from './_validation';
import { rebuildPosition } from './positions';

import type { RecordSource } from './transactions';

export interface InvestmentTransactionView {
  readonly id: string;
  readonly kind: InvestmentKind;
  readonly tradeDate: IsoDate;
  readonly settlementDate: IsoDate | null;
  readonly accountId: string;
  readonly accountName: string;
  readonly instrumentId: string | null;
  readonly instrumentSymbol: string | null;
  readonly instrumentName: string | null;

  /** Positive magnitude for display; the stored value carries the sign. */
  readonly quantity: Qty | null;
  readonly signedQuantity: Qty | null;
  readonly price: Price | null;
  /** Instrument currency. */
  readonly grossAmount: Money | null;
  readonly fees: Money;
  readonly taxes: Money;
  readonly netAmountInstrument: Money;
  /** Account currency — what moves the balance. */
  readonly netAmount: Money;
  readonly baseNetAmount: Money;
  readonly currency: CurrencyCode;
  readonly accountCurrency: CurrencyCode;

  readonly ratioNum: number | null;
  readonly ratioDen: number | null;
  readonly originalAcquiredOn: IsoDate | null;
  readonly cashSettled: boolean;
  readonly notes: string | null;
  readonly source: RecordSource;
  readonly createdAt: Date;
}

// ----------------------------------------------------------------------- reads

export interface InvestmentTransactionPage {
  readonly rows: readonly InvestmentTransactionView[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export async function listInvestmentTransactions(
  ctx: ReadCtx,
  rawQuery: Partial<InvestmentTransactionFilter> = {},
): Promise<Result<InvestmentTransactionPage, DomainError>> {
  const parsed = investmentTransactionFilterSchema.safeParse(rawQuery);
  if (!parsed.success) return err(fieldErrors(parsed.error));
  const query = parsed.data;

  const conditions: SQL[] = [eq(investmentTransactions.userId, ctx.userId)];
  if (query.from) conditions.push(sql`${investmentTransactions.tradeDate} >= ${query.from}`);
  if (query.to) conditions.push(sql`${investmentTransactions.tradeDate} <= ${query.to}`);
  if (query.accountId) conditions.push(eq(investmentTransactions.accountId, query.accountId));
  if (query.instrumentId) conditions.push(eq(investmentTransactions.instrumentId, query.instrumentId));
  if (query.kind) conditions.push(eq(investmentTransactions.kind, query.kind));

  const where = and(...conditions)!;

  const [{ count } = { count: 0 }] = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(investmentTransactions)
    .where(where);

  const rows = await ctx.db
    .select({
      txn: investmentTransactions,
      accountName: accounts.name,
      accountCurrency: accounts.currencyCode,
      instrumentSymbol: instruments.symbol,
      instrumentName: instruments.name,
    })
    .from(investmentTransactions)
    .innerJoin(accounts, eq(accounts.id, investmentTransactions.accountId))
    .leftJoin(instruments, eq(instruments.id, investmentTransactions.instrumentId))
    .where(where)
    .orderBy(desc(investmentTransactions.tradeDate), desc(investmentTransactions.id))
    .limit(query.limit)
    .offset(query.offset);

  return ok({
    rows: rows.map((row) => toView(row, ctx.base)),
    total: count,
    limit: query.limit,
    offset: query.offset,
  });
}

export async function getInvestmentTransaction(
  ctx: ReadCtx,
  id: string,
): Promise<Result<InvestmentTransactionView, DomainError>> {
  const [row] = await ctx.db
    .select({
      txn: investmentTransactions,
      accountName: accounts.name,
      accountCurrency: accounts.currencyCode,
      instrumentSymbol: instruments.symbol,
      instrumentName: instruments.name,
    })
    .from(investmentTransactions)
    .innerJoin(accounts, eq(accounts.id, investmentTransactions.accountId))
    .leftJoin(instruments, eq(instruments.id, investmentTransactions.instrumentId))
    .where(eq(investmentTransactions.id, id))
    .limit(1);

  if (!row || row.txn.userId !== ctx.userId) return err(notFound('investment transaction', id));
  return ok(toView(row, ctx.base));
}

type JoinedRow = {
  txn: typeof investmentTransactions.$inferSelect;
  accountName: string;
  accountCurrency: string;
  instrumentSymbol: string | null;
  instrumentName: string | null;
};

function toView(row: JoinedRow, base: CurrencyCode): InvestmentTransactionView {
  const t = row.txn;
  const instrumentCurrency = currency(t.currencyCode.trim());
  const accountCurrency = currency(row.accountCurrency.trim());
  const signed = t.quantity === null ? null : Quantity.fromDbString(t.quantity);

  return {
    id: t.id,
    kind: t.kind,
    tradeDate: isoDate(t.tradeDate),
    settlementDate: t.settlementDate === null ? null : isoDate(t.settlementDate),
    accountId: t.accountId,
    accountName: row.accountName,
    instrumentId: t.instrumentId,
    instrumentSymbol: row.instrumentSymbol,
    instrumentName: row.instrumentName,
    quantity: signed === null ? null : qAbs(signed),
    signedQuantity: signed,
    price: t.price === null ? null : UnitPrice.fromDbString(t.price),
    grossAmount: t.grossAmount === null ? null : Money.fromDbString(t.grossAmount, instrumentCurrency),
    fees: Money.fromDbString(t.fees, instrumentCurrency),
    taxes: Money.fromDbString(t.taxes, instrumentCurrency),
    netAmountInstrument: Money.fromDbString(t.netAmountInstrument, instrumentCurrency),
    netAmount: Money.fromDbString(t.netAmount, accountCurrency),
    baseNetAmount: Money.fromDbString(t.baseNetAmount, base),
    currency: instrumentCurrency,
    accountCurrency,
    ratioNum: t.ratioNum,
    ratioDen: t.ratioDen,
    originalAcquiredOn: t.originalAcquiredOn === null ? null : isoDate(t.originalAcquiredOn),
    cashSettled: t.cashSettled,
    notes: t.notes,
    source: t.source,
    createdAt: t.createdAt,
  };
}

// -------------------------------------------------------------------- commands

/**
 * The row the engine derives from a validated input — every figure, at every
 * denomination, with the sign already decided by `kind`.
 */
interface InvestmentRow {
  readonly kind: InvestmentKind;
  readonly quantity: Qty | null;
  readonly price: Price | null;
  readonly grossAmount: Money | null;
  readonly fees: Money;
  readonly taxes: Money;
  readonly netAmountInstrument: Money;
  readonly netAmount: Money;
  readonly baseNetAmount: Money;
  readonly fxInstrumentToAccount: Rate;
  readonly fxAccountToBase: Rate;
  readonly ratioNum: number | null;
  readonly ratioDen: number | null;
  readonly originalAcquiredOn: IsoDate | null;
  readonly cashSettled: boolean;
}

export async function createInvestmentTransaction(
  ctx: WriteCtx,
  raw: unknown,
  options: { readonly source?: RecordSource } = {},
): Promise<Result<InvestmentTransactionView, DomainError>> {
  const parsed = createInvestmentTransactionSchema.safeParse(raw);
  if (!parsed.success) return err(fieldErrors(parsed.error));
  const input: CreateInvestmentTransactionInput = parsed.data;

  const tradeDate = isoDate(input.tradeDate);

  const account = await resolveAccount(ctx, input.accountId, tradeDate);
  if (!account.ok) return account;

  const instrumentId = 'instrumentId' in input ? input.instrumentId : undefined;
  const instrument =
    instrumentId === undefined ? null : await resolveInstrument(ctx, instrumentId);
  if (instrument !== null && !instrument.ok) return instrument;
  const resolved = instrument === null ? null : instrument.value;

  // An account-level charge has no instrument, and therefore no instrument
  // currency: it is denominated in the account's own (§6.2).
  const instrumentCurrency = resolved?.currency ?? account.value.currency;

  const built = buildInvestmentRow(input, {
    instrumentCurrency,
    accountCurrency: account.value.currency,
    baseCurrency: ctx.base,
    tradeDate,
    fx: ctx.fx,
  });
  if (!built.ok) return built;

  const version = await bumpInvestmentLedgerVersion(ctx);

  const [inserted] = await ctx.tx
    .insert(investmentTransactions)
    .values({
      userId: ctx.userId,
      accountId: account.value.id,
      instrumentId: resolved?.id ?? null,
      kind: built.value.kind,
      tradeDate,
      settlementDate: input.settlementDate ?? null,
      quantity: built.value.quantity === null ? null : qToDbString(built.value.quantity),
      price: built.value.price === null ? null : pToDbString(built.value.price),
      grossAmount: built.value.grossAmount === null ? null : toDbString(built.value.grossAmount),
      fees: toDbString(built.value.fees),
      taxes: toDbString(built.value.taxes),
      currencyCode: instrumentCurrency,
      netAmountInstrument: toDbString(built.value.netAmountInstrument),
      fxRateInstrumentToAccount: rToDbString(built.value.fxInstrumentToAccount),
      netAmount: toDbString(built.value.netAmount),
      fxRateToBase: rToDbString(built.value.fxAccountToBase),
      baseNetAmount: toDbString(built.value.baseNetAmount),
      ratioNum: built.value.ratioNum,
      ratioDen: built.value.ratioDen,
      originalAcquiredOn: built.value.originalAcquiredOn,
      cashSettled: built.value.cashSettled,
      notes: input.notes ?? null,
      source: options.source ?? 'manual',
    })
    .returning({ id: investmentTransactions.id });

  if (!inserted) throw new Error('Insert of an investment transaction returned no row.');

  // The rebuild shares this transaction. An oversell introduced here — including
  // by a backdated sell — rolls the INSERT back with it, so nothing is written
  // and `investment_ledger_version` is not left advanced (edge case 30).
  if (resolved !== null) {
    const rebuilt = await rebuildPosition(
      ctx,
      { accountId: account.value.id, instrumentId: resolved.id },
      version,
    );
    if (!rebuilt.ok) return rebuilt;
  }

  await ctx.audit.record({
    actor: options.source === 'ai' ? 'ai_confirmed' : options.source === 'recurring' ? 'system' : 'user',
    action: 'investment_transaction.create',
    entityType: 'investment_transaction',
    entityId: inserted.id,
    after: {
      kind: built.value.kind,
      tradeDate,
      accountId: account.value.id,
      instrumentId: resolved?.id ?? null,
      netAmount: toDbString(built.value.netAmount),
      netAmountInstrument: toDbString(built.value.netAmountInstrument),
    },
  });

  return getInvestmentTransaction(ctx, inserted.id);
}

/**
 * Delete a ledger row and re-derive the position it belonged to.
 *
 * There is no partial-undo path: the position is replayed from scratch, which is
 * the same code the create path runs. A deletion that would leave the remaining
 * history oversold — removing a purchase that a later sale depended on — fails
 * and rolls back, exactly as a bad insert does.
 */
export async function deleteInvestmentTransaction(
  ctx: WriteCtx,
  id: string,
): Promise<Result<void, DomainError>> {
  const [row] = await ctx.tx
    .select()
    .from(investmentTransactions)
    .where(eq(investmentTransactions.id, id))
    .limit(1);

  const owned = requireOwnership(row, ctx.userId, 'investment transaction', id);
  if (!owned.ok) return owned;

  await ctx.tx.delete(investmentTransactions).where(eq(investmentTransactions.id, id));

  const version = await bumpInvestmentLedgerVersion(ctx);
  if (owned.value.instrumentId !== null) {
    const rebuilt = await rebuildPosition(
      ctx,
      { accountId: owned.value.accountId, instrumentId: owned.value.instrumentId },
      version,
    );
    if (!rebuilt.ok) return rebuilt;
  }

  await ctx.audit.record({
    actor: 'user',
    action: 'investment_transaction.delete',
    entityType: 'investment_transaction',
    entityId: id,
    before: {
      kind: owned.value.kind,
      tradeDate: owned.value.tradeDate,
      netAmount: owned.value.netAmount,
    },
  });

  return ok(undefined);
}

// --------------------------------------------------------------- the "engine"

interface BuildContext {
  readonly instrumentCurrency: CurrencyCode;
  readonly accountCurrency: CurrencyCode;
  readonly baseCurrency: CurrencyCode;
  readonly tradeDate: IsoDate;
  readonly fx: ReadCtx['fx'];
}

/**
 * Derive every stored figure from a validated input.
 *
 * Pure apart from the FX lookup, which is a synchronous read over rates the
 * request already loaded. The caller never supplies a sign, a gross amount or a
 * net amount: all three are derived here, which is what makes the database's
 * per-kind `CHECK` constraints a second opinion rather than the only one.
 */
function buildInvestmentRow(
  input: CreateInvestmentTransactionInput,
  build: BuildContext,
): Result<InvestmentRow, DomainError> {
  const { instrumentCurrency, accountCurrency, baseCurrency } = build;
  const zeroInstrument = Money.zero(instrumentCurrency);

  const rates = resolveRates(build);
  if (!rates.ok) return rates;
  const { instrumentToAccount, accountToBase } = rates.value;

  /** The chain: instrument → account → base, each link a checked derivation. */
  const chain = (netInstrument: Money) => {
    const netAccount = mulRate(
      Money.fromMinor(netInstrument.minor, accountCurrency),
      instrumentToAccount,
      'half_up',
    );
    const netBase = mulRate(Money.fromMinor(netAccount.minor, baseCurrency), accountToBase, 'half_up');
    return { netInstrument, netAccount, netBase };
  };

  const charge = (value: string | undefined): Money =>
    value === undefined ? zeroInstrument : Money.of(value, instrumentCurrency);

  switch (input.kind) {
    case 'buy':
    case 'mf_purchase':
    case 'sell':
    case 'mf_redemption': {
      const quantity = Quantity.of(input.quantity);
      const price = UnitPrice.of(input.price);
      const gross = valueOf(quantity, price, instrumentCurrency, 'half_up');
      const fees = charge(input.fees);
      const taxes = charge(input.taxes);
      const isBuy = input.kind === 'buy' || input.kind === 'mf_purchase';

      if (isBuy && add(add(gross, fees), taxes).minor <= 0n) {
        // `inv_txn_acquisition_has_cost`: a lot with units and no basis is
        // forbidden by I-19, so the purchase is refused with a sentence rather
        // than a constraint error from the middle of a rebuild.
        return err(
          validationFailed({
            price: ['This purchase has no cost — quantity × price rounds to zero at four decimals.'],
          }),
        );
      }

      const net = isBuy ? neg(add(add(gross, fees), taxes)) : sub(sub(gross, fees), taxes);
      const chained = chain(net);

      return ok({
        kind: input.kind,
        // The sign comes from the kind, never from the input.
        quantity: isBuy ? quantity : Quantity.fromUnits(-quantity.units),
        price,
        grossAmount: gross,
        fees,
        taxes,
        netAmountInstrument: chained.netInstrument,
        netAmount: chained.netAccount,
        baseNetAmount: chained.netBase,
        fxInstrumentToAccount: instrumentToAccount,
        fxAccountToBase: accountToBase,
        ratioNum: null,
        ratioDen: null,
        originalAcquiredOn: null,
        cashSettled: true,
      });
    }

    case 'dividend':
    case 'interest': {
      const gross = Money.of(input.grossAmount, instrumentCurrency);
      const fees = charge(input.fees);
      const taxes = charge(input.taxes);
      const net = sub(sub(gross, fees), taxes);

      if (net.minor <= 0n) {
        // I-12's `CHECK` requires a positive net. Charges exceeding the declared
        // amount mean one of the three figures is wrong, not that the user
        // received nothing.
        return err(
          validationFailed({
            grossAmount: ['Fees and tax exceed the declared amount — check the three figures.'],
          }),
        );
      }

      const chained = chain(net);
      return ok({
        kind: input.kind,
        quantity: null,
        price: null,
        // GROSS is stored; `income_total` accrues it and `taxes_total` accrues
        // the withholding separately (I-12).
        grossAmount: gross,
        fees,
        taxes,
        netAmountInstrument: chained.netInstrument,
        netAmount: chained.netAccount,
        baseNetAmount: chained.netBase,
        fxInstrumentToAccount: instrumentToAccount,
        fxAccountToBase: accountToBase,
        ratioNum: null,
        ratioDen: null,
        originalAcquiredOn: null,
        cashSettled: true,
      });
    }

    case 'fee':
    case 'tax': {
      const amount = Money.of(input.amount, instrumentCurrency);
      const chained = chain(neg(amount));
      return ok({
        kind: input.kind,
        quantity: null,
        price: null,
        grossAmount: null,
        fees: zeroInstrument,
        taxes: zeroInstrument,
        netAmountInstrument: chained.netInstrument,
        netAmount: chained.netAccount,
        baseNetAmount: chained.netBase,
        fxInstrumentToAccount: instrumentToAccount,
        fxAccountToBase: accountToBase,
        ratioNum: null,
        ratioDen: null,
        originalAcquiredOn: null,
        cashSettled: true,
      });
    }

    case 'split':
    case 'bonus': {
      // A ratio and nothing else. No quantity, no price, no money at any
      // denomination — a corporate action moves units, never basis.
      const zeroChain = chain(zeroInstrument);
      return ok({
        kind: input.kind,
        quantity: null,
        price: null,
        grossAmount: null,
        fees: zeroInstrument,
        taxes: zeroInstrument,
        netAmountInstrument: zeroChain.netInstrument,
        netAmount: zeroChain.netAccount,
        baseNetAmount: zeroChain.netBase,
        fxInstrumentToAccount: instrumentToAccount,
        fxAccountToBase: accountToBase,
        ratioNum: input.ratioNum,
        ratioDen: input.ratioDen,
        originalAcquiredOn: null,
        cashSettled: false,
      });
    }

    case 'transfer_in':
    case 'transfer_out': {
      const quantity = Quantity.of(input.quantity);
      const price = UnitPrice.of(input.price);
      const gross = valueOf(quantity, price, instrumentCurrency, 'half_up');
      const isIn = input.kind === 'transfer_in';

      if (isIn && gross.minor <= 0n) {
        return err(
          validationFailed({
            price: ['A transfer carries a basis — quantity × price rounds to zero at four decimals.'],
          }),
        );
      }

      const originalAcquiredOn =
        isIn && 'originalAcquiredOn' in input && input.originalAcquiredOn !== undefined
          ? isoDate(input.originalAcquiredOn)
          : null;

      if (originalAcquiredOn !== null && compareDates(originalAcquiredOn, build.tradeDate) > 0) {
        return err(
          validationFailed({
            originalAcquiredOn: ['Shares cannot have been acquired after they were transferred in.'],
          }),
        );
      }

      // A transfer moves basis, not money, and carries no fees or taxes — a
      // demat transfer charge is a separate `fee` row.
      const zeroChain = chain(zeroInstrument);
      return ok({
        kind: input.kind,
        quantity: isIn ? quantity : Quantity.fromUnits(-quantity.units),
        price,
        grossAmount: gross,
        fees: zeroInstrument,
        taxes: zeroInstrument,
        netAmountInstrument: zeroChain.netInstrument,
        netAmount: zeroChain.netAccount,
        baseNetAmount: zeroChain.netBase,
        fxInstrumentToAccount: instrumentToAccount,
        fxAccountToBase: accountToBase,
        ratioNum: null,
        ratioDen: null,
        originalAcquiredOn,
        cashSettled: false,
      });
    }
  }
}

/**
 * Both rates, dated to the trade.
 *
 * `instrument → account` is exactly `1` when the two currencies match, without a
 * table lookup — the identity rule in FINANCIAL-DOMAIN.md §2. Otherwise it is an
 * explicit dated lookup: exact `as_of`, else the most recent earlier rate, else
 * reject. **Never a default of 1 as a fallback**, which would silently value a
 * dollar trade as if it were rupees.
 */
function resolveRates(
  build: BuildContext,
): Result<{ instrumentToAccount: Rate; accountToBase: Rate }, DomainError> {
  const dated = (from: CurrencyCode, to: CurrencyCode): Result<Rate, DomainError> => {
    if (from === to) return ok(Rate.one());
    const selection = build.fx.rate(from, to, build.tradeDate);
    if (!selection.ok) {
      return err(
        insufficientData(
          'no_fx_rate',
          `No exchange rate from ${from} to ${to} on or before ${build.tradeDate}. ` +
            'Add one before recording this transaction.',
        ),
      );
    }
    return ok(selection.value.rate);
  };

  const instrumentToAccount = dated(build.instrumentCurrency, build.accountCurrency);
  if (!instrumentToAccount.ok) return instrumentToAccount;

  const accountToBase = dated(build.accountCurrency, build.baseCurrency);
  if (!accountToBase.ok) return accountToBase;

  return ok({
    instrumentToAccount: instrumentToAccount.value,
    accountToBase: accountToBase.value,
  });
}

// -------------------------------------------------------------------- lookups

async function resolveAccount(
  ctx: WriteCtx,
  accountId: string,
  tradeDate: IsoDate,
): Promise<Result<{ id: string; currency: CurrencyCode; name: string }, DomainError>> {
  const [row] = await ctx.tx
    .select({
      id: accounts.id,
      userId: accounts.userId,
      name: accounts.name,
      currencyCode: accounts.currencyCode,
      isActive: accounts.isActive,
      openingDate: accounts.openingDate,
    })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);

  const owned = requireOwnership(row, ctx.userId, 'account', accountId);
  if (!owned.ok) return owned;

  const active = requireActiveAccount(owned.value, 'accountId');
  if (!active.ok) return active;

  const inRange = requireOnOrAfterOpening(owned.value, tradeDate, 'tradeDate');
  if (!inRange.ok) return inRange;

  return ok({
    id: owned.value.id,
    name: owned.value.name,
    currency: currency(owned.value.currencyCode.trim()),
  });
}

async function resolveInstrument(
  ctx: WriteCtx,
  instrumentId: string,
): Promise<Result<{ id: string; currency: CurrencyCode; symbol: string }, DomainError>> {
  const [row] = await ctx.tx
    .select({
      id: instruments.id,
      userId: instruments.userId,
      symbol: instruments.symbol,
      currencyCode: instruments.currencyCode,
      isActive: instruments.isActive,
    })
    .from(instruments)
    .where(eq(instruments.id, instrumentId))
    .limit(1);

  const owned = requireOwnership(row, ctx.userId, 'instrument', instrumentId);
  if (!owned.ok) return owned;

  if (!owned.value.isActive) {
    return err(
      validationFailed({
        instrumentId: [`${owned.value.symbol} is inactive. Reactivate it before recording a trade.`],
      }),
    );
  }

  return ok({
    id: owned.value.id,
    symbol: owned.value.symbol,
    currency: currency(owned.value.currencyCode.trim()),
  });
}
