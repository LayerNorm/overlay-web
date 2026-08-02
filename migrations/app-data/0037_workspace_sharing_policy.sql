-- Workspace-level sharing policy. Phase 6 governs General access (public links);
-- later phases extend this row with guest expiry, retention, and agent budgets.
-- Absent rows mean "workspace default", so existing deployments keep behaving
-- exactly as they do today until an owner or admin changes the policy.
CREATE TABLE "workspace_sharing_policies" (
  "workspace_id" text PRIMARY KEY NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "public_links_enabled" boolean DEFAULT true NOT NULL,
  "updated_by_principal_id" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_sharing_policies_principal_fk"
    FOREIGN KEY ("workspace_id", "updated_by_principal_id")
    REFERENCES "workspace_principals"("workspace_id", "id") ON DELETE SET NULL
);
--> statement-breakpoint

-- A grant must agree with the workspace its resource is bound to. The original
-- scope foreign key omitted workspace_id, so Postgres accepted a grant that
-- claimed a different workspace than the resource scope while Convex rejected
-- it. Widening the key makes both providers refuse the same write.
ALTER TABLE "workspace_resource_scopes"
  ADD CONSTRAINT "workspace_resource_scopes_workspace_resource_unique"
  UNIQUE ("workspace_id", "resource_type", "resource_id");
--> statement-breakpoint

DELETE FROM "workspace_resource_grants" grant_row
WHERE NOT EXISTS (
  SELECT 1 FROM "workspace_resource_scopes" scope
  WHERE scope."workspace_id" = grant_row."workspace_id"
    AND scope."resource_type" = grant_row."resource_type"
    AND scope."resource_id" = grant_row."resource_id"
);
--> statement-breakpoint

ALTER TABLE "workspace_resource_grants"
  DROP CONSTRAINT "workspace_resource_grants_scope_fk";
--> statement-breakpoint

ALTER TABLE "workspace_resource_grants"
  ADD CONSTRAINT "workspace_resource_grants_scope_fk"
  FOREIGN KEY ("workspace_id", "resource_type", "resource_id")
  REFERENCES "workspace_resource_scopes" ("workspace_id", "resource_type", "resource_id")
  ON DELETE CASCADE;
--> statement-breakpoint

INSERT INTO overlay_app_data_metadata (key, value, updated_at)
VALUES ('schema_version', '37', now())
ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
--> statement-breakpoint
