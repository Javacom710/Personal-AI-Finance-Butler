-- Reverses 0001_phase3_financial_core.sql.
--
-- drizzle-kit generates forward migrations only, so every down migration is
-- written by hand and reviewed alongside the migration it reverses
-- (SCHEMA.md §13). `npm run db:rollback` applies the newest one and removes its
-- journal entry; `tests/integration/migrations.test.ts` asserts that
-- migrate → rollback → migrate leaves an identical schema.
--
-- Drop order is the reverse of creation: dependants before dependencies. The
-- triggers go with their tables, but the functions do not — dropping a table
-- does not drop a function, so each is named explicitly.

DROP TABLE IF EXISTS "transaction_tags";--> statement-breakpoint
DROP TABLE IF EXISTS "transaction_entries";--> statement-breakpoint
DROP TABLE IF EXISTS "recurring_occurrences";--> statement-breakpoint
DROP TABLE IF EXISTS "budgets";--> statement-breakpoint
DROP TABLE IF EXISTS "transactions";--> statement-breakpoint
DROP TABLE IF EXISTS "recurring_rules";--> statement-breakpoint
DROP TABLE IF EXISTS "tags";--> statement-breakpoint
DROP TABLE IF EXISTS "categories";--> statement-breakpoint
DROP TABLE IF EXISTS "accounts";--> statement-breakpoint
DROP FUNCTION IF EXISTS check_transaction_shape();--> statement-breakpoint
DROP FUNCTION IF EXISTS check_category_shape();--> statement-breakpoint
DROP TYPE IF EXISTS "public"."transaction_kind";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."recurring_kind";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."record_source";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."occurrence_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."category_kind";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."budget_period";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."account_kind";
