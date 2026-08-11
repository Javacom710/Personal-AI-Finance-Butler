/**
 * The money core (SCHEMA.md §4).
 *
 * Two properties are load-bearing here and are worth stating before the code:
 *
 * 1. **There is no `accounts.current_balance` column, and there never will be**
 *    ([FINANCIAL-DOMAIN.md §3](../../../../docs/FINANCIAL-DOMAIN.md)). A balance
 *    is `opening_balance + Σ ledger entries`, computed on read. `opening_balance`
 *    is not an exception: it is the declared position *before* the ledger begins
 *    and nothing updates it after creation.
 *
 * 2. **`transactions` carries no amount column at all** (ADR-05). Every figure
 *    lives in `transaction_entries.amount`, so a header and its entries cannot
 *    disagree — the header holds no number to disagree with.
 *
 * One column named in SCHEMA.md is deliberately still absent until the table it
 * points at exists: `transactions.ai_proposal_id` (Phase 7). A foreign key to a
 * table that does not exist cannot be written, and building the column ahead of
 * its referent would put an unreviewed half of a later phase into this one.
 * `recurring_occurrences.investment_transaction_id` was in that position until
 * Phase 4 created `investment_transactions`; it now carries its foreign key.
 */

import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  type AnyPgColumn,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  accountKind,
  budgetPeriod,
  categoryKind,
  occurrenceStatus,
  recordSource,
  recurringKind,
  transactionKind,
} from './enums';
import { currencies } from './reference';
import { users } from './identity';
// Circular by necessity: an investment transaction belongs to an `accounts` row,
// and a recurring occurrence may have produced one. Both directions are behind
// drizzle's lazy `references(() => …)` thunks, so neither module dereferences
// the other while it is still evaluating.
import { investmentTransactions } from './investments';

/** `numeric(20,4)` — the money column shape fixed by ADR-04. Read as a string, never a float. */
const money = (name: string) => numeric(name, { precision: 20, scale: 4 });

/** `numeric(20,10)` — an FX rate. */
const fxRate = (name: string) => numeric(name, { precision: 20, scale: 10 });

// --------------------------------------------------------------------- accounts

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    kind: accountKind('kind').notNull(),
    institution: text('institution'),

    currencyCode: char('currency_code', { length: 3 })
      .notNull()
      .references(() => currencies.code),

    /** The only stored money figure on an account: the position before the ledger begins. */
    openingBalance: money('opening_balance').notNull().default('0'),
    openingDate: date('opening_date').notNull(),

    /** Credit available is `credit_limit - abs(balance)` and is never an asset. */
    creditLimit: money('credit_limit'),

    isActive: boolean('is_active').notNull().default(true),
    displayOrder: integer('display_order').notNull().default(0),
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('accounts_user_name_uniq').on(t.userId, t.name),
    index('accounts_user_active_idx').on(t.userId, t.isActive, t.displayOrder),
    check('accounts_credit_limit_non_negative', sql`${t.creditLimit} is null or ${t.creditLimit} >= 0`),
    // A card without a limit cannot report available credit, and the accounts
    // page would have to render a blank where a figure belongs.
    check('accounts_card_has_limit', sql`${t.kind} <> 'credit_card' or ${t.creditLimit} is not null`),
  ],
);

// ------------------------------------------------------------------ categories

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    kind: categoryKind('kind').notNull(),

    /**
     * Two levels maximum, and a child's `kind` must match its parent's. Both are
     * enforced by the `check_category_shape()` trigger as well as by the engine —
     * depth is not something a `CHECK` can express.
     */
    // `AnyPgColumn` is required on a self-reference: without it the table's type
    // refers to itself while being inferred, and every column collapses to `any`.
    parentId: uuid('parent_id').references((): AnyPgColumn => categories.id, {
      onDelete: 'restrict',
    }),

    isArchived: boolean('is_archived').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // NULLS NOT DISTINCT: without it two top-level categories could share a name,
    // because Postgres treats each NULL parent_id as distinct. Expressed as a
    // constraint rather than an index because that is where drizzle exposes it.
    unique('categories_user_parent_name_uniq')
      .on(t.userId, t.parentId, t.name)
      .nullsNotDistinct(),
    index('categories_user_kind_idx').on(t.userId, t.kind, t.sortOrder),
  ],
);

