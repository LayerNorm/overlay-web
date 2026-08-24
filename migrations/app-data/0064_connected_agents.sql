ALTER TYPE "overlay_agent_run_runner" ADD VALUE IF NOT EXISTS 'remote';
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "initiator_principal_id" text;
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "environment_id" text;
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "binding_id" text;
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "remote_session_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_environment_created_idx" ON "agent_runs" ("environment_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_environments" (
  "id" text PRIMARY KEY, "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "kind" text NOT NULL, "name" text NOT NULL, "status" text NOT NULL, "public_key" text,
  "host_version" text, "platform" text, "capabilities" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "last_seen_at" timestamptz, "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_environments_workspace_status_idx" ON "agent_environments" ("workspace_id", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_bindings" (
  "id" text PRIMARY KEY, "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "agent_id" text NOT NULL, "environment_id" text NOT NULL REFERENCES "agent_environments"("id") ON DELETE CASCADE,
  "protocol_adapter" text NOT NULL, "adapter_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "enabled" boolean NOT NULL DEFAULT true, "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("workspace_id", "agent_id", "environment_id", "protocol_adapter")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_bindings_environment_idx" ON "agent_bindings" ("environment_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_remote_sessions" (
  "id" text PRIMARY KEY, "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "environment_id" text NOT NULL REFERENCES "agent_environments"("id") ON DELETE CASCADE,
  "binding_id" text NOT NULL REFERENCES "agent_bindings"("id") ON DELETE CASCADE,
  "run_id" text NOT NULL UNIQUE REFERENCES "agent_runs"("id") ON DELETE CASCADE, "remote_session_id" text,
  "status" text NOT NULL, "command_cursor" bigint NOT NULL DEFAULT 0, "event_cursor" bigint NOT NULL DEFAULT 0,
  "capability_snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb, "started_at" timestamptz, "ended_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_remote_sessions_environment_status_idx" ON "agent_remote_sessions" ("environment_id", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_run_commands" (
  "id" text PRIMARY KEY, "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "environment_id" text NOT NULL REFERENCES "agent_environments"("id") ON DELETE CASCADE,
  "run_id" text NOT NULL REFERENCES "agent_runs"("id") ON DELETE CASCADE, "type" text NOT NULL,
  "sequence" bigint NOT NULL, "payload" jsonb NOT NULL DEFAULT '{}'::jsonb, "status" text NOT NULL,
  "claimed_at" timestamptz, "claim_expires_at" timestamptz, "acknowledged_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("environment_id", "sequence")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_run_commands_claim_idx" ON "agent_run_commands" ("environment_id", "status", "sequence");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_run_commands_run_idx" ON "agent_run_commands" ("run_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_approval_requests" (
  "id" text PRIMARY KEY, "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "run_id" text NOT NULL REFERENCES "agent_runs"("id") ON DELETE CASCADE,
  "remote_session_id" text NOT NULL REFERENCES "agent_remote_sessions"("id") ON DELETE CASCADE,
  "request_key" text NOT NULL, "prompt" text NOT NULL, "options" jsonb NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb, "requested_at" timestamptz NOT NULL,
  "resolution" jsonb, UNIQUE ("remote_session_id", "request_key")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_approval_requests_workspace_run_idx" ON "agent_approval_requests" ("workspace_id", "run_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_sandbox_leases" (
  "id" text PRIMARY KEY, "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "environment_id" text NOT NULL REFERENCES "agent_environments"("id") ON DELETE CASCADE,
  "run_id" text REFERENCES "agent_runs"("id") ON DELETE SET NULL, "provider" text NOT NULL,
  "provider_reference" text, "status" text NOT NULL, "reservation_id" text,
  "reserved_until" timestamptz NOT NULL, "runtime_started_at" timestamptz, "runtime_ended_at" timestamptz,
  "usage" jsonb NOT NULL DEFAULT '{}'::jsonb, "cleanup_attempts" integer NOT NULL DEFAULT 0,
  "cleanup_after" timestamptz, "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_sandbox_leases_cleanup_idx" ON "agent_sandbox_leases" ("status", "cleanup_after");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_sandbox_leases_workspace_environment_idx" ON "agent_sandbox_leases" ("workspace_id", "environment_id");
