/**
 * Instruments, prices and the investment ledger (SCHEMA.md §5, §6, §6.1).
 *
 * Four properties are load-bearing here, and each is enforced by a constraint
 * below rather than by convention:
 *
 * 1. **The cash effect is carried at three denominations**, each a `CHECK`ed
 *    derivation of the one before it (OD-5, ADR-12):
 *    `net_amount_instrument` (instrument currency, where every per-kind identity
 *    holds) → `net_amount` (account currency, what `deriveBalance()` sums) →
 *    `base_net_amount` (base currency, what aggregates run on). Stating the
 *    identities on `net_amount` would equate an account-currency column with an
 *    instrument-currency expression, and a USD dividend paid into an INR
 *    brokerage account would be rejected by the database.
 *
 * 2. **A lot stores money exactly and derives the rate.** `cost_total` and
 *    `remaining_cost` are columns; `cost_per_unit` is not, and never will be.
 *    That inversion is what makes invariant I-6 an exact equality with no
 *    tolerance, and what lets a split touch no money at all.
 *
 * 3. **`tax_lots`, `lot_disposals` and `positions` are a rebuildable cache**, not
 *    records (ADR-06). They can be deleted and re-derived from
 *    `investment_transactions` at any moment without data loss.
 *
 * 4. **An unsettled row moves no cash.** `deriveBalance()` sums `net_amount`
 *    unconditionally — no `cash_settled` filter — so a non-zero amount on an
 *    unsettled row would move a balance that no cash ever moved (I-16).
 *
 * `investment_transactions.ai_proposal_id` is deliberately absent, following the
 * precedent D-17 set on `transactions.ai_proposal_id`: `ai_proposals` does not
 * exist until Phase 7, and a bare uuid column with no referent and no constraint
 * is half of an unreviewed phase. Phase 7 adds both columns together with their
 * foreign keys and the partial unique index that invariant I-14 needs.
 */

import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { assetClass, costBasisMethod, investmentKind, recordSource } from './enums';
import { accounts } from './money';
import { currencies } from './reference';
import { users } from './identity';

/** `numeric(20,4)` — money, ADR-04. Read as a string, never a float. */
const money = (name: string) => numeric(name, { precision: 20, scale: 4 });
/** `numeric(28,8)` — units of an instrument. */
const quantity = (name: string) => numeric(name, { precision: 28, scale: 8 });
/** `numeric(20,8)` — a per-unit figure. Scale 8, which is why `UnitPrice` exists. */
const unitPrice = (name: string) => numeric(name, { precision: 20, scale: 8 });
/** `numeric(20,10)` — an FX rate. */
const fxRate = (name: string) => numeric(name, { precision: 20, scale: 10 });

// ----------------------------------------------------------------- instruments

export const instruments = pgTable(
  'instruments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    symbol: text('symbol').notNull(),
    /** NSE, BSE, NASDAQ — `null` for a mutual fund, which has no exchange. */
    exchange: text('exchange'),
    isin: text('isin'),
    name: text('name').notNull(),

    assetClass: assetClass('asset_class').notNull(),
    /** The currency the instrument is priced and transacted in. Not the account's. */
    currencyCode: char('currency_code', { length: 3 })
      .notNull()
      .references(() => currencies.code),
    country: char('country', { length: 2 }),

    /** Key into the provider registry; `null` means the price is entered by hand. */
    priceProvider: text('price_provider'),
    providerSymbol: text('provider_symbol'),

    costBasisMethod: costBasisMethod('cost_basis_method').notNull().default('fifo'),

    isActive: boolean('is_active').notNull().default(true),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // NULLS NOT DISTINCT for the same reason as `categories`: `exchange` is null
    // for every mutual fund, and Postgres treats each null as distinct, so a
    // plain UNIQUE would let the same scheme be created twice and silently split
    // its position in two.
    unique('instruments_user_symbol_exchange_uniq')
      .on(t.userId, t.symbol, t.exchange)
      .nullsNotDistinct(),
    index('instruments_isin_idx').on(t.userId, t.isin).where(sql`${t.isin} is not null`),
    index('instruments_user_active_idx').on(t.userId, t.isActive, t.assetClass),
  ],
);

