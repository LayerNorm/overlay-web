ALTER TABLE "conversation_messages"
  ADD COLUMN IF NOT EXISTS "edit_history" jsonb;
--> statement-breakpoint

INSERT INTO overlay_app_data_metadata (key, value, updated_at)
VALUES
  ('schema_version', '51', now()),
  ('schema_min_compatible_version', '43', now())
ON CONFLICT (key) DO UPDATE
SET value = excluded.value, updated_at = excluded.updated_at;
