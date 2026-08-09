-- Reverses 0000_phase2_foundation.sql.
--
-- drizzle-kit generates forward migrations only, so every down migration is
-- written by hand and reviewed alongside the migration it reverses
-- (SCHEMA.md §13). `npm run db:rollback` applies the newest one and removes its
-- journal entry; `tests/integration/migrations.test.ts` asserts that
-- migrate → rollback → migrate leaves an identical schema.
--
-- Drop order is the reverse of creation: dependants before dependencies.
-- The citext extension is deliberately left in place — dropping an extension
-- another database object might use is not a safe reversal.

DROP TABLE IF EXISTS "jobs";--> statement-breakpoint
DROP TABLE IF EXISTS "audit_log";--> statement-breakpoint
DROP TABLE IF EXISTS "user_state";--> statement-breakpoint
DROP TABLE IF EXISTS "settings";--> statement-breakpoint
DROP TABLE IF EXISTS "fx_rates";--> statement-breakpoint
DROP TABLE IF EXISTS "currencies";--> statement-breakpoint
DROP TABLE IF EXISTS "auth_events";--> statement-breakpoint
DROP TABLE IF EXISTS "sessions";--> statement-breakpoint
DROP TABLE IF EXISTS "users";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."job_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."auth_event_kind";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."audit_actor";
