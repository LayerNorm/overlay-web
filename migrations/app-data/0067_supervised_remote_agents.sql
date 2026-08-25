ALTER TABLE "agent_approval_requests"
  ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'permission';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_artifacts" (
  "id" text PRIMARY KEY,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "environment_id" text NOT NULL REFERENCES "agent_environments"("id") ON DELETE CASCADE,
  "run_id" text NOT NULL REFERENCES "agent_runs"("id") ON DELETE CASCADE,
  "remote_session_id" text NOT NULL REFERENCES "agent_remote_sessions"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "media_type" text NOT NULL,
  "size" bigint NOT NULL,
  "sha256" text NOT NULL,
  "object_key" text NOT NULL UNIQUE,
  "status" text NOT NULL,
  "scan_result" text,
  "expires_at" timestamptz NOT NULL,
  "linked_at" timestamptz,
  "deleted_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_artifacts_run_status_idx" ON "agent_artifacts" ("run_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_artifacts_cleanup_idx" ON "agent_artifacts" ("status", "expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_artifacts_workspace_environment_idx" ON "agent_artifacts" ("workspace_id", "environment_id");