// --------------------------------------------------------------------- prices

/**
 * Historical daily closes. Populated by `getHistoricalPrices()` in Phase 6; the
 * table exists now because TWR and the portfolio-growth series read it, and both
 * must return a labelled gap rather than a fabricated figure while it is empty
 * ([INVESTMENT-DOMAIN.md §8](../../../../docs/INVESTMENT-DOMAIN.md#8-time-weighted-return)).
 */
export const instrumentPrices = pgTable(
  'instrument_prices',
  {
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'cascade' }),
    asOf: date('as_of').notNull(),
    close: unitPrice('close').notNull(),
    currencyCode: char('currency_code', { length: 3 })
      .notNull()
      .references(() => currencies.code),
    source: text('source').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.instrumentId, t.asOf] }),
    check('instrument_prices_close_non_negative', sql`${t.close} >= 0`),
  ],
);

/**
 * The latest known price, one row per instrument.
 *
 * Staleness is **computed, not stored**: `now() - as_of > price_stale_after_hours`.
 * A stored boolean would need a job to keep it honest, and a stale flag that is
 * itself stale is worse than none.
 */
export const instrumentQuotes = pgTable(
  'instrument_quotes',
  {
    instrumentId: uuid('instrument_id')
      .primaryKey()
      .references(() => instruments.id, { onDelete: 'cascade' }),
    price: unitPrice('price').notNull(),
    currencyCode: char('currency_code', { length: 3 })
      .notNull()
      .references(() => currencies.code),
    /** When the price was **true**, not when it was fetched. */
    asOf: timestamp('as_of', { withTimezone: true }).notNull(),
    source: text('source').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('instrument_quotes_price_non_negative', sql`${t.price} >= 0`)],
);

// --------------------------------------------------------- investment ledger

