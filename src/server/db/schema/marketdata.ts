/**
 * Corporate-action detections (SCHEMA.md §5.1,
 * [ADR-29](../../../../docs/DECISIONS.md#adr-29--provider-corporate-actions-are-detections-never-ledger-writes)).
 *
 * **This table is not part of the ledger, and that separation is the point.** A
 * `split` or `bonus` row in `investment_transactions` drives `replay()`, and
 * therefore every tax lot, every position, every realised-P&L figure and every
 * historical valuation in the system. A market-data provider may never write
 * one — the same rule, for the same reason, as the AI mutation rule in
 * `CLAUDE.md`: an external source's interpretation must pass through
 * deterministic validation and user confirmation before it becomes a financial
 * fact.
 *
 * So a provider's corporate action lands here, as a **detection**. It becomes a
 * ledger row only when the user accepts it, through the ordinary validated
 * service path, and that acceptance is what stamps `resolved_txn_id`
 * (invariant **I-40**).
 *
 * The second half of the rule is what makes it safe rather than merely tidy.
 * Between an ex-date and the moment the user records the action, the provider's
 * price is post-split while the ledger's quantity is not:
 *
 * ```
 * observed = 100 units (pre-split) × ₹200 (post-split) = ₹20,000
 * correct  = 500 units             × ₹200              = ₹1,00,000
 * ```
 *
 * An 80% phantom loss, internally consistent everywhere it appears. An **open**
 * detection whose `ex_date` falls inside the holding period therefore
 * *suppresses* that instrument's market value rather than adjusting it.
 *
 * `ratio_num` / `ratio_den` mirror `investment_transactions` exactly, so an
 * accepted detection maps onto a proposed ledger row with no translation step
 * where an inversion could creep in.
 */

import { relations, sql } from 'drizzle-orm';
import { check, date, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { investmentKind } from './enums';
import { instruments, investmentTransactions } from './investments';
import { users } from './identity';

export const corporateActionDetections = pgTable(
  'corporate_action_detections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'cascade' }),

    /** Reuses the ledger's own enum, constrained to the two members that carry a ratio. */
    kind: investmentKind('kind').notNull(),
    exDate: date('ex_date').notNull(),
    ratioNum: integer('ratio_num').notNull(),
    ratioDen: integer('ratio_den').notNull(),

    source: text('source').notNull(),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Written **only** by the validated service path when the user accepts the
     * detection. No adapter and no job may set it (I-40, asserted by a source
     * scan and an integration test).
     */
    resolvedTxnId: uuid('resolved_txn_id').references(() => investmentTransactions.id, {
      onDelete: 'set null',
    }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  },
  (t) => [
    // Only the two kinds that carry a ratio. A `dividend` detection would have
    // no ratio to store and no valuation hazard to guard against.
    check('cad_kind_is_corporate_action', sql`${t.kind} in ('split','bonus')`),
    check('cad_ratio_positive', sql`${t.ratioNum} > 0 and ${t.ratioDen} > 0`),
    // Makes weekly re-detection idempotent: the same split found ten times is
    // one row, so nothing accumulates and no duplicate suppresses twice.
    unique('corporate_action_detections_uniq').on(t.instrumentId, t.kind, t.exDate),
    // The suppression check runs on every valuation, and only open detections
    // matter — a partial index keeps it cheap as resolved rows accumulate.
    index('corporate_action_detections_open_idx')
      .on(t.userId, t.instrumentId)
      .where(sql`${t.resolvedTxnId} is null and ${t.dismissedAt} is null`),
  ],
);

export const corporateActionDetectionsRelations = relations(corporateActionDetections, ({ one }) => ({
  instrument: one(instruments, {
    fields: [corporateActionDetections.instrumentId],
    references: [instruments.id],
  }),
  resolvedTxn: one(investmentTransactions, {
    fields: [corporateActionDetections.resolvedTxnId],
    references: [investmentTransactions.id],
  }),
}));
