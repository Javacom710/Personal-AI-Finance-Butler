CREATE TYPE "public"."liability_kind" AS ENUM('home_loan', 'auto_loan', 'personal_loan', 'student_loan', 'credit_card', 'other');--> statement-breakpoint
CREATE TYPE "public"."manual_asset_kind" AS ENUM('property', 'vehicle', 'gold_physical', 'collectible', 'receivable', 'other');--> statement-breakpoint
CREATE TABLE "asset_valuations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"as_of" date NOT NULL,
	"value" numeric(20, 4) NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_valuations_asset_as_of_uniq" UNIQUE("asset_id","as_of"),
	CONSTRAINT "asset_valuations_value_non_negative" CHECK ("asset_valuations"."value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "liabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "liability_kind" NOT NULL,
	"linked_account_id" uuid,
	"currency_code" char(3) NOT NULL,
	"principal_original" numeric(20, 4),
	"interest_rate" numeric(12, 8),
	"emi_amount" numeric(20, 4),
	"started_on" date,
	"ends_on" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "liabilities_interest_rate_non_negative" CHECK ("liabilities"."interest_rate" is null or "liabilities"."interest_rate" >= 0),
	CONSTRAINT "liabilities_principal_non_negative" CHECK ("liabilities"."principal_original" is null or "liabilities"."principal_original" >= 0),
	CONSTRAINT "liabilities_emi_non_negative" CHECK ("liabilities"."emi_amount" is null or "liabilities"."emi_amount" >= 0),
	CONSTRAINT "liabilities_ends_after_start" CHECK ("liabilities"."ends_on" is null or "liabilities"."started_on" is null or "liabilities"."ends_on" >= "liabilities"."started_on")
);
--> statement-breakpoint
CREATE TABLE "liability_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"liability_id" uuid NOT NULL,
	"as_of" date NOT NULL,
	"outstanding" numeric(20, 4) NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "liability_balances_liability_as_of_uniq" UNIQUE("liability_id","as_of"),
	CONSTRAINT "liability_balances_outstanding_non_negative" CHECK ("liability_balances"."outstanding" >= 0)
);
--> statement-breakpoint
CREATE TABLE "manual_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "manual_asset_kind" NOT NULL,
	"currency_code" char(3) NOT NULL,
	"acquired_on" date,
	"acquisition_cost" numeric(20, 4),
	"disposed_on" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manual_assets_disposed_after_acquired" CHECK ("manual_assets"."disposed_on" is null or "manual_assets"."acquired_on" is null or "manual_assets"."disposed_on" >= "manual_assets"."acquired_on"),
	CONSTRAINT "manual_assets_acquisition_cost_non_negative" CHECK ("manual_assets"."acquisition_cost" is null or "manual_assets"."acquisition_cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "asset_valuations" ADD CONSTRAINT "asset_valuations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_valuations" ADD CONSTRAINT "asset_valuations_asset_id_manual_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."manual_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liabilities" ADD CONSTRAINT "liabilities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liabilities" ADD CONSTRAINT "liabilities_linked_account_id_accounts_id_fk" FOREIGN KEY ("linked_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liabilities" ADD CONSTRAINT "liabilities_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liability_balances" ADD CONSTRAINT "liability_balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liability_balances" ADD CONSTRAINT "liability_balances_liability_id_liabilities_id_fk" FOREIGN KEY ("liability_id") REFERENCES "public"."liabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_assets" ADD CONSTRAINT "manual_assets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_assets" ADD CONSTRAINT "manual_assets_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_valuations_lookup_idx" ON "asset_valuations" USING btree ("user_id","asset_id","as_of" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "liabilities_user_name_uniq" ON "liabilities" USING btree ("user_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "liabilities_linked_account_uniq" ON "liabilities" USING btree ("linked_account_id") WHERE "liabilities"."linked_account_id" is not null;--> statement-breakpoint
CREATE INDEX "liabilities_user_active_idx" ON "liabilities" USING btree ("user_id","is_active");--> statement-breakpoint
CREATE INDEX "liability_balances_lookup_idx" ON "liability_balances" USING btree ("user_id","liability_id","as_of" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "manual_assets_user_name_uniq" ON "manual_assets" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "manual_assets_user_disposed_idx" ON "manual_assets" USING btree ("user_id","disposed_on");