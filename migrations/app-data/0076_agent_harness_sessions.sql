CREATE TABLE IF NOT EXISTS "agent_harness_sessions" (
  "id" text PRIMARY KEY, "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "binding_id" text NOT NULL REFERENCES "agent_bindings"("id") ON DELETE CASCADE,
  "conversation_id" text NOT NULL, "harness_id" text NOT NULL, "session_id" text,
  "resume_state" jsonb, "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("binding_id", "conversation_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_harness_sessions_workspace_idx" ON "agent_harness_sessions" ("workspace_id");
