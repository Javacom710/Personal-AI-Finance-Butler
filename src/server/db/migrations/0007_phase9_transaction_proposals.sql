CREATE TYPE "public"."proposal_status" AS ENUM('pending', 'applied', 'rejected', 'expired', 'invalid');--> statement-breakpoint
CREATE TABLE "ai_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text DEFAULT 'transaction' NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"normalized" jsonb,
	"validation_errors" jsonb,
	"status" "proposal_status" DEFAULT 'pending' NOT NULL,
	"applied_entity_id" uuid,
	"applied_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_proposals_transaction_only" CHECK ("ai_proposals"."kind" = 'transaction'),
	CONSTRAINT "ai_proposals_expiry" CHECK ("ai_proposals"."expires_at" = "ai_proposals"."created_at" + interval '24 hours'),
	CONSTRAINT "ai_proposals_applied_fields" CHECK (("ai_proposals"."status" = 'applied') = ("ai_proposals"."applied_at" is not null and "ai_proposals"."applied_entity_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "ai_proposal_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_proposals_pending_idx" ON "ai_proposals" USING btree ("user_id","created_at" DESC NULLS LAST) WHERE "ai_proposals"."status" = 'pending';--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_ai_proposal_id_ai_proposals_id_fk" FOREIGN KEY ("ai_proposal_id") REFERENCES "public"."ai_proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_ai_proposal_uniq" ON "transactions" USING btree ("ai_proposal_id") WHERE "transactions"."ai_proposal_id" is not null;--> statement-breakpoint
-- Commit-time checks permit the ordinary transaction service and its audit to
-- run before the proposal's final CAS, while enforcing I-10 atomically.
CREATE FUNCTION enforce_applied_transaction_proposal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p ai_proposals%ROWTYPE;
BEGIN
  SELECT * INTO p FROM ai_proposals WHERE id = NEW.id;
  IF FOUND AND p.status = 'applied' THEN
    IF p.applied_at >= p.expires_at OR p.applied_at < p.created_at THEN
      RAISE EXCEPTION 'proposal confirmation outside its lifetime' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.user_id = p.user_id AND a.actor = 'ai_confirmed'
      AND a.action = 'ai_proposal.apply' AND a.entity_type = 'ai_proposal' AND a.entity_id = p.id
      AND a.after->>'transactionId' = p.applied_entity_id::text)
      OR NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.user_id = p.user_id AND a.actor = 'ai_confirmed'
      AND a.action = 'transaction.create' AND a.entity_type = 'transaction' AND a.entity_id = p.applied_entity_id
      AND a.after->>'aiProposalId' = p.id::text) THEN
      RAISE EXCEPTION 'applied proposal requires confirmation audit' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ai_proposals_confirmation_audit
AFTER INSERT OR UPDATE ON ai_proposals DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_applied_transaction_proposal();
--> statement-breakpoint
CREATE FUNCTION enforce_transaction_proposal_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ai_proposal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM ai_proposals p WHERE p.id = NEW.ai_proposal_id AND p.user_id = NEW.user_id
      AND p.status = 'applied' AND p.applied_entity_id = NEW.id AND NEW.source = 'ai'
  ) THEN
    RAISE EXCEPTION 'transaction proposal linkage is invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER transactions_proposal_link
AFTER INSERT OR UPDATE ON transactions DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_transaction_proposal_link();