export const investmentTransactions = pgTable(
  'investment_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** RESTRICT: an account with ledger history cannot be deleted, only closed. */
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),

    /** Null only for an account-level `fee`, `tax` or `interest` row (§6.2). */
    instrumentId: uuid('instrument_id').references(() => instruments.id, { onDelete: 'restrict' }),

    kind: investmentKind('kind').notNull(),
    tradeDate: date('trade_date').notNull(),
    settlementDate: date('settlement_date'),

    /** Signed: positive acquires, negative disposes. The engine derives the sign. */
    quantity: quantity('quantity'),
    /** Per unit, in the **instrument's** currency. */
    price: unitPrice('price'),
    /** `|quantity| × price`, in the instrument's currency. */
    grossAmount: money('gross_amount'),
    fees: money('fees').notNull().default('0'),
    taxes: money('taxes').notNull().default('0'),

    /** The **instrument's** currency — deliberately not the account's (§6). */
    currencyCode: char('currency_code', { length: 3 })
      .notNull()
      .references(() => currencies.code),

    /** Instrument currency. Every per-kind cash identity holds on this column. */
    netAmountInstrument: money('net_amount_instrument').notNull(),
    /** Exactly 1 when the instrument and the account share a currency. */
    fxRateInstrumentToAccount: fxRate('fx_rate_instrument_to_account').notNull(),
    /** Account currency. This is the column `deriveBalance()` sums. */
    netAmount: money('net_amount').notNull(),

    /** Converts the **account** currency to base. */
    fxRateToBase: fxRate('fx_rate_to_base').notNull(),
    baseNetAmount: money('base_net_amount').notNull(),

    /** split/bonus: new units per `ratio_den` old. Null on every other kind. */
    ratioNum: integer('ratio_num'),
    ratioDen: integer('ratio_den'),

    /**
     * The **original** acquisition date carried by a `transfer_in`, so moving
     * shares between two of your own demat accounts does not reset a long-term
     * holding to short-term.
     */
    originalAcquiredOn: date('original_acquired_on'),

    cashSettled: boolean('cash_settled').notNull().default(true),
    notes: text('notes'),
    source: recordSource('source').notNull().default('manual'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The order the lot engine replays in. Total even when several transactions
    // share a trade_date; `kind_rank` is applied in the engine over these rows.
    index('inv_txn_replay_idx').on(
      t.userId,
      t.accountId,
      t.instrumentId,
      t.tradeDate,
      t.createdAt,
      t.id,
    ),
    // The ledger list view, newest first. Mirrors transactions_user_date_idx.
    index('inv_txn_user_date_idx').on(t.userId, t.tradeDate.desc(), t.id.desc()),
    index('inv_txn_instrument_idx').on(t.userId, t.instrumentId, t.tradeDate),

    check('inv_txn_fees_non_negative', sql`${t.fees} >= 0`),
    check('inv_txn_taxes_non_negative', sql`${t.taxes} >= 0`),
    check('inv_txn_fx_instrument_positive', sql`${t.fxRateInstrumentToAccount} > 0`),
    check('inv_txn_fx_base_positive', sql`${t.fxRateToBase} > 0`),

    check(
      'inv_txn_acquire_shape',
      sql`${t.kind} not in ('buy','mf_purchase','transfer_in') or (${t.quantity} > 0 and ${t.price} is not null)`,
    ),
    check(
      'inv_txn_dispose_shape',
      sql`${t.kind} not in ('sell','mf_redemption','transfer_out') or (${t.quantity} < 0 and ${t.price} is not null)`,
    ),
    // An acquisition opens a lot with `cost_total = gross + fees + taxes`, and a
    // lot with units but no basis is forbidden by I-19. A dust purchase whose
    // total rounds to zero at MONEY_SCALE would therefore be accepted here and
    // rejected by `tax_lots` mid-rebuild, surfacing as an opaque constraint
    // error rather than as "this purchase has no cost". Blocked at the source.
    check(
      'inv_txn_acquisition_has_cost',
      sql`${t.kind} not in ('buy','mf_purchase','transfer_in')
          or ${t.grossAmount} + ${t.fees} + ${t.taxes} > 0`,
    ),
    check(
      'inv_txn_ratio_shape',
      sql`${t.kind} not in ('split','bonus') or (${t.ratioNum} > 0 and ${t.ratioDen} > 0 and ${t.cashSettled} = false)`,
    ),

    // I-12. Income accrues GROSS and the withholding is subtracted once,
    // separately. Stated on net_amount_instrument because gross_amount, fees and
    // taxes are all instrument-currency figures — on net_amount it would be
    // false for every foreign-currency row.
    check(
      'inv_txn_income_identity',
      sql`${t.kind} not in ('dividend','interest')
          or (${t.netAmountInstrument} > 0 and ${t.grossAmount} is not null
              and ${t.netAmountInstrument} = ${t.grossAmount} - ${t.fees} - ${t.taxes})`,
    ),
    check('inv_txn_fee_is_negative', sql`${t.kind} <> 'fee' or ${t.netAmountInstrument} < 0`),
    check('inv_txn_tax_is_negative', sql`${t.kind} <> 'tax' or ${t.netAmountInstrument} < 0`),
    // Only an account-level charge may omit the instrument (§6.2).
    check(
      'inv_txn_instrument_required',
      sql`${t.instrumentId} is not null or ${t.kind} in ('fee','tax','interest')`,
    ),

    // I-16. deriveBalance() sums net_amount unconditionally. Both denominations,
    // so the account-currency figure cannot be reintroduced by a non-zero rate.
    check(
      'inv_txn_unsettled_moves_no_cash',
      sql`${t.cashSettled} or (${t.netAmount} = 0 and ${t.netAmountInstrument} = 0)`,
    ),

    // gross is a derivation of quantity × price, so it cannot disagree with them.
    check(
      'inv_txn_gross_identity',
      sql`${t.kind} not in ('buy','sell','mf_purchase','mf_redemption','transfer_in','transfer_out')
          or ${t.grossAmount} = round(abs(${t.quantity}) * ${t.price}, 4)`,
    ),
    check(
      'inv_txn_buy_net_identity',
      sql`${t.kind} not in ('buy','mf_purchase')
          or ${t.netAmountInstrument} = -(${t.grossAmount} + ${t.fees} + ${t.taxes})`,
    ),
    check(
      'inv_txn_sell_net_identity',
      sql`${t.kind} not in ('sell','mf_redemption')
          or ${t.netAmountInstrument} = ${t.grossAmount} - ${t.fees} - ${t.taxes}`,
    ),
    // A transfer moves basis, not money — and carries no fees or taxes either. A
    // demat transfer charge is a separate `fee` row.
    check(
      'inv_txn_transfer_no_cash',
      sql`${t.kind} not in ('transfer_in','transfer_out')
          or (${t.netAmount} = 0 and ${t.netAmountInstrument} = 0 and ${t.fees} = 0 and ${t.taxes} = 0)`,
    ),
    // A corporate action carries a ratio and nothing else. Permitting a quantity
    // or a price on one invites an engine that reads it.
    check(
      'inv_txn_corporate_action_shape',
      sql`${t.kind} not in ('split','bonus')
          or (${t.quantity} is null and ${t.price} is null and ${t.grossAmount} is null
              and ${t.netAmount} = 0 and ${t.netAmountInstrument} = 0
              and ${t.fees} = 0 and ${t.taxes} = 0)`,
    ),
    check(
      'inv_txn_ratio_only_on_corporate_actions',
      sql`${t.kind} in ('split','bonus') or (${t.ratioNum} is null and ${t.ratioDen} is null)`,
    ),
    // Only a transfer_in carries a holding period forward; on anything else the
    // column would be an unread value that looks meaningful.
    check(
      'inv_txn_original_acquired_only_on_transfer_in',
      sql`${t.kind} = 'transfer_in' or ${t.originalAcquiredOn} is null`,
    ),
    // Shares cannot have been acquired after they were transferred in. Without
    // this, `holding_days` on the eventual sale would be negative, and the
    // `lot_disposals_holding_days_non_negative` CHECK would fail mid-rebuild —
    // reporting the fault against the wrong row.
    check(
      'inv_txn_original_acquired_not_in_future',
      sql`${t.originalAcquiredOn} is null or ${t.originalAcquiredOn} <= ${t.tradeDate}`,
    ),

    // I-11, the full chain. Each denomination is a stored derivation of the one
    // above it, so neither can drift. round() on numeric is immutable and rounds
    // halves away from zero — exactly what mulRate(_, _, 'half_up') does.
    check(
      'inv_txn_account_amount_consistent',
      sql`${t.netAmount} = round(${t.netAmountInstrument} * ${t.fxRateInstrumentToAccount}, 4)`,
    ),
    check(
      'inv_txn_base_amount_consistent',
      sql`${t.baseNetAmount} = round(${t.netAmount} * ${t.fxRateToBase}, 4)`,
    ),
  ],
);