// ------------------------------------------------------------------------ tags

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Case-insensitive uniqueness: `Travel` and `travel` are one tag. A plain
    // UNIQUE (user_id, name) would let both exist and silently split reports.
    uniqueIndex('tags_user_name_ci_uniq').on(t.userId, sql`lower(${t.name})`),
  ],
);

// ---------------------------------------------------------- recurring (rules)

/**
 * Defined before `transactions` because a posted transaction points back at the
 * rule that produced it.
 */
export const recurringRules = pgTable(
  'recurring_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    kind: recurringKind('kind').notNull(),

    /** Validated by Zod on the way in: accounts, amount, category, description. */
    template: jsonb('template').notNull(),

    /** RFC 5545 subset: FREQ, INTERVAL, BYMONTHDAY, BYDAY, COUNT, UNTIL. */
    rrule: text('rrule').notNull(),

    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on'),

    /** Default false: an amount that varies (a utility bill) must be confirmed. */
    autoPost: boolean('auto_post').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('recurring_rules_user_active_idx').on(t.userId, t.isActive),
    check('recurring_rules_ends_after_start', sql`${t.endsOn} is null or ${t.endsOn} >= ${t.startsOn}`),
  ],
);

// ---------------------------------------------------- transactions and entries

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    kind: transactionKind('kind').notNull(),
    bookedOn: date('booked_on').notNull(),
    description: text('description').notNull(),

    /** RESTRICT: a category in use cannot be deleted. Archive it instead. */
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'restrict' }),

    notes: text('notes'),
    source: recordSource('source').notNull().default('manual'),

    recurringRuleId: uuid('recurring_rule_id').references(() => recurringRules.id, {
      onDelete: 'set null',
    }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('transactions_user_date_idx').on(t.userId, t.bookedOn.desc(), t.id.desc()),
    index('transactions_category_idx').on(t.userId, t.categoryId, t.bookedOn),
    // I-2. Structural, not conventional: a transfer has no category column value
    // to leak into category reporting.
    check('transactions_transfer_has_no_category', sql`${t.kind} <> 'transfer' or ${t.categoryId} is null`),
  ],
);

export const transactionEntries = pgTable(
  'transaction_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),

    /** RESTRICT: an account with ledger history cannot be deleted, only closed. */
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),

    /** Signed, in the account's currency. `> 0` means money entered the account. */
    amount: money('amount').notNull(),
    currencyCode: char('currency_code', { length: 3 })
      .notNull()
      .references(() => currencies.code),

    fxRateToBase: fxRate('fx_rate_to_base').notNull(),
    baseAmount: money('base_amount').notNull(),

    sortOrder: smallint('sort_order').notNull().default(0),
  },
  (t) => [
    index('tx_entries_account_idx').on(t.accountId),
    index('tx_entries_txn_idx').on(t.transactionId),
    check('tx_entry_amount_non_zero', sql`${t.amount} <> 0`),
    check('tx_entry_base_amount_non_zero', sql`${t.baseAmount} <> 0`),
    check('tx_entry_fx_rate_positive', sql`${t.fxRateToBase} > 0`),
    // I-11. base_amount is a STORED DERIVATION of amount x fx_rate_to_base
    // (ADR-12). Without this CHECK it is a second money figure free to drift
    // from the first. round() on numeric is immutable, so the database can
    // enforce it — and round() on numeric rounds halves away from zero, which
    // is exactly what mulRate(_, _, 'half_up') does in the engine.
    check(
      'tx_entry_base_amount_consistent',
      sql`${t.baseAmount} = round(${t.amount} * ${t.fxRateToBase}, 4)`,
    ),
  ],
);

