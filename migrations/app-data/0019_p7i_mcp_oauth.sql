-- MCP OAuth support: authorization-code flow with PKCE + dynamic client registration.
-- 'oauth' is only added to the auth-type enum here; it is deliberately not referenced by any
-- statement in this migration, because Postgres forbids using a newly added enum value inside
-- the same transaction that adds it (drizzle runs each migration file in one transaction).
ALTER TYPE "public"."overlay_mcp_auth_type" ADD VALUE IF NOT EXISTS 'oauth';--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."overlay_mcp_oauth_status" AS ENUM('pending', 'connected', 'needs_reauth');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."overlay_mcp_oauth_surface" AS ENUM('web', 'desktop');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN IF NOT EXISTS "oauth_status" "overlay_mcp_oauth_status";--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN IF NOT EXISTS "encrypted_oauth_tokens" text;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN IF NOT EXISTS "encrypted_oauth_client" text;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN IF NOT EXISTS "oauth_client_id" text;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN IF NOT EXISTS "oauth_issuer" text;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN IF NOT EXISTS "oauth_scope" text;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN IF NOT EXISTS "oauth_resource" text;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN IF NOT EXISTS "oauth_connected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN IF NOT EXISTS "oauth_error" text;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN IF NOT EXISTS "oauth_token_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mcp_oauth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"mcp_server_id" text NOT NULL,
	"encrypted_code_verifier" text NOT NULL,
	"surface" "overlay_mcp_oauth_surface" DEFAULT 'web' NOT NULL,
	"return_to" text,
	"session_binding_hash" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'mcp_oauth_sessions_user_id_users_id_fk') THEN
    ALTER TABLE "mcp_oauth_sessions" ADD CONSTRAINT "mcp_oauth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'mcp_oauth_sessions_mcp_server_id_mcp_servers_id_fk') THEN
    ALTER TABLE "mcp_oauth_sessions" ADD CONSTRAINT "mcp_oauth_sessions_mcp_server_id_mcp_servers_id_fk" FOREIGN KEY ("mcp_server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_oauth_sessions_user_idx" ON "mcp_oauth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_oauth_sessions_server_idx" ON "mcp_oauth_sessions" USING btree ("mcp_server_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_oauth_sessions_expires_idx" ON "mcp_oauth_sessions" USING btree ("expires_at");--> statement-breakpoint
INSERT INTO overlay_app_data_metadata (key, value, updated_at)
VALUES
  ('schema_version', '41', now()),
  ('schema_min_compatible_version', '40', now())
ON CONFLICT (key) DO UPDATE
SET value = excluded.value, updated_at = excluded.updated_at;
