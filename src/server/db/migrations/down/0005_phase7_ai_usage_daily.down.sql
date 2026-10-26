-- Reverses 0005_phase7_ai_usage_daily.sql.
--
-- Written by hand, like every down migration (SCHEMA.md §13), and checked by
-- tests/integration/migrations.test.ts: migrate -> rollback -> migrate must
-- leave a byte-identical schema fingerprint.
--
-- The forward migration adds one table and touches nothing else. Rolling back
-- loses the daily AI usage counts, which resets today's budget — the same
-- effect a new day has, and nothing financial depends on them.

DROP TABLE IF EXISTS "ai_usage_daily";
