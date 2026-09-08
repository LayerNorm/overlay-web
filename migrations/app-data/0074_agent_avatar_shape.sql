-- Agent creature avatar shape for anthropomorphic agent avatars.
-- NULL preserves the pre-feature behavior (circle body) for existing rows.
ALTER TABLE "workspace_agent_definitions" ADD COLUMN "avatar_shape" text;
--> statement-breakpoint
ALTER TABLE "workspace_agent_definitions" ADD CONSTRAINT "workspace_agent_definitions_avatar_shape_check" CHECK ("avatar_shape" IS NULL OR "avatar_shape" IN ('circle', 'blob', 'squircle', 'pill', 'triangle', 'hexagon', 'cloud', 'droplet'));