// ------------------------------------------------------- derived: lots, P&L

export const taxLots = pgTable(
  'tax_lots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'cascade' }),
    openedByTxnId: uuid('opened_by_txn_id')
      .notNull()
      .references(() => investmentTransactions.id, { onDelete: 'cascade' }),

    /** When this lot row came into being. */
    openedOn: date('opened_on').notNull(),
    /**
     * The **original** acquisition. `transfer_in` carries it forward from the
     * source lot, so `holding_days` is measured from the real purchase and a
     * long-term holding does not silently become short-term.
     */
    acquiredOn: date('acquired_on').notNull(),

    originalQuantity: quantity('original_quantity').notNull(),
    remainingQuantity: quantity('remaining_quantity').notNull(),

    /**
     * Money is stored **exactly**; `cost_per_unit` is derived at PRICE_SCALE and
     * is deliberately not a column — the same reasoning that keeps
     * `positions.avg_cost` out of the schema.
     */
    costTotal: money('cost_total').notNull(),
    remainingCost: money('remaining_cost').notNull(),

    currencyCode: char('currency_code', { length: 3 })
      .notNull()
      .references(() => currencies.code),
    /** The rate on `acquired_on`. Never revalued — that is what makes a currency movement a gain. */
    fxRateToBase: fxRate('fx_rate_to_base').notNull(),
  },
  (t) => [
    index('tax_lots_pos_idx').on(t.userId, t.accountId, t.instrumentId, t.openedOn, t.id),
    index('tax_lots_txn_idx').on(t.openedByTxnId),
    check('tax_lots_original_quantity_positive', sql`${t.originalQuantity} > 0`),
    check('tax_lots_remaining_quantity_non_negative', sql`${t.remainingQuantity} >= 0`),
    check('tax_lots_cost_total_non_negative', sql`${t.costTotal} >= 0`),
    check('tax_lots_remaining_cost_non_negative', sql`${t.remainingCost} >= 0`),
    check('tax_lots_remaining_within_original_qty', sql`${t.remainingQuantity} <= ${t.originalQuantity}`),
    check('tax_lots_remaining_within_original_cost', sql`${t.remainingCost} <= ${t.costTotal}`),
    check('tax_lots_fx_rate_positive', sql`${t.fxRateToBase} > 0`),
    // I-19. Units and basis drain together, which makes "a lot with units but no
    // basis" — and the reverse — unrepresentable rather than merely unlikely.
    check(
      'tax_lots_units_and_basis_drain_together',
      sql`(${t.remainingQuantity} = 0) = (${t.remainingCost} = 0)`,
    ),
  ],
);

