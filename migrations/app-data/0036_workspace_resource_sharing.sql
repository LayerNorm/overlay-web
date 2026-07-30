CREATE TYPE "overlay_workspace_share_target_type" AS ENUM ('principal', 'team', 'room');
--> statement-breakpoint
CREATE TYPE "overlay_workspace_share_access_role" AS ENUM ('viewer', 'operator', 'editor');
--> statement-breakpoint

CREATE TABLE "workspace_resource_grants" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "resource_type" text NOT NULL,
  "resource_id" text NOT NULL,
  "target_type" "overlay_workspace_share_target_type" NOT NULL,
  "target_id" text NOT NULL,
  "access_role" "overlay_workspace_share_access_role" NOT NULL,
  "granted_by_principal_id" text NOT NULL REFERENCES "workspace_principals"("id") ON DELETE RESTRICT,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_resource_grants_scope_fk"
    FOREIGN KEY ("resource_type", "resource_id")
    REFERENCES "workspace_resource_scopes"("resource_type", "resource_id") ON DELETE CASCADE,
  CONSTRAINT "workspace_resource_grants_type_check"
    CHECK ("resource_type" IN ('conversation', 'file', 'project', 'knowledge_base', 'automation', 'agent')),
  CONSTRAINT "workspace_resource_grants_target_unique"
    UNIQUE ("workspace_id", "resource_type", "resource_id", "target_type", "target_id")
);
--> statement-breakpoint
CREATE INDEX "workspace_resource_grants_resource_idx"
  ON "workspace_resource_grants" ("workspace_id", "resource_type", "resource_id");
--> statement-breakpoint
CREATE INDEX "workspace_resource_grants_target_idx"
  ON "workspace_resource_grants" ("workspace_id", "target_type", "target_id", "resource_type");
--> statement-breakpoint

-- Legacy owner-scoped resources belong to their owner's Personal workspace.
-- Organization resources created after this migration are bound explicitly by
-- the authenticated creation route and never inferred from client input.
INSERT INTO workspace_resource_scopes (workspace_id, resource_type, resource_id, created_at, updated_at)
SELECT principal.workspace_id, source.resource_type, source.resource_id, now(), now()
FROM (
  SELECT user_id, 'file'::text AS resource_type, id AS resource_id FROM files WHERE deleted_at IS NULL
  UNION ALL
  SELECT user_id, 'project'::text, id FROM projects WHERE deleted_at IS NULL
  UNION ALL
  SELECT owner_user_id, 'knowledge_base'::text, id FROM knowledge_bases WHERE status = 'active'
  UNION ALL
  SELECT user_id, 'automation'::text, id FROM automations WHERE deleted_at IS NULL
) source
JOIN workspace_principals principal ON principal.user_id = source.user_id
JOIN workspaces workspace ON workspace.id = principal.workspace_id AND workspace.kind = 'personal'
ON CONFLICT (resource_type, resource_id) DO NOTHING;
--> statement-breakpoint

INSERT INTO overlay_app_data_metadata (key, value, updated_at)
VALUES ('schema_version', '36', now())
ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
--> statement-breakpoint
