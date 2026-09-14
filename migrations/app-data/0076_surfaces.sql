-- External agent surfaces (Slack first; Teams/Discord later).
-- surface_connections is metadata for one platform install — bot tokens are
-- resolved through the Chat SDK state adapter keyed on external_team_id, not
-- stored here. (platform, external_team_id) is globally unique so a Slack
-- workspace can only route to one Overlay workspace.
CREATE TABLE IF NOT EXISTS "surface_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"platform" text NOT NULL,
	"external_team_id" text NOT NULL,
	"external_team_name" text,
	"external_enterprise_id" text,
	"bot_user_id" text,
	"status" text NOT NULL,
	"installed_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "surface_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"channel_name" text,
	"status" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "surface_connections" ADD CONSTRAINT "surface_connections_installed_by_users_id_fk" FOREIGN KEY ("installed_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "surface_bindings" ADD CONSTRAINT "surface_bindings_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."surface_connections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "surface_bindings" ADD CONSTRAINT "surface_bindings_created_by_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "surface_connections" ADD CONSTRAINT "surface_connections_platform_check" CHECK ("platform" IN ('slack'));
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "surface_connections" ADD CONSTRAINT "surface_connections_status_check" CHECK ("status" IN ('active', 'degraded', 'uninstalled'));
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "surface_bindings" ADD CONSTRAINT "surface_bindings_status_check" CHECK ("status" IN ('active', 'removed'));
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "surface_connections_platform_team_idx" ON "surface_connections" USING btree ("platform","external_team_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "surface_connections_workspace_id_idx" ON "surface_connections" USING btree ("workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "surface_bindings_connection_channel_idx" ON "surface_bindings" USING btree ("connection_id","channel_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "surface_bindings_agent_id_idx" ON "surface_bindings" USING btree ("agent_id");
