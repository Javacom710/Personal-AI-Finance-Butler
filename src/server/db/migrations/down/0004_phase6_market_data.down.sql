-- Reverses 0004_phase6_market_data.sql.
--
-- drizzle-kit generates forward migrations only, so every down migration is
-- written by hand and reviewed alongside the migration it reverses
-- (SCHEMA.md §13). `npm run db:rollback` applies the newest one and removes its
-- journal entry; `tests/integration/migrations.test.ts` asserts that
-- migrate -> rollback -> migrate leaves a byte-identical schema fingerprint.
--
-- The forward migration is additive in the strictest sense: one new table, and
-- two new columns on existing tables. It contains no DROP, no TRUNCATE, no
-- RENAME and no ALTER COLUMN, so nothing in Phase 3, 4 or 5 is touched in
-- either direction.
--
-- Rolling back loses the corporate-action detections themselves. That is the
-- ordinary cost of dropping a table, and it is cheap here in a way it is not
-- elsewhere: a detection is **not** financial truth. It is a provider
-- observation that the next `corporate_actions.refresh` re-derives, and the
-- `UNIQUE (instrument_id, kind, ex_date)` makes that re-derivation idempotent.
-- Nothing a user recorded is lost, because an accepted detection has already
-- become an `investment_transactions` row, which this migration never touches
-- (ADR-29).
--
-- Drop order is the reverse of creation: the constraint on a pre-existing table
-- first, then the new table, then the added columns.

ALTER TABLE "settings" DROP CONSTRAINT IF EXISTS "settings_price_stale_sessions_positive";--> statement-breakpoint
DROP TABLE IF EXISTS "corporate_action_detections";--> statement-breakpoint
ALTER TABLE "instrument_prices" DROP COLUMN IF EXISTS "provider_ref";--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN IF EXISTS "price_stale_after_sessions";
