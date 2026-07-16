CREATE TYPE "public"."overlay_output_source" AS ENUM('image_generation', 'video_generation', 'browser', 'sandbox');--> statement-breakpoint
CREATE TYPE "public"."overlay_output_status" AS ENUM('pending', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "daytona_workspaces" (
	"user_id" text PRIMARY KEY NOT NULL,
	"sandbox_id" text NOT NULL,
	"sandbox_name" text NOT NULL,
	"volume_id" text NOT NULL,
	"volume_name" text NOT NULL,
	"tier" text NOT NULL,
	"state" text NOT NULL,
	"resource_profile" text NOT NULL,
	"mount_path" text NOT NULL,
	"last_metered_at" timestamp with time zone,
	"last_known_started_at" timestamp with time zone,
	"last_known_stopped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "output_source" "overlay_output_source";--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "output_status" "overlay_output_status";--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "output_url" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "output_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "output_error_message" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "output_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "daytona_workspaces" ADD CONSTRAINT "daytona_workspaces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daytona_workspaces_sandbox_id_idx" ON "daytona_workspaces" USING btree ("sandbox_id");--> statement-breakpoint
CREATE INDEX "daytona_workspaces_state_updated_at_idx" ON "daytona_workspaces" USING btree ("state","updated_at");--> statement-breakpoint
CREATE INDEX "files_output_expiry_idx" ON "files" USING btree ("kind","output_status","expires_at");--> statement-breakpoint
INSERT INTO "overlay_app_data_metadata" ("key", "value")
VALUES
	('schema_version', '7'),
	('schema_min_compatible_version', '6')
ON CONFLICT ("key") DO UPDATE
SET
	"value" = EXCLUDED."value",
	"updated_at" = now();
