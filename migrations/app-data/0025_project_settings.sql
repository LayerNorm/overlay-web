-- Per-project configuration: preferred model, tool policy, enabled skills, MCP
-- servers, connectors, automations, and template status. Stored as one JSON blob
-- so the shape can grow without a column per capability, and so both backends
-- carry it identically. Absent settings read as "inherit the account default",
-- which keeps projects written before schema 25 working unchanged.
ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
-- Templates are listed separately from active work.
CREATE INDEX IF NOT EXISTS "projects_user_template_idx"
  ON "projects" ("user_id", (("settings" ->> 'isTemplate')));
