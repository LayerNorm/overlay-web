-- Persistent cloud desktops ("computers") for agents and members.
-- The (workspace_id, owner_type, owner_id) unique index enforces the
-- owner-keyed binding: one computer per owner. owner_id is polymorphic
-- (users.id or workspace_agent_definitions.id), so it carries no FK.
CREATE TABLE IF NOT EXISTS "computers" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"size" text NOT NULL,
	"status" text NOT NULL,
	"name" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "computers" ADD CONSTRAINT "computers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "computers" ADD CONSTRAINT "computers_owner_type_check" CHECK ("owner_type" IN ('agent', 'user'));
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "computers" ADD CONSTRAINT "computers_size_check" CHECK ("size" IN ('small', 'default', 'large'));
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "computers" ADD CONSTRAINT "computers_status_check" CHECK ("status" IN ('provisioning', 'ready', 'stopped', 'error'));
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "computers_workspace_owner_idx" ON "computers" USING btree ("workspace_id","owner_type","owner_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "computers_workspace_id_idx" ON "computers" USING btree ("workspace_id");
