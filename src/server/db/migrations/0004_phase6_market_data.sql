CREATE TABLE "corporate_action_detections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"kind" "investment_kind" NOT NULL,
	"ex_date" date NOT NULL,
	"ratio_num" integer NOT NULL,
	"ratio_den" integer NOT NULL,
	"source" text NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_txn_id" uuid,
	"dismissed_at" timestamp with time zone,
	CONSTRAINT "corporate_action_detections_uniq" UNIQUE("instrument_id","kind","ex_date"),
	CONSTRAINT "cad_kind_is_corporate_action" CHECK ("corporate_action_detections"."kind" in ('split','bonus')),
	CONSTRAINT "cad_ratio_positive" CHECK ("corporate_action_detections"."ratio_num" > 0 and "corporate_action_detections"."ratio_den" > 0)
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "price_stale_after_sessions" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "instrument_prices" ADD COLUMN "provider_ref" text;--> statement-breakpoint
ALTER TABLE "corporate_action_detections" ADD CONSTRAINT "corporate_action_detections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_action_detections" ADD CONSTRAINT "corporate_action_detections_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_action_detections" ADD CONSTRAINT "corporate_action_detections_resolved_txn_id_investment_transactions_id_fk" FOREIGN KEY ("resolved_txn_id") REFERENCES "public"."investment_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "corporate_action_detections_open_idx" ON "corporate_action_detections" USING btree ("user_id","instrument_id") WHERE "corporate_action_detections"."resolved_txn_id" is null and "corporate_action_detections"."dismissed_at" is null;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_price_stale_sessions_positive" CHECK ("settings"."price_stale_after_sessions" > 0);