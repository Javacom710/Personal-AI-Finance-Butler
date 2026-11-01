-- Reverses 0006_phase8_ai_model_evaluations.sql.
--
-- Written by hand, like every down migration (SCHEMA.md §13), and checked by
-- tests/integration/migrations.test.ts: migrate -> rollback -> migrate must
-- leave a byte-identical schema fingerprint.
--
-- The forward migration adds one table and touches nothing else. Rolling back
-- loses the stored model measurements; the runtime then falls back to the
-- declared capability matrix, and `npm run ai:eval` can measure again. Nothing
-- financial depends on them.

DROP TABLE IF EXISTS "ai_model_evaluations";
