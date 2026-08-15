-- Reverses 0003_phase5_net_worth.sql.
--
-- drizzle-kit generates forward migrations only, so every down migration is
-- written by hand and reviewed alongside the migration it reverses
-- (SCHEMA.md §13). `npm run db:rollback` applies the newest one and removes its
-- journal entry; `tests/integration/migrations.test.ts` asserts that
-- migrate → rollback → migrate leaves an identical schema.
--
-- Drop order is the reverse of creation: dependants before dependencies.
--
-- Unlike 0002, this reversal contains **no ALTER TABLE and no DROP COLUMN**.
-- The forward migration is purely additive — four new tables, two new enums,
-- and their own indexes and foreign keys — so nothing in Phase 3 or Phase 4 is
-- touched in either direction. Rolling back loses the manual assets and
-- liabilities themselves, which is the ordinary cost of dropping a table that
-- holds user data, and nothing else.
--
-- Net worth needs no reversal of its own: it is derived on demand and stores
-- nothing (ADR-24). There is no `net_worth_snapshots` to drop.

DROP TABLE IF EXISTS "liability_balances";--> statement-breakpoint
DROP TABLE IF EXISTS "liabilities";--> statement-breakpoint
DROP TABLE IF EXISTS "asset_valuations";--> statement-breakpoint
DROP TABLE IF EXISTS "manual_assets";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."liability_kind";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."manual_asset_kind";
