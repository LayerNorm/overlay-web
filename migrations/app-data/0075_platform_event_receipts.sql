-- Chat-platform webhook delivery receipts for at-most-once handling.
-- The claim key is directory + team + platform event id; rows older than 30
-- days are swept by the claim write itself.
CREATE TABLE "workspace_platform_event_receipts" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "directory" text NOT NULL,
  "external_team_id" text NOT NULL,
  "event_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_platform_event_receipts_directory_check" CHECK ("directory" <> ''),
  CONSTRAINT "workspace_platform_event_receipts_team_check" CHECK ("external_team_id" <> ''),
  CONSTRAINT "workspace_platform_event_receipts_event_check" CHECK ("event_id" <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_platform_event_receipts_claim_idx"
  ON "workspace_platform_event_receipts" ("directory", "external_team_id", "event_id");
--> statement-breakpoint
CREATE INDEX "workspace_platform_event_receipts_created_idx"
  ON "workspace_platform_event_receipts" ("created_at");
