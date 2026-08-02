-- Phase 8 extends the Phase 6 sharing policy row into the full workspace policy
-- record: who may create what, how long guests last, which agent runtimes and
-- budgets are allowed, how long channel history is kept, and which rollout stage
-- the workspace is in. Every column is nullable or defaulted so existing
-- workspaces keep today's behavior until an owner changes it.
ALTER TABLE "workspace_sharing_policies"
  ADD COLUMN "member_can_create_channels" boolean DEFAULT true NOT NULL,
  ADD COLUMN "member_can_create_agents" boolean DEFAULT true NOT NULL,
  ADD COLUMN "member_can_invite" boolean DEFAULT false NOT NULL,
  ADD COLUMN "guest_expiration_days" integer,
  ADD COLUMN "allowed_agent_harnesses" text[] DEFAULT NULL,
  ADD COLUMN "agent_run_budget_cents" integer,
  ADD COLUMN "channel_retention_days" integer,
  ADD COLUMN "legal_hold" boolean DEFAULT false NOT NULL,
  ADD COLUMN "data_residency" text,
  ADD COLUMN "rollout_stage" text DEFAULT 'general' NOT NULL,
  ADD CONSTRAINT "workspace_sharing_policies_rollout_stage_check"
    CHECK ("rollout_stage" IN ('dogfood', 'invited', 'general')),
  ADD CONSTRAINT "workspace_sharing_policies_guest_expiration_check"
    CHECK ("guest_expiration_days" IS NULL OR "guest_expiration_days" BETWEEN 1 AND 365),
  ADD CONSTRAINT "workspace_sharing_policies_retention_check"
    CHECK ("channel_retention_days" IS NULL OR "channel_retention_days" BETWEEN 1 AND 3650),
  ADD CONSTRAINT "workspace_sharing_policies_budget_check"
    CHECK ("agent_run_budget_cents" IS NULL OR "agent_run_budget_cents" >= 0);
--> statement-breakpoint

-- Provider-neutral SSO/SCIM identity mapping. External directory identity is
-- mapped to a workspace principal here; identity-provider claims are never the
-- authorization source of truth.
CREATE TABLE "workspace_identity_mappings" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "principal_id" text NOT NULL,
  "directory" text NOT NULL,
  "external_id" text NOT NULL,
  "external_group_ids" text[] DEFAULT '{}'::text[] NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "deprovisioned_at" timestamptz,
  CONSTRAINT "workspace_identity_mappings_principal_fk"
    FOREIGN KEY ("workspace_id", "principal_id")
    REFERENCES "workspace_principals"("workspace_id", "id") ON DELETE CASCADE,
  CONSTRAINT "workspace_identity_mappings_status_check"
    CHECK ("status" IN ('active', 'deprovisioned')),
  CONSTRAINT "workspace_identity_mappings_state_check"
    CHECK (("status" = 'deprovisioned') = ("deprovisioned_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_identity_mappings_external_idx"
  ON "workspace_identity_mappings" ("workspace_id", "directory", "external_id");
--> statement-breakpoint
CREATE INDEX "workspace_identity_mappings_principal_idx"
  ON "workspace_identity_mappings" ("workspace_id", "principal_id");
--> statement-breakpoint

-- Immutable audit export cursor. Exports are append-only reads; recording the
-- watermark lets an operator prove which events an export covered.
CREATE TABLE "workspace_audit_exports" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "requested_by_principal_id" text NOT NULL,
  "from_recorded_at" timestamptz,
  "to_recorded_at" timestamptz NOT NULL,
  "event_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_audit_exports_principal_fk"
    FOREIGN KEY ("workspace_id", "requested_by_principal_id")
    REFERENCES "workspace_principals"("workspace_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "workspace_audit_exports_workspace_idx"
  ON "workspace_audit_exports" ("workspace_id", "created_at");
--> statement-breakpoint

INSERT INTO overlay_app_data_metadata (key, value, updated_at)
VALUES ('schema_version', '38', now())
ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
--> statement-breakpoint
