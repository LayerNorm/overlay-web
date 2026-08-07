ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "workspace_id" text;
CREATE INDEX IF NOT EXISTS "files_workspace_id_idx" ON "files" ("workspace_id");

ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "workspace_id" text;
CREATE INDEX IF NOT EXISTS "notes_workspace_id_idx" ON "notes" ("workspace_id");

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "workspace_id" text;
CREATE INDEX IF NOT EXISTS "projects_workspace_id_idx" ON "projects" ("workspace_id");

ALTER TABLE "automations" ADD COLUMN IF NOT EXISTS "workspace_id" text;
CREATE INDEX IF NOT EXISTS "automations_workspace_id_idx" ON "automations" ("workspace_id");

ALTER TABLE "skills" ADD COLUMN IF NOT EXISTS "workspace_id" text;
CREATE INDEX IF NOT EXISTS "skills_workspace_id_idx" ON "skills" ("workspace_id");

ALTER TABLE "mcp_servers" ADD COLUMN IF NOT EXISTS "workspace_id" text;
CREATE INDEX IF NOT EXISTS "mcp_servers_workspace_id_idx" ON "mcp_servers" ("workspace_id");

ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "workspace_id" text;
CREATE INDEX IF NOT EXISTS "memories_workspace_id_idx" ON "memories" ("workspace_id");

ALTER TABLE "webhook_subscriptions" ADD COLUMN IF NOT EXISTS "workspace_id" text;
CREATE INDEX IF NOT EXISTS "webhook_subscriptions_workspace_id_idx" ON "webhook_subscriptions" ("workspace_id");

ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "workspace_id" text;
CREATE INDEX IF NOT EXISTS "conversations_workspace_id_idx" ON "conversations" ("workspace_id");
