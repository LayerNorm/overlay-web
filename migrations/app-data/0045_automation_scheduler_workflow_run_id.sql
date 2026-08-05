-- Automation scheduler cancellation: track the scheduler workflow run ID on automations.
-- The scheduler_workflow_run_id column links an automation to its long-lived
-- scheduling workflow (sleep-loop), enabling immediate cancellation when the
-- automation is deleted or paused.
ALTER TABLE "automations" ADD COLUMN IF NOT EXISTS "scheduler_workflow_run_id" text;--> statement-breakpoint
INSERT INTO overlay_app_data_metadata (key, value, updated_at)
VALUES
  ('schema_version', '45', now()),
  ('schema_min_compatible_version', '44', now())
ON CONFLICT (key) DO UPDATE
SET value = excluded.value, updated_at = excluded.updated_at;
