CREATE TABLE "ai_model_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model" text NOT NULL,
	"tier" smallint NOT NULL,
	"eval_version" integer NOT NULL,
	"suite" text NOT NULL,
	"cases_total" integer NOT NULL,
	"cases_passed" integer NOT NULL,
	"score" numeric(5, 4) NOT NULL,
	"p50_latency_ms" integer,
	"p95_latency_ms" integer,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_model_evaluations_model_eval_version_suite_run_at_key" UNIQUE("model","eval_version","suite","run_at"),
	CONSTRAINT "ai_model_evaluations_tier_check" CHECK ("ai_model_evaluations"."tier" BETWEEN 1 AND 5),
	CONSTRAINT "ai_model_evaluations_score_check" CHECK ("ai_model_evaluations"."score" >= 0 AND "ai_model_evaluations"."score" <= 1),
	CONSTRAINT "ai_model_evaluations_cases_check" CHECK ("ai_model_evaluations"."cases_passed" >= 0 AND "ai_model_evaluations"."cases_passed" <= "ai_model_evaluations"."cases_total")
);
--> statement-breakpoint
CREATE INDEX "ai_model_eval_latest_idx" ON "ai_model_evaluations" USING btree ("model","suite","run_at" DESC NULLS LAST);