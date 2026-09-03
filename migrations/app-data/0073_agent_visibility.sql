-- Agent access mode: 'creator' (Only me) or 'workspace' (Everyone).
-- NULL preserves the pre-feature behavior (workspace-visible) for existing rows.
ALTER TABLE "workspace_agent_definitions" ADD COLUMN "visibility" text;
--> statement-breakpoint
ALTER TABLE "workspace_agent_definitions" ADD CONSTRAINT "workspace_agent_definitions_visibility_check" CHECK ("visibility" IS NULL OR "visibility" IN ('creator', 'workspace'));
