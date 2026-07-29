CREATE TABLE "workspace_resource_scopes" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "resource_type" text NOT NULL,
  "resource_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_resource_scopes_pk" PRIMARY KEY ("resource_type", "resource_id")
);
--> statement-breakpoint
CREATE INDEX "workspace_resource_scopes_workspace_idx"
  ON "workspace_resource_scopes" ("workspace_id", "resource_type", "resource_id");
--> statement-breakpoint
INSERT INTO overlay_app_data_metadata (key, value, updated_at)
VALUES ('schema_version', '31', now())
ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
--> statement-breakpoint
INSERT INTO overlay_app_data_metadata (key, value, updated_at)
VALUES ('schema_min_compatible_version', '31', now())
ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
