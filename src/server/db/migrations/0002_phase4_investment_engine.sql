CREATE TYPE "public"."asset_class" AS ENUM('equity', 'mutual_fund', 'etf', 'bond', 'fixed_deposit', 'gold', 'crypto', 'cash_equivalent', 'other');--> statement-breakpoint
CREATE TYPE "public"."cost_basis_method" AS ENUM('fifo', 'average', 'specific_id');--> statement-breakpoint
CREATE TYPE "public"."investment_kind" AS ENUM('buy', 'sell', 'dividend', 'interest', 'fee', 'tax', 'bonus', 'split', 'mf_purchase', 'mf_redemption', 'transfer_in', 'transfer_out');--> statement-breakpoint
CREATE TABLE "instrument_prices" (
	"instrument_id" uuid NOT NULL,
	"as_of" date NOT NULL,
	"close" numeric(20, 8) NOT NULL,
	"currency_code" char(3) NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instrument_prices_instrument_id_as_of_pk" PRIMARY KEY("instrument_id","as_of"),
	CONSTRAINT "instrument_prices_close_non_negative" CHECK ("instrument_prices"."close" >= 0)
);
--> statement-breakpoint
CREATE TABLE "instrument_quotes" (
	"instrument_id" uuid PRIMARY KEY NOT NULL,
	"price" numeric(20, 8) NOT NULL,
	"currency_code" char(3) NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instrument_quotes_price_non_negative" CHECK ("instrument_quotes"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "instruments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"exchange" text,
	"isin" text,
	"name" text NOT NULL,
	"asset_class" "asset_class" NOT NULL,
	"currency_code" char(3) NOT NULL,
	"country" char(2),
	"price_provider" text,
	"provider_symbol" text,
	"cost_basis_method" "cost_basis_method" DEFAULT 'fifo' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instruments_user_symbol_exchange_uniq" UNIQUE NULLS NOT DISTINCT("user_id","symbol","exchange")
);
--> statement-breakpoint
CREATE TABLE "investment_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"instrument_id" uuid,
	"kind" "investment_kind" NOT NULL,
	"trade_date" date NOT NULL,
	"settlement_date" date,
	"quantity" numeric(28, 8),
	"price" numeric(20, 8),
	"gross_amount" numeric(20, 4),
	"fees" numeric(20, 4) DEFAULT '0' NOT NULL,
	"taxes" numeric(20, 4) DEFAULT '0' NOT NULL,
	"currency_code" char(3) NOT NULL,
	"net_amount_instrument" numeric(20, 4) NOT NULL,
	"fx_rate_instrument_to_account" numeric(20, 10) NOT NULL,
	"net_amount" numeric(20, 4) NOT NULL,
	"fx_rate_to_base" numeric(20, 10) NOT NULL,
	"base_net_amount" numeric(20, 4) NOT NULL,
	"ratio_num" integer,
	"ratio_den" integer,
	"original_acquired_on" date,
	"cash_settled" boolean DEFAULT true NOT NULL,
	"notes" text,
	"source" "record_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inv_txn_fees_non_negative" CHECK ("investment_transactions"."fees" >= 0),
	CONSTRAINT "inv_txn_taxes_non_negative" CHECK ("investment_transactions"."taxes" >= 0),
	CONSTRAINT "inv_txn_fx_instrument_positive" CHECK ("investment_transactions"."fx_rate_instrument_to_account" > 0),
	CONSTRAINT "inv_txn_fx_base_positive" CHECK ("investment_transactions"."fx_rate_to_base" > 0),
	CONSTRAINT "inv_txn_acquire_shape" CHECK ("investment_transactions"."kind" not in ('buy','mf_purchase','transfer_in') or ("investment_transactions"."quantity" > 0 and "investment_transactions"."price" is not null)),
	CONSTRAINT "inv_txn_dispose_shape" CHECK ("investment_transactions"."kind" not in ('sell','mf_redemption','transfer_out') or ("investment_transactions"."quantity" < 0 and "investment_transactions"."price" is not null)),
	CONSTRAINT "inv_txn_acquisition_has_cost" CHECK ("investment_transactions"."kind" not in ('buy','mf_purchase','transfer_in')
          or "investment_transactions"."gross_amount" + "investment_transactions"."fees" + "investment_transactions"."taxes" > 0),
	CONSTRAINT "inv_txn_ratio_shape" CHECK ("investment_transactions"."kind" not in ('split','bonus') or ("investment_transactions"."ratio_num" > 0 and "investment_transactions"."ratio_den" > 0 and "investment_transactions"."cash_settled" = false)),
	CONSTRAINT "inv_txn_income_identity" CHECK ("investment_transactions"."kind" not in ('dividend','interest')
          or ("investment_transactions"."net_amount_instrument" > 0 and "investment_transactions"."gross_amount" is not null
              and "investment_transactions"."net_amount_instrument" = "investment_transactions"."gross_amount" - "investment_transactions"."fees" - "investment_transactions"."taxes")),
	CONSTRAINT "inv_txn_fee_is_negative" CHECK ("investment_transactions"."kind" <> 'fee' or "investment_transactions"."net_amount_instrument" < 0),
	CONSTRAINT "inv_txn_tax_is_negative" CHECK ("investment_transactions"."kind" <> 'tax' or "investment_transactions"."net_amount_instrument" < 0),
	CONSTRAINT "inv_txn_instrument_required" CHECK ("investment_transactions"."instrument_id" is not null or "investment_transactions"."kind" in ('fee','tax','interest')),
	CONSTRAINT "inv_txn_unsettled_moves_no_cash" CHECK ("investment_transactions"."cash_settled" or ("investment_transactions"."net_amount" = 0 and "investment_transactions"."net_amount_instrument" = 0)),
	CONSTRAINT "inv_txn_gross_identity" CHECK ("investment_transactions"."kind" not in ('buy','sell','mf_purchase','mf_redemption','transfer_in','transfer_out')
          or "investment_transactions"."gross_amount" = round(abs("investment_transactions"."quantity") * "investment_transactions"."price", 4)),
	CONSTRAINT "inv_txn_buy_net_identity" CHECK ("investment_transactions"."kind" not in ('buy','mf_purchase')
          or "investment_transactions"."net_amount_instrument" = -("investment_transactions"."gross_amount" + "investment_transactions"."fees" + "investment_transactions"."taxes")),
	CONSTRAINT "inv_txn_sell_net_identity" CHECK ("investment_transactions"."kind" not in ('sell','mf_redemption')
          or "investment_transactions"."net_amount_instrument" = "investment_transactions"."gross_amount" - "investment_transactions"."fees" - "investment_transactions"."taxes"),
	CONSTRAINT "inv_txn_transfer_no_cash" CHECK ("investment_transactions"."kind" not in ('transfer_in','transfer_out')
          or ("investment_transactions"."net_amount" = 0 and "investment_transactions"."net_amount_instrument" = 0 and "investment_transactions"."fees" = 0 and "investment_transactions"."taxes" = 0)),
	CONSTRAINT "inv_txn_corporate_action_shape" CHECK ("investment_transactions"."kind" not in ('split','bonus')
          or ("investment_transactions"."quantity" is null and "investment_transactions"."price" is null and "investment_transactions"."gross_amount" is null
              and "investment_transactions"."net_amount" = 0 and "investment_transactions"."net_amount_instrument" = 0
              and "investment_transactions"."fees" = 0 and "investment_transactions"."taxes" = 0)),
	CONSTRAINT "inv_txn_ratio_only_on_corporate_actions" CHECK ("investment_transactions"."kind" in ('split','bonus') or ("investment_transactions"."ratio_num" is null and "investment_transactions"."ratio_den" is null)),
	CONSTRAINT "inv_txn_original_acquired_only_on_transfer_in" CHECK ("investment_transactions"."kind" = 'transfer_in' or "investment_transactions"."original_acquired_on" is null),
	CONSTRAINT "inv_txn_original_acquired_not_in_future" CHECK ("investment_transactions"."original_acquired_on" is null or "investment_transactions"."original_acquired_on" <= "investment_transactions"."trade_date"),
	CONSTRAINT "inv_txn_account_amount_consistent" CHECK ("investment_transactions"."net_amount" = round("investment_transactions"."net_amount_instrument" * "investment_transactions"."fx_rate_instrument_to_account", 4)),
	CONSTRAINT "inv_txn_base_amount_consistent" CHECK ("investment_transactions"."base_net_amount" = round("investment_transactions"."net_amount" * "investment_transactions"."fx_rate_to_base", 4))
);
--> statement-breakpoint
CREATE TABLE "lot_disposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"closed_by_txn_id" uuid NOT NULL,
	"closed_on" date NOT NULL,
	"quantity" numeric(28, 8) NOT NULL,
	"proceeds" numeric(20, 4) NOT NULL,
	"cost_consumed" numeric(20, 4) NOT NULL,
	"realized_pnl" numeric(20, 4) NOT NULL,
	"fx_rate_to_base" numeric(20, 10) NOT NULL,
	"base_realized_pnl" numeric(20, 4) NOT NULL,
	"base_fx_component" numeric(20, 4) NOT NULL,
	"holding_days" integer NOT NULL,
	CONSTRAINT "lot_disposals_quantity_positive" CHECK ("lot_disposals"."quantity" > 0),
	CONSTRAINT "lot_disposals_cost_consumed_non_negative" CHECK ("lot_disposals"."cost_consumed" >= 0),
	CONSTRAINT "lot_disposals_holding_days_non_negative" CHECK ("lot_disposals"."holding_days" >= 0),
	CONSTRAINT "lot_disposals_fx_rate_positive" CHECK ("lot_disposals"."fx_rate_to_base" > 0),
	CONSTRAINT "lot_disposal_pnl_identity" CHECK ("lot_disposals"."realized_pnl" = "lot_disposals"."proceeds" - "lot_disposals"."cost_consumed")
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"quantity" numeric(28, 8) NOT NULL,
	"cost_basis" numeric(20, 4) NOT NULL,
	"base_cost_basis" numeric(20, 4) NOT NULL,
	"realized_pnl" numeric(20, 4) DEFAULT '0' NOT NULL,
	"income_total" numeric(20, 4) DEFAULT '0' NOT NULL,
	"fees_total" numeric(20, 4) DEFAULT '0' NOT NULL,
	"taxes_total" numeric(20, 4) DEFAULT '0' NOT NULL,
	"first_trade_on" date,
	"last_trade_on" date,
	"ledger_version" bigint NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "positions_user_id_account_id_instrument_id_pk" PRIMARY KEY("user_id","account_id","instrument_id"),
	CONSTRAINT "positions_quantity_non_negative" CHECK ("positions"."quantity" >= 0),
	CONSTRAINT "positions_cost_basis_non_negative" CHECK ("positions"."cost_basis" >= 0),
	CONSTRAINT "positions_units_and_basis_agree" CHECK (("positions"."quantity" = 0) = ("positions"."cost_basis" = 0))
);
--> statement-breakpoint
CREATE TABLE "tax_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"opened_by_txn_id" uuid NOT NULL,
	"opened_on" date NOT NULL,
	"acquired_on" date NOT NULL,
	"original_quantity" numeric(28, 8) NOT NULL,
	"remaining_quantity" numeric(28, 8) NOT NULL,
	"cost_total" numeric(20, 4) NOT NULL,
	"remaining_cost" numeric(20, 4) NOT NULL,
	"currency_code" char(3) NOT NULL,
	"fx_rate_to_base" numeric(20, 10) NOT NULL,
	CONSTRAINT "tax_lots_original_quantity_positive" CHECK ("tax_lots"."original_quantity" > 0),
	CONSTRAINT "tax_lots_remaining_quantity_non_negative" CHECK ("tax_lots"."remaining_quantity" >= 0),
	CONSTRAINT "tax_lots_cost_total_non_negative" CHECK ("tax_lots"."cost_total" >= 0),
	CONSTRAINT "tax_lots_remaining_cost_non_negative" CHECK ("tax_lots"."remaining_cost" >= 0),
	CONSTRAINT "tax_lots_remaining_within_original_qty" CHECK ("tax_lots"."remaining_quantity" <= "tax_lots"."original_quantity"),
	CONSTRAINT "tax_lots_remaining_within_original_cost" CHECK ("tax_lots"."remaining_cost" <= "tax_lots"."cost_total"),
	CONSTRAINT "tax_lots_fx_rate_positive" CHECK ("tax_lots"."fx_rate_to_base" > 0),
	CONSTRAINT "tax_lots_units_and_basis_drain_together" CHECK (("tax_lots"."remaining_quantity" = 0) = ("tax_lots"."remaining_cost" = 0))
);
--> statement-breakpoint
ALTER TABLE "recurring_occurrences" ADD COLUMN "investment_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "instrument_prices" ADD CONSTRAINT "instrument_prices_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instrument_prices" ADD CONSTRAINT "instrument_prices_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instrument_quotes" ADD CONSTRAINT "instrument_quotes_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instrument_quotes" ADD CONSTRAINT "instrument_quotes_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_transactions" ADD CONSTRAINT "investment_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_transactions" ADD CONSTRAINT "investment_transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_transactions" ADD CONSTRAINT "investment_transactions_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_transactions" ADD CONSTRAINT "investment_transactions_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_disposals" ADD CONSTRAINT "lot_disposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_disposals" ADD CONSTRAINT "lot_disposals_lot_id_tax_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."tax_lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_disposals" ADD CONSTRAINT "lot_disposals_closed_by_txn_id_investment_transactions_id_fk" FOREIGN KEY ("closed_by_txn_id") REFERENCES "public"."investment_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_lots" ADD CONSTRAINT "tax_lots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_lots" ADD CONSTRAINT "tax_lots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_lots" ADD CONSTRAINT "tax_lots_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_lots" ADD CONSTRAINT "tax_lots_opened_by_txn_id_investment_transactions_id_fk" FOREIGN KEY ("opened_by_txn_id") REFERENCES "public"."investment_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_lots" ADD CONSTRAINT "tax_lots_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "instruments_isin_idx" ON "instruments" USING btree ("user_id","isin") WHERE "instruments"."isin" is not null;--> statement-breakpoint
CREATE INDEX "instruments_user_active_idx" ON "instruments" USING btree ("user_id","is_active","asset_class");--> statement-breakpoint
CREATE INDEX "inv_txn_replay_idx" ON "investment_transactions" USING btree ("user_id","account_id","instrument_id","trade_date","created_at","id");--> statement-breakpoint
CREATE INDEX "inv_txn_user_date_idx" ON "investment_transactions" USING btree ("user_id","trade_date" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "inv_txn_instrument_idx" ON "investment_transactions" USING btree ("user_id","instrument_id","trade_date");--> statement-breakpoint
CREATE INDEX "lot_disposals_user_closed_idx" ON "lot_disposals" USING btree ("user_id","closed_on" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "lot_disposals_lot_idx" ON "lot_disposals" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "lot_disposals_txn_idx" ON "lot_disposals" USING btree ("closed_by_txn_id");--> statement-breakpoint
CREATE INDEX "positions_instrument_idx" ON "positions" USING btree ("user_id","instrument_id");--> statement-breakpoint
CREATE INDEX "tax_lots_pos_idx" ON "tax_lots" USING btree ("user_id","account_id","instrument_id","opened_on","id");--> statement-breakpoint
CREATE INDEX "tax_lots_txn_idx" ON "tax_lots" USING btree ("opened_by_txn_id");--> statement-breakpoint
ALTER TABLE "recurring_occurrences" ADD CONSTRAINT "recurring_occurrences_investment_transaction_id_investment_transactions_id_fk" FOREIGN KEY ("investment_transaction_id") REFERENCES "public"."investment_transactions"("id") ON DELETE set null ON UPDATE no action;