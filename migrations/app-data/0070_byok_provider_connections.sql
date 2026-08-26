CREATE TYPE "overlay_provider_connection_status" AS ENUM ('active', 'error', 'untested');
--> statement-breakpoint
CREATE TABLE "provider_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"display_name" text NOT NULL,
	"credential_ref" text,
	"enabled_model_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"discovered_models_json" text,
	"discovered_at" timestamp with time zone,
	"status" "overlay_provider_connection_status" DEFAULT 'untested' NOT NULL,
	"last_error" text,
	"last_tested_at" timestamp with time zone,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_deletable" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "provider_connections_user_created_idx" ON "provider_connections" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "provider_connections_one_default_per_user_idx" ON "provider_connections" USING btree ("user_id") WHERE "provider_connections"."is_default";
