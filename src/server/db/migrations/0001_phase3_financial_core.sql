CREATE TYPE "public"."account_kind" AS ENUM('bank', 'cash', 'credit_card', 'wallet', 'brokerage', 'loan', 'other');--> statement-breakpoint
CREATE TYPE "public"."budget_period" AS ENUM('monthly', 'quarterly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."category_kind" AS ENUM('income', 'expense');--> statement-breakpoint
CREATE TYPE "public"."occurrence_status" AS ENUM('pending', 'posted', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."record_source" AS ENUM('manual', 'ai', 'recurring', 'import');--> statement-breakpoint
CREATE TYPE "public"."recurring_kind" AS ENUM('income', 'expense', 'transfer', 'investment');--> statement-breakpoint
CREATE TYPE "public"."transaction_kind" AS ENUM('income', 'expense', 'transfer');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "account_kind" NOT NULL,
	"institution" text,
	"currency_code" char(3) NOT NULL,
	"opening_balance" numeric(20, 4) DEFAULT '0' NOT NULL,
	"opening_date" date NOT NULL,
	"credit_limit" numeric(20, 4),
	"is_active" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_credit_limit_non_negative" CHECK ("accounts"."credit_limit" is null or "accounts"."credit_limit" >= 0),
	CONSTRAINT "accounts_card_has_limit" CHECK ("accounts"."kind" <> 'credit_card' or "accounts"."credit_limit" is not null)
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"period" "budget_period" NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"currency_code" char(3) NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_amount_positive" CHECK ("budgets"."amount" > 0),
	CONSTRAINT "budgets_ends_after_start" CHECK ("budgets"."ends_on" is null or "budgets"."ends_on" > "budgets"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "category_kind" NOT NULL,
	"parent_id" uuid,
	"is_archived" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_user_parent_name_uniq" UNIQUE NULLS NOT DISTINCT("user_id","parent_id","name")
);
--> statement-breakpoint
CREATE TABLE "recurring_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"due_on" date NOT NULL,
	"status" "occurrence_status" DEFAULT 'pending' NOT NULL,
	"transaction_id" uuid,
	"posted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "recurring_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "recurring_kind" NOT NULL,
	"template" jsonb NOT NULL,
	"rrule" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"auto_post" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_rules_ends_after_start" CHECK ("recurring_rules"."ends_on" is null or "recurring_rules"."ends_on" >= "recurring_rules"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"currency_code" char(3) NOT NULL,
	"fx_rate_to_base" numeric(20, 10) NOT NULL,
	"base_amount" numeric(20, 4) NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "tx_entry_amount_non_zero" CHECK ("transaction_entries"."amount" <> 0),
	CONSTRAINT "tx_entry_base_amount_non_zero" CHECK ("transaction_entries"."base_amount" <> 0),
	CONSTRAINT "tx_entry_fx_rate_positive" CHECK ("transaction_entries"."fx_rate_to_base" > 0),
	CONSTRAINT "tx_entry_base_amount_consistent" CHECK ("transaction_entries"."base_amount" = round("transaction_entries"."amount" * "transaction_entries"."fx_rate_to_base", 4))
);
--> statement-breakpoint
CREATE TABLE "transaction_tags" (
	"transaction_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "transaction_tags_transaction_id_tag_id_pk" PRIMARY KEY("transaction_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "transaction_kind" NOT NULL,
	"booked_on" date NOT NULL,
	"description" text NOT NULL,
	"category_id" uuid,
	"notes" text,
	"source" "record_source" DEFAULT 'manual' NOT NULL,
	"recurring_rule_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_transfer_has_no_category" CHECK ("transactions"."kind" <> 'transfer' or "transactions"."category_id" is null)
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_occurrences" ADD CONSTRAINT "recurring_occurrences_rule_id_recurring_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."recurring_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_occurrences" ADD CONSTRAINT "recurring_occurrences_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_entries" ADD CONSTRAINT "transaction_entries_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_entries" ADD CONSTRAINT "transaction_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_entries" ADD CONSTRAINT "transaction_entries_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_tags" ADD CONSTRAINT "transaction_tags_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_tags" ADD CONSTRAINT "transaction_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_rule_id_recurring_rules_id_fk" FOREIGN KEY ("recurring_rule_id") REFERENCES "public"."recurring_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_user_name_uniq" ON "accounts" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "accounts_user_active_idx" ON "accounts" USING btree ("user_id","is_active","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_active_uniq" ON "budgets" USING btree ("user_id","category_id","period") WHERE "budgets"."is_active";--> statement-breakpoint
CREATE INDEX "categories_user_kind_idx" ON "categories" USING btree ("user_id","kind","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_occurrences_rule_due_uniq" ON "recurring_occurrences" USING btree ("rule_id","due_on");--> statement-breakpoint
CREATE INDEX "recurring_occurrences_due_idx" ON "recurring_occurrences" USING btree ("status","due_on");--> statement-breakpoint
CREATE INDEX "recurring_rules_user_active_idx" ON "recurring_rules" USING btree ("user_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_user_name_ci_uniq" ON "tags" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE INDEX "tx_entries_account_idx" ON "transaction_entries" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "tx_entries_txn_idx" ON "transaction_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "transaction_tags_tag_idx" ON "transaction_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "transactions_user_date_idx" ON "transactions" USING btree ("user_id","booked_on" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_category_idx" ON "transactions" USING btree ("user_id","category_id","booked_on");--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Added by hand to the generated file: drizzle-kit does not emit functions or
-- triggers, and SCHEMA.md §4.1 specifies both.
--
-- I-1, I-2 and I-3 (SCHEMA.md §12) live here as well as in the engine. The
-- engine copy exists so the user sees a field-level error; this copy exists so
-- that psql, a restore, or a future script cannot write a shape the engine
-- would have rejected.
--
-- It is a CONSTRAINT TRIGGER, DEFERRABLE INITIALLY DEFERRED, because entries
-- are inserted after their header: an immediate trigger would fire on a
-- transaction that legitimately has no entries yet and reject every write.
-- Deferring to COMMIT means the shape is judged once, complete.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_transaction_shape() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  txn                 transactions%ROWTYPE;
  txn_id              uuid;
  n_entries           integer;
  n_positive          integer;
  n_negative          integer;
  n_accounts          integer;
  n_currencies        integer;
  base_total          numeric(20,4);
  category_kind_value text;
BEGIN
  IF TG_TABLE_NAME = 'transactions' THEN
    txn_id := NEW.id;
  ELSE
    txn_id := COALESCE(NEW.transaction_id, OLD.transaction_id);
  END IF;

  SELECT * INTO txn FROM transactions WHERE id = txn_id;
  IF NOT FOUND THEN
    -- The header was deleted in this same transaction and its entries cascaded
    -- with it. There is no shape left to judge.
    RETURN NULL;
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE amount > 0),
         count(*) FILTER (WHERE amount < 0),
         count(DISTINCT account_id),
         count(DISTINCT currency_code),
         COALESCE(sum(base_amount), 0)
    INTO n_entries, n_positive, n_negative, n_accounts, n_currencies, base_total
    FROM transaction_entries
   WHERE transaction_id = txn_id;

  IF txn.kind = 'income' THEN
    IF n_entries <> 1 THEN
      RAISE EXCEPTION 'I-1: an income transaction must have exactly one entry, found %', n_entries
        USING ERRCODE = 'check_violation';
    END IF;
    IF n_positive <> 1 THEN
      RAISE EXCEPTION 'I-1: the entry of an income transaction must be positive'
        USING ERRCODE = 'check_violation';
    END IF;
    IF txn.category_id IS NULL THEN
      RAISE EXCEPTION 'I-1: an income transaction requires a category'
        USING ERRCODE = 'check_violation';
    END IF;

  ELSIF txn.kind = 'expense' THEN
    IF n_entries <> 1 THEN
      RAISE EXCEPTION 'I-1: an expense transaction must have exactly one entry, found %', n_entries
        USING ERRCODE = 'check_violation';
    END IF;
    IF n_negative <> 1 THEN
      RAISE EXCEPTION 'I-1: the entry of an expense transaction must be negative'
        USING ERRCODE = 'check_violation';
    END IF;
    IF txn.category_id IS NULL THEN
      RAISE EXCEPTION 'I-1: an expense transaction requires a category'
        USING ERRCODE = 'check_violation';
    END IF;

  ELSE
    IF n_entries <> 2 THEN
      RAISE EXCEPTION 'I-1: a transfer must have exactly two entries, found %', n_entries
        USING ERRCODE = 'check_violation';
    END IF;
    IF n_positive <> 1 OR n_negative <> 1 THEN
      RAISE EXCEPTION 'I-1: a transfer must have one negative and one positive entry'
        USING ERRCODE = 'check_violation';
    END IF;
    IF n_accounts <> 2 THEN
      RAISE EXCEPTION 'I-1: a transfer must move between two distinct accounts'
        USING ERRCODE = 'check_violation';
    END IF;
    -- I-3. Cross-currency transfers legitimately leave a residual: it is the
    -- realised FX difference, reported as such rather than absorbed.
    IF n_currencies = 1 AND base_total <> 0 THEN
      RAISE EXCEPTION 'I-3: a same-currency transfer must net to zero in base currency, got %', base_total
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF txn.category_id IS NOT NULL THEN
    SELECT kind::text INTO category_kind_value FROM categories WHERE id = txn.category_id;
    IF category_kind_value IS DISTINCT FROM txn.kind::text THEN
      RAISE EXCEPTION 'I-1: category kind % cannot classify a % transaction', category_kind_value, txn.kind
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER transactions_shape_check
  AFTER INSERT OR UPDATE ON transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_transaction_shape();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER transaction_entries_shape_check
  AFTER INSERT OR UPDATE OR DELETE ON transaction_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_transaction_shape();--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Categories are two levels deep at most and a child shares its parent's kind
-- (SCHEMA.md §4, FINANCIAL-DOMAIN.md §5). Neither is expressible as a CHECK:
-- both need a lookup of another row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_category_shape() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_kind      text;
  parent_parent_id uuid;
  parent_user      uuid;
  child_count      integer;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'a category cannot be its own parent' USING ERRCODE = 'check_violation';
  END IF;

  SELECT kind::text, parent_id, user_id
    INTO parent_kind, parent_parent_id, parent_user
    FROM categories WHERE id = NEW.parent_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'parent category does not exist' USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF parent_user <> NEW.user_id THEN
    RAISE EXCEPTION 'a category cannot be nested under another user''s category'
      USING ERRCODE = 'check_violation';
  END IF;

  IF parent_parent_id IS NOT NULL THEN
    RAISE EXCEPTION 'categories are limited to two levels (parent and child)'
      USING ERRCODE = 'check_violation';
  END IF;

  IF parent_kind <> NEW.kind::text THEN
    RAISE EXCEPTION 'a child category must share its parent''s kind (% under %)', NEW.kind, parent_kind
      USING ERRCODE = 'check_violation';
  END IF;

  -- Moving a parent under another parent would make its own children depth 3.
  SELECT count(*) INTO child_count FROM categories WHERE parent_id = NEW.id;
  IF child_count > 0 THEN
    RAISE EXCEPTION 'a category that has children cannot itself become a child'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER categories_shape_check
  BEFORE INSERT OR UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION check_category_shape();
