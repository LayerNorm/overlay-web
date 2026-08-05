-- Automation durable execution: track Workflow SDK run ID on automation runs.
-- The workflow_run_id column links an automation run to its Vercel Workflow SDK
-- run, enabling status polling and resume-after-restart via the workflow API.
ALTER TABLE "automation_runs" ADD COLUMN IF NOT EXISTS "workflow_run_id" text;--> statement-breakpoint
INSERT INTO overlay_app_data_metadata (key, value, updated_at)
VALUES
  ('schema_version', '42', now()),
  ('schema_min_compatible_version', '41', now())
ON CONFLICT (key) DO UPDATE
SET value = excluded.value, updated_at = excluded.updated_at;
