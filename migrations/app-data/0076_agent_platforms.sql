-- Per-agent chat-platform enablement. NULL predates the feature and means
-- all platforms (grandfathered); an explicit empty array means none.
ALTER TABLE "workspace_agent_definitions" ADD COLUMN "platforms" text[];
--> statement-breakpoint
ALTER TABLE "workspace_agent_definitions" ADD CONSTRAINT "workspace_agent_definitions_platforms_check" CHECK ("platforms" IS NULL OR "platforms" <@ ARRAY['slack', 'msteams']);
