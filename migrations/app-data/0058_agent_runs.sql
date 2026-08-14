CREATE TYPE "overlay_agent_run_mode" AS ENUM ('chat', 'work');
CREATE TYPE "overlay_agent_run_runner" AS ENUM ('tool_loop', 'workflow');
CREATE TYPE "overlay_agent_run_status" AS ENUM (
  'queued',
  'running',
  'waiting_for_approval',
  'completed',
  'failed',
  'cancelled'
);

CREATE TABLE "agent_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "conversation_id" text NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "turn_id" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "user_message_id" text NOT NULL REFERENCES "conversation_messages"("id") ON DELETE CASCADE,
  "assistant_message_id" text NOT NULL REFERENCES "conversation_messages"("id") ON DELETE CASCADE,
  "mode" "overlay_agent_run_mode" NOT NULL,
  "runner" "overlay_agent_run_runner" NOT NULL,
  "status" "overlay_agent_run_status" NOT NULL,
  "variant_index" integer,
  "workflow_run_id" text,
  "lease_expires_at" timestamptz,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "failed_at" timestamptz,
  "cancelled_at" timestamptz,
  "terminal_error" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX "agent_runs_conversation_created_idx" ON "agent_runs" ("conversation_id", "created_at");
CREATE INDEX "agent_runs_conversation_status_updated_idx" ON "agent_runs" ("conversation_id", "status", "updated_at");
CREATE INDEX "agent_runs_user_created_idx" ON "agent_runs" ("user_id", "created_at");
CREATE INDEX "agent_runs_runner_status_lease_idx" ON "agent_runs" ("runner", "status", "lease_expires_at");
CREATE UNIQUE INDEX "agent_runs_assistant_message_idx" ON "agent_runs" ("assistant_message_id");
CREATE UNIQUE INDEX "agent_runs_turn_variant_idx" ON "agent_runs" ("conversation_id", "turn_id", COALESCE("variant_index", -1));