export const lotDisposals = pgTable(
  'lot_disposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Denormalised from `tax_lots` so realised P&L over a period is one indexed
     * scan rather than a join. Cascades from `users` by both paths; both are safe.
     */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lotId: uuid('lot_id')
      .notNull()
      .references(() => taxLots.id, { onDelete: 'cascade' }),
    closedByTxnId: uuid('closed_by_txn_id')
      .notNull()
      .references(() => investmentTransactions.id, { onDelete: 'cascade' }),
    closedOn: date('closed_on').notNull(),

    quantity: quantity('quantity').notNull(),
    /**
     * Money, not per-unit rates: proceeds are **allocated** across lots and cost
     * is consumed exactly, so these sum back without residue. A `transfer_out`
     * sets `proceeds = cost_consumed`, so its realised P&L is zero by
     * construction rather than by a subtraction that happens to cancel.
     */
    proceeds: money('proceeds').notNull(),
    costConsumed: money('cost_consumed').notNull(),
    realizedPnl: money('realized_pnl').notNull(),

    /** The rate on `closed_on`. With the lot's acquisition rate this splits P&L into price and FX. */
    fxRateToBase: fxRate('fx_rate_to_base').notNull(),
    baseRealizedPnl: money('base_realized_pnl').notNull(),
    /** Stored; the price component is derived as the difference, so the two always sum (I-18). */
    baseFxComponent: money('base_fx_component').notNull(),

    /** From the lot's `acquired_on`, never from `opened_on`. */
    holdingDays: integer('holding_days').notNull(),
  },
  (t) => [
    index('lot_disposals_user_closed_idx').on(t.userId, t.closedOn.desc(), t.id.desc()),
    index('lot_disposals_lot_idx').on(t.lotId),
    index('lot_disposals_txn_idx').on(t.closedByTxnId),
    check('lot_disposals_quantity_positive', sql`${t.quantity} > 0`),
    check('lot_disposals_cost_consumed_non_negative', sql`${t.costConsumed} >= 0`),
    check('lot_disposals_holding_days_non_negative', sql`${t.holdingDays} >= 0`),
    check('lot_disposals_fx_rate_positive', sql`${t.fxRateToBase} > 0`),
    // I-15. Realised P&L is a derivation of two figures on this row, so the
    // database enforces it rather than trusting the engine.
    check('lot_disposal_pnl_identity', sql`${t.realizedPnl} = ${t.proceeds} - ${t.costConsumed}`),
  ],
);

