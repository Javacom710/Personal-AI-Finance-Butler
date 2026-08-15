/**
 * Net worth — the two entities that appear only here (SCHEMA.md §7, §8).
 *
 * **Phase 5 adds exactly two sources of financial truth, and both are
 * append-only series rather than mutable fields.** Everything else net worth
 * touches, it reads: account balances come from the money ledger, investment
 * cost basis from `tax_lots`/`lot_disposals`. Net worth is an aggregation, not a
 * ledger ([NET-WORTH-DESIGN.md](../../../../docs/NET-WORTH-DESIGN.md)).
 *
 * Three rules shape every table below, and each was a defect in the reviewed
 * baseline before the Phase 5 correction pass:
 *
 * 1. **A valuation is a time series, not a field.** `manual_assets` carries no
 *    `current_value` and `liabilities` no `outstanding`, for exactly the reason
 *    `accounts` carries no `current_balance`: a stored derivation is a second
 *    figure free to drift, and updating one in place retroactively rewrites
 *    every historical figure derived from it.
 * 2. **A series row carries no `currency_code`.** It is denominated in its
 *    parent's currency, and a stored copy could disagree with it with no
 *    cross-table `CHECK` able to notice (finding N11).
 * 3. **Dates decide eligibility, flags decide nothing.** `disposed_on` is what a
 *    calculation reads; `is_active` is a UI convenience derived from it and is
 *    read by no calculation at all ([ADR-26](../../../../docs/DECISIONS.md), invariant I-26).
 *
 * `net_worth_snapshots` is deliberately **absent**: net worth is derived on
 * demand, and the snapshot table is Phase 6 work if measurement ever justifies
 * it ([ADR-24](../../../../docs/DECISIONS.md)).
 */

import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { liabilityKind, manualAssetKind } from './enums';
import { accounts } from './money';
import { currencies } from './reference';
import { users } from './identity';

/** `numeric(20,4)` — the money column shape fixed by ADR-04. Read as a string, never a float. */
const money = (name: string) => numeric(name, { precision: 20, scale: 4 });

// ---------------------------------------------------------------- manual assets

export const manualAssets = pgTable(
  'manual_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    kind: manualAssetKind('kind').notNull(),

    /** Every `asset_valuations` row for this asset is denominated in it. */
    currencyCode: char('currency_code', { length: 3 })
      .notNull()
      .references(() => currencies.code),

    acquiredOn: date('acquired_on'),
    acquisitionCost: money('acquisition_cost'),

    /**
     * Point-in-time net worth needs a DATE, not a flag: an asset disposed today
     * must still appear in last year's figure (FINANCIAL-DOMAIN.md §9.3).
     * `is_active` is derived from this for the UI and is never an input to a
     * calculation (I-26).
     */
    disposedOn: date('disposed_on'),
    isActive: boolean('is_active').notNull().default(true),

    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Parity with `accounts`. Two rows named "Flat" are almost always one
    // duplicate entry, and a duplicated manual asset is a silent double count
    // the schema CAN prevent — unlike gold held as both metal and an ETF.
    uniqueIndex('manual_assets_user_name_uniq').on(t.userId, t.name),
    // Every as-of query filters on disposal.
    index('manual_assets_user_disposed_idx').on(t.userId, t.disposedOn),
    check(
      'manual_assets_disposed_after_acquired',
      sql`${t.disposedOn} is null or ${t.acquiredOn} is null or ${t.disposedOn} >= ${t.acquiredOn}`,
    ),
    check(
      'manual_assets_acquisition_cost_non_negative',
      sql`${t.acquisitionCost} is null or ${t.acquisitionCost} >= 0`,
    ),
  ],
);

export const assetValuations = pgTable(
  'asset_valuations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * SCHEMA.md's own convention, and the precedent `lot_disposals.user_id` set
     * in the Phase 4 review: without it every as-of query joins through the
     * parent merely to establish ownership (finding N12).
     */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => manualAssets.id, { onDelete: 'cascade' }),

    asOf: date('as_of').notNull(),
    value: money('value').notNull(),

    // NO currency_code. A valuation is denominated in its ASSET's currency;
    // storing it again would be a second figure free to disagree with the first,
    // and no cross-table CHECK could stop it (finding N11).
    source: text('source').notNull().default('manual'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One valuation per asset per day (FINANCIAL-DOMAIN.md §12 case 24).
    unique('asset_valuations_asset_as_of_uniq').on(t.assetId, t.asOf),
    // `valuationInForce` is "the greatest as_of <= T". This makes it a seek.
    index('asset_valuations_lookup_idx').on(t.userId, t.assetId, t.asOf.desc()),
    check('asset_valuations_value_non_negative', sql`${t.value} >= 0`),
  ],
);

