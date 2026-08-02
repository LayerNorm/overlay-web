ALTER TABLE "conversation_participants"
  ADD COLUMN "last_read_sequence" bigint;
--> statement-breakpoint

ALTER TABLE "workspace_presence"
  ADD COLUMN "session_id" text NOT NULL DEFAULT 'legacy';
--> statement-breakpoint

ALTER TABLE "workspace_presence"
  DROP CONSTRAINT "workspace_presence_pkey";
--> statement-breakpoint

ALTER TABLE "workspace_presence"
  ADD CONSTRAINT "workspace_presence_pkey"
    PRIMARY KEY ("workspace_id", "principal_id", "session_id");
--> statement-breakpoint

CREATE INDEX "workspace_presence_principal_idx"
  ON "workspace_presence" ("workspace_id", "principal_id", "updated_at" DESC);
--> statement-breakpoint

INSERT INTO overlay_app_data_metadata (key, value, updated_at)
VALUES
  ('schema_version', '39', now()),
  ('schema_min_compatible_version', '39', now())
ON CONFLICT (key) DO UPDATE
SET value = excluded.value, updated_at = excluded.updated_at;