export const positions = pgTable(
  'positions',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'cascade' }),

    quantity: quantity('quantity').notNull(),
    /** Instrument currency; `= Σ tax_lots.remaining_cost` exactly (I-6). */
    costBasis: money('cost_basis').notNull(),
    /** `Σ (remaining_cost × lot.fx_rate_to_base)`, summed **per lot** (I-17). */
    baseCostBasis: money('base_cost_basis').notNull(),
    realizedPnl: money('realized_pnl').notNull().default('0'),

    /**
     * GROSS declared dividends and interest (I-12). `fees_total` and
     * `taxes_total` hold **only** instrument-attributed amounts: trade fees are
     * already inside `cost_basis` (buys) or `realized_pnl` (sells), and
     * account-level rows have no position to accrue to.
     */
    incomeTotal: money('income_total').notNull().default('0'),
    feesTotal: money('fees_total').notNull().default('0'),
    taxesTotal: money('taxes_total').notNull().default('0'),

    firstTradeOn: date('first_trade_on'),
    lastTradeOn: date('last_trade_on'),

    /**
     * A **provenance** stamp, not a staleness check. Nothing compares it against
     * `user_state.investment_ledger_version` to decide whether to rebuild: that
     * counter is global per user, so after any trade every position but the
     * rebuilt one would look stale forever. Correctness comes from the rebuild
     * sharing the mutation's transaction (ARCHITECTURE.md §6).
     */
    ledgerVersion: bigint('ledger_version', { mode: 'bigint' }).notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.accountId, t.instrumentId] }),
    // "Which accounts hold X", and allocation grouped by instrument. The primary
    // key leads with account_id, so neither is served by it.
    index('positions_instrument_idx').on(t.userId, t.instrumentId),
    // I-7. Shorting is out of scope at launch; when it arrives it becomes a
    // distinct `short_sell` kind rather than a negative position.
    check('positions_quantity_non_negative', sql`${t.quantity} >= 0`),
    check('positions_cost_basis_non_negative', sql`${t.costBasis} >= 0`),
    // The money form of I-19 at position level: a position with units must carry
    // basis, and one with basis must carry units.
    check('positions_units_and_basis_agree', sql`(${t.quantity} = 0) = (${t.costBasis} = 0)`),
  ],
);

// ------------------------------------------------------------------- relations

export const instrumentsRelations = relations(instruments, ({ many, one }) => ({
  transactions: many(investmentTransactions),
  lots: many(taxLots),
  quote: one(instrumentQuotes, {
    fields: [instruments.id],
    references: [instrumentQuotes.instrumentId],
  }),
}));

export const investmentTransactionsRelations = relations(investmentTransactions, ({ one, many }) => ({
  account: one(accounts, {
    fields: [investmentTransactions.accountId],
    references: [accounts.id],
  }),
  instrument: one(instruments, {
    fields: [investmentTransactions.instrumentId],
    references: [instruments.id],
  }),
  openedLots: many(taxLots),
  disposals: many(lotDisposals),
}));

export const taxLotsRelations = relations(taxLots, ({ one, many }) => ({
  instrument: one(instruments, { fields: [taxLots.instrumentId], references: [instruments.id] }),
  account: one(accounts, { fields: [taxLots.accountId], references: [accounts.id] }),
  openedBy: one(investmentTransactions, {
    fields: [taxLots.openedByTxnId],
    references: [investmentTransactions.id],
  }),
  disposals: many(lotDisposals),
}));

export const lotDisposalsRelations = relations(lotDisposals, ({ one }) => ({
  lot: one(taxLots, { fields: [lotDisposals.lotId], references: [taxLots.id] }),
  closedBy: one(investmentTransactions, {
    fields: [lotDisposals.closedByTxnId],
    references: [investmentTransactions.id],
  }),
}));

export const positionsRelations = relations(positions, ({ one }) => ({
  account: one(accounts, { fields: [positions.accountId], references: [accounts.id] }),
  instrument: one(instruments, { fields: [positions.instrumentId], references: [instruments.id] }),
}));

export const instrumentPricesRelations = relations(instrumentPrices, ({ one }) => ({
  instrument: one(instruments, {
    fields: [instrumentPrices.instrumentId],
    references: [instruments.id],
  }),
}));

export const instrumentQuotesRelations = relations(instrumentQuotes, ({ one }) => ({
  instrument: one(instruments, {
    fields: [instrumentQuotes.instrumentId],
    references: [instruments.id],
  }),
}));
