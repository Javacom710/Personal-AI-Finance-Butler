CREATE TYPE "public"."ai_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TABLE "ai_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "ai_conversations_revision" CHECK ("ai_conversations"."revision" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"role" "ai_role" NOT NULL,
	"content" jsonb NOT NULL,
	"task" text,
	"tier" smallint,
	"model" text,
	"fallback_depth" smallint DEFAULT 0 NOT NULL,
	"finish_reason" text,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"cost_micros" bigint,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_messages_position_unique" UNIQUE("conversation_id","position"),
	CONSTRAINT "ai_messages_position_role" CHECK ("ai_messages"."position" between 0 and 199 and (("ai_messages"."role" = 'user' and "ai_messages"."position" % 2 = 0) or ("ai_messages"."role" = 'assistant' and "ai_messages"."position" % 2 = 1))),
	CONSTRAINT "ai_messages_tier" CHECK ("ai_messages"."tier" is null or "ai_messages"."tier" between 1 and 5),
	CONSTRAINT "ai_messages_nonnegative" CHECK ("ai_messages"."fallback_depth" >= 0 and ("ai_messages"."prompt_tokens" is null or "ai_messages"."prompt_tokens" >= 0) and ("ai_messages"."completion_tokens" is null or "ai_messages"."completion_tokens" >= 0) and ("ai_messages"."latency_ms" is null or "ai_messages"."latency_ms" >= 0) and ("ai_messages"."cost_micros" is null or "ai_messages"."cost_micros" >= 0))
);
--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_conversations_user_idx" ON "ai_conversations" USING btree ("user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_messages_model_idx" ON "ai_messages" USING btree ("model","created_at" DESC NULLS LAST);