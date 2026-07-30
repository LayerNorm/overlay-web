CREATE TYPE "overlay_workspace_agent_harness" AS ENUM ('overlay', 'claude-code');
--> statement-breakpoint

CREATE TABLE "workspace_agent_definitions" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "principal_id" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "instructions" text NOT NULL,
  "harness" "overlay_workspace_agent_harness" DEFAULT 'overlay' NOT NULL,
  "model_id" text NOT NULL,
  "avatar_color" text,
  "allowed_tool_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "invocation_policy" text DEFAULT 'mention' NOT NULL,
  "created_by_principal_id" text NOT NULL REFERENCES "workspace_principals"("id") ON DELETE RESTRICT,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "archived_at" timestamptz,
  CONSTRAINT "workspace_agent_definitions_principal_fk"
    FOREIGN KEY ("workspace_id", "principal_id")
    REFERENCES "workspace_principals"("workspace_id", "id") ON DELETE CASCADE,
  CONSTRAINT "workspace_agent_definitions_principal_unique" UNIQUE ("workspace_id", "principal_id"),
  CONSTRAINT "workspace_agent_definitions_policy_check" CHECK ("invocation_policy" = 'mention'),
  CONSTRAINT "workspace_agent_definitions_instructions_check" CHECK (char_length("instructions") BETWEEN 1 AND 20000),
  CONSTRAINT "workspace_agent_definitions_tools_check" CHECK (jsonb_typeof("allowed_tool_ids") = 'array')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_agent_definitions_active_name_idx"
  ON "workspace_agent_definitions" ("workspace_id", lower("name"))
  WHERE "archived_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "workspace_agent_definitions_workspace_updated_idx"
  ON "workspace_agent_definitions" ("workspace_id", "updated_at" DESC);
--> statement-breakpoint

INSERT INTO overlay_app_data_metadata (key, value, updated_at)
VALUES ('schema_version', '35', now())
ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
--> statement-breakpoint
