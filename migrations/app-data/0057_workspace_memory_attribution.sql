DROP INDEX IF EXISTS "memories_user_id_client_id_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "memories_user_id_content_hash_active_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "memories_user_workspace_client_id_idx"
  ON "memories" USING btree ("user_id", "workspace_id", "client_id")
  WHERE "workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "memories_legacy_user_client_id_idx"
  ON "memories" USING btree ("user_id", "client_id")
  WHERE "workspace_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "memories_user_workspace_content_hash_active_idx"
  ON "memories" USING btree ("user_id", "workspace_id", "content_hash")
  WHERE "workspace_id" IS NOT NULL AND "deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "memories_legacy_user_content_hash_active_idx"
  ON "memories" USING btree ("user_id", "content_hash")
  WHERE "workspace_id" IS NULL AND "deleted_at" IS NULL;
