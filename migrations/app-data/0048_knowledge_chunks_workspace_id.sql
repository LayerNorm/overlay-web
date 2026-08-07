ALTER TABLE "knowledge_chunks" ADD COLUMN IF NOT EXISTS "workspace_id" text;
CREATE INDEX IF NOT EXISTS "knowledge_chunks_workspace_id_idx" ON "knowledge_chunks" ("workspace_id");
