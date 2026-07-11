DO $$ BEGIN
  CREATE TYPE "public"."overlay_memory_extraction_status" AS ENUM('running', 'succeeded', 'failed', 'skipped');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "embedding_model_version" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memory_extraction_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "conversation_id" text NOT NULL,
  "message_id" text NOT NULL,
  "turn_id" text NOT NULL,
  "status" "overlay_memory_extraction_status" NOT NULL,
  "model_id" text,
  "attempts" integer DEFAULT 1 NOT NULL,
  "extracted_count" integer DEFAULT 0 NOT NULL,
  "inserted_count" integer DEFAULT 0 NOT NULL,
  "duplicate_count" integer DEFAULT 0 NOT NULL,
  "reason" text,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "memory_extraction_runs" ADD CONSTRAINT "memory_extraction_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
  ALTER TABLE "memory_extraction_runs" ADD CONSTRAINT "memory_extraction_runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade;
  ALTER TABLE "memory_extraction_runs" ADD CONSTRAINT "memory_extraction_runs_message_id_conversation_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE cascade;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "memory_extraction_runs_user_conversation_turn_idx" ON "memory_extraction_runs" USING btree ("user_id", "conversation_id", "turn_id");
CREATE INDEX IF NOT EXISTS "memory_extraction_runs_status_updated_idx" ON "memory_extraction_runs" USING btree ("status", "updated_at");
CREATE INDEX IF NOT EXISTS "memory_extraction_runs_user_created_idx" ON "memory_extraction_runs" USING btree ("user_id", "created_at");
