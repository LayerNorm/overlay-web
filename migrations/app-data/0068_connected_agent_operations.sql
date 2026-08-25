CREATE INDEX IF NOT EXISTS "agent_remote_sessions_workspace_status_idx"
  ON "agent_remote_sessions" USING btree ("workspace_id", "status");

ALTER TABLE "agent_enrollment_sessions"
  ADD COLUMN IF NOT EXISTS "max_environments" integer;

CREATE INDEX IF NOT EXISTS "agent_environments_status_seen_idx"
  ON "agent_environments" USING btree ("status", "last_seen_at");

CREATE INDEX IF NOT EXISTS "agent_run_commands_status_updated_idx"
  ON "agent_run_commands" USING btree ("status", "updated_at");

CREATE INDEX IF NOT EXISTS "agent_approval_requests_requested_idx"
  ON "agent_approval_requests" USING btree ("requested_at");

CREATE TABLE IF NOT EXISTS "agent_event_rate_windows" (
  "environment_id" text NOT NULL,
  "window_started_at" timestamp with time zone NOT NULL,
  "event_count" integer DEFAULT 0 NOT NULL,
  "workspace_id" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "agent_event_rate_windows_environment_id_agent_environments_id_fk"
    FOREIGN KEY ("environment_id") REFERENCES "public"."agent_environments"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "agent_event_rate_windows_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "agent_event_rate_windows_environment_started_pk"
    PRIMARY KEY ("environment_id", "window_started_at")
);

CREATE INDEX IF NOT EXISTS "agent_event_rate_windows_workspace_started_idx"
  ON "agent_event_rate_windows" USING btree ("workspace_id", "window_started_at");

CREATE INDEX IF NOT EXISTS "agent_event_rate_windows_started_idx"
  ON "agent_event_rate_windows" USING btree ("window_started_at");

CREATE TABLE IF NOT EXISTS "agent_sandbox_settlements" (
  "reservation_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "environment_id" text NOT NULL,
  "run_id" text NOT NULL,
  "lease_id" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "settled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "agent_sandbox_settlements_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "agent_sandbox_settlements_environment_id_agent_environments_id_fk"
    FOREIGN KEY ("environment_id") REFERENCES "public"."agent_environments"("id") ON DELETE cascade,
  CONSTRAINT "agent_sandbox_settlements_run_id_agent_runs_id_fk"
    FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade,
  CONSTRAINT "agent_sandbox_settlements_lease_id_agent_sandbox_leases_id_fk"
    FOREIGN KEY ("lease_id") REFERENCES "public"."agent_sandbox_leases"("id") ON DELETE cascade
);

CREATE INDEX IF NOT EXISTS "agent_sandbox_settlements_status_updated_idx"
  ON "agent_sandbox_settlements" USING btree ("status", "updated_at");

CREATE INDEX IF NOT EXISTS "agent_sandbox_settlements_workspace_idx"
  ON "agent_sandbox_settlements" USING btree ("workspace_id");