// ------------------------------------------------------------------ liabilities

export const liabilities = pgTable(
  'liabilities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    kind: liabilityKind('kind').notNull(),

    /**
     * The double-count guard (invariant I-8). Set → this row contributes
     * **nothing** to net worth and `liability_balances` is ignored entirely; the
     * linked account contributes, by sign. Null → the balance series is
     * authoritative and no account represents this debt.
     *
     * `RESTRICT`, not `SET NULL`: nulling it silently converts a TRANSACTED
     * liability into a SCHEDULED one with no balance rows, which then
     * contributes zero and the debt vanishes (finding N9). Accounts carrying
     * ledger history already cannot be deleted, so this costs nothing.
     *
     * The linked account must be of kind `credit_card` or `loan` (I-27) — a
     * cross-table rule, so it is a service guard plus an integrity check rather
     * than a `CHECK`.
     */
    linkedAccountId: uuid('linked_account_id').references(() => accounts.id, {
      onDelete: 'restrict',
    }),

    /** Every `liability_balances` row for this liability is denominated in it. */
    currencyCode: char('currency_code', { length: 3 })
      .notNull()
      .references(() => currencies.code),

    principalOriginal: money('principal_original'),

    /**
     * DESCRIPTIVE ONLY. Nothing computes an amortisation schedule from these,
     * and the UI must not imply one (FINANCIAL-DOMAIN.md §9.4). The change
     * bridge splits principal from interest only where the user recorded both.
     */
    interestRate: numeric('interest_rate', { precision: 12, scale: 8 }),
    emiAmount: money('emi_amount'),
    startedOn: date('started_on'),
    endsOn: date('ends_on'),

    isActive: boolean('is_active').notNull().default(true),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('liabilities_user_name_uniq').on(t.userId, t.name),
    // Two liabilities cannot claim one account (I-8). A partial unique index
    // rather than a plain UNIQUE, so any number of scheduled liabilities may
    // carry NULL — Postgres would allow that either way, but stating it as
    // partial documents that NULL is the ordinary case, not an exception.
    uniqueIndex('liabilities_linked_account_uniq')
      .on(t.linkedAccountId)
      .where(sql`${t.linkedAccountId} is not null`),
    index('liabilities_user_active_idx').on(t.userId, t.isActive),
    check(
      'liabilities_interest_rate_non_negative',
      sql`${t.interestRate} is null or ${t.interestRate} >= 0`,
    ),
    check(
      'liabilities_principal_non_negative',
      sql`${t.principalOriginal} is null or ${t.principalOriginal} >= 0`,
    ),
    check('liabilities_emi_non_negative', sql`${t.emiAmount} is null or ${t.emiAmount} >= 0`),
    check('liabilities_ends_after_start', sql`${t.endsOn} is null or ${t.startedOn} is null or ${t.endsOn} >= ${t.startedOn}`),
  ],
);

export const liabilityBalances = pgTable(
  'liability_balances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    liabilityId: uuid('liability_id')
      .notNull()
      .references(() => liabilities.id, { onDelete: 'cascade' }),

    asOf: date('as_of').notNull(),
    /**
     * The magnitude owed, always non-negative. Net worth applies the sign; a
     * liability that stored a negative outstanding would be an asset wearing the
     * wrong table.
     */
    outstanding: money('outstanding').notNull(),

    // NO currency_code — it is the LIABILITY's, for the same reason as
    // asset_valuations (finding N11).
    source: text('source').notNull().default('manual'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('liability_balances_liability_as_of_uniq').on(t.liabilityId, t.asOf),
    index('liability_balances_lookup_idx').on(t.userId, t.liabilityId, t.asOf.desc()),
    check('liability_balances_outstanding_non_negative', sql`${t.outstanding} >= 0`),
  ],
);

// ------------------------------------------------------------------- relations

export const manualAssetsRelations = relations(manualAssets, ({ one, many }) => ({
  user: one(users, { fields: [manualAssets.userId], references: [users.id] }),
  valuations: many(assetValuations),
}));

export const assetValuationsRelations = relations(assetValuations, ({ one }) => ({
  asset: one(manualAssets, { fields: [assetValuations.assetId], references: [manualAssets.id] }),
}));

export const liabilitiesRelations = relations(liabilities, ({ one, many }) => ({
  user: one(users, { fields: [liabilities.userId], references: [users.id] }),
  linkedAccount: one(accounts, {
    fields: [liabilities.linkedAccountId],
    references: [accounts.id],
  }),
  balances: many(liabilityBalances),
}));

export const liabilityBalancesRelations = relations(liabilityBalances, ({ one }) => ({
  liability: one(liabilities, {
    fields: [liabilityBalances.liabilityId],
    references: [liabilities.id],
  }),
}));
