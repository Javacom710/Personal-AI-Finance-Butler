-- Reverses 0002_phase4_investment_engine.sql.
--
-- drizzle-kit generates forward migrations only, so every down migration is
-- written by hand and reviewed alongside the migration it reverses
-- (SCHEMA.md §13). `npm run db:rollback` applies the newest one and removes its
-- journal entry; `tests/integration/migrations.test.ts` asserts that
-- migrate → rollback → migrate leaves an identical schema.
--
-- Drop order is the reverse of creation: dependants before dependencies.
--
-- `recurring_occurrences.investment_transaction_id` is an ADD COLUMN in the
-- forward migration, so its reversal is a DROP COLUMN — the one genuinely
-- destructive statement here. It is safe only because nothing writes the column
-- yet: the `investment` recurring kind is still refused by the service layer.
-- Once a SIP has posted through it, this rollback loses the link between an
-- occurrence and the investment transaction it produced, and the down migration
-- must gain an export step before being run against real data.

DROP TABLE IF EXISTS "lot_disposals";--> statement-breakpoint
DROP TABLE IF EXISTS "tax_lots";--> statement-breakpoint
DROP TABLE IF EXISTS "positions";--> statement-breakpoint
ALTER TABLE "recurring_occurrences" DROP COLUMN IF EXISTS "investment_transaction_id";--> statement-breakpoint
DROP TABLE IF EXISTS "investment_transactions";--> statement-breakpoint
DROP TABLE IF EXISTS "instrument_quotes";--> statement-breakpoint
DROP TABLE IF EXISTS "instrument_prices";--> statement-breakpoint
DROP TABLE IF EXISTS "instruments";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."investment_kind";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."cost_basis_method";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."asset_class";