export const transactionTags = pgTable(
  'transaction_tags',
  {
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.transactionId, t.tagId] }), index('transaction_tags_tag_idx').on(t.tagId)],
);

// --------------------------------------------------------------------- budgets

export const budgets = pgTable(
  'budgets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),

    period: budgetPeriod('period').notNull(),
    amount: money('amount').notNull(),
    currencyCode: char('currency_code', { length: 3 })
      .notNull()
      .references(() => currencies.code),

    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on'),
    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One active budget per (category, period). Two would make "the" budget
    // ambiguous, and every report would have to pick one arbitrarily.
    uniqueIndex('budgets_active_uniq')
      .on(t.userId, t.categoryId, t.period)
      .where(sql`${t.isActive}`),
    check('budgets_amount_positive', sql`${t.amount} > 0`),
    check('budgets_ends_after_start', sql`${t.endsOn} is null or ${t.endsOn} > ${t.startsOn}`),
  ],
);

// --------------------------------------------------- recurring (occurrences)

export const recurringOccurrences = pgTable(
  'recurring_occurrences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => recurringRules.id, { onDelete: 'cascade' }),

    dueOn: date('due_on').notNull(),
    status: occurrenceStatus('status').notNull().default('pending'),

    transactionId: uuid('transaction_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),

    /**
     * A recurring SIP posts into the **investment** ledger, not the money one
     * ([INVESTMENT-ENGINE-DESIGN.md §10.1](../../../../docs/INVESTMENT-ENGINE-DESIGN.md)).
     * An occurrence therefore points at whichever ledger produced it. The
     * `investment` recurring kind is still refused by the service layer, so
     * nothing writes this column yet — but the constraint exists from the moment
     * its referent does, rather than being added later against live rows.
     */
    investmentTransactionId: uuid('investment_transaction_id').references(
      (): AnyPgColumn => investmentTransactions.id,
      { onDelete: 'set null' },
    ),

    postedAt: timestamp('posted_at', { withTimezone: true }),
  },
  (t) => [
    // ADR-15: the idempotency key. A retried job, a duplicate cron fire, or a
    // clock adjustment cannot double-post the rent.
    uniqueIndex('recurring_occurrences_rule_due_uniq').on(t.ruleId, t.dueOn),
    index('recurring_occurrences_due_idx').on(t.status, t.dueOn),
  ],
);

// ------------------------------------------------------------------- relations

export const accountsRelations = relations(accounts, ({ many }) => ({
  entries: many(transactionEntries),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: 'category_parent',
  }),
  children: many(categories, { relationName: 'category_parent' }),
  transactions: many(transactions),
}));

export const transactionsRelations = relations(transactions, ({ one, many }) => ({
  category: one(categories, { fields: [transactions.categoryId], references: [categories.id] }),
  entries: many(transactionEntries),
  tags: many(transactionTags),
}));

export const transactionEntriesRelations = relations(transactionEntries, ({ one }) => ({
  transaction: one(transactions, {
    fields: [transactionEntries.transactionId],
    references: [transactions.id],
  }),
  account: one(accounts, { fields: [transactionEntries.accountId], references: [accounts.id] }),
}));

export const transactionTagsRelations = relations(transactionTags, ({ one }) => ({
  transaction: one(transactions, {
    fields: [transactionTags.transactionId],
    references: [transactions.id],
  }),
  tag: one(tags, { fields: [transactionTags.tagId], references: [tags.id] }),
}));

export const recurringRulesRelations = relations(recurringRules, ({ many }) => ({
  occurrences: many(recurringOccurrences),
}));

export const recurringOccurrencesRelations = relations(recurringOccurrences, ({ one }) => ({
  rule: one(recurringRules, {
    fields: [recurringOccurrences.ruleId],
    references: [recurringRules.id],
  }),
  transaction: one(transactions, {
    fields: [recurringOccurrences.transactionId],
    references: [transactions.id],
  }),
}));
