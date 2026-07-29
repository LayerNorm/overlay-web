CREATE TABLE IF NOT EXISTS "project_knowledge_bases" (
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "knowledge_base_id" text NOT NULL REFERENCES "knowledge_bases"("id") ON DELETE CASCADE,
  "attached_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "project_knowledge_bases_pkey" PRIMARY KEY ("project_id", "knowledge_base_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_knowledge_bases_base_created_idx"
  ON "project_knowledge_bases" ("knowledge_base_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_knowledge_bases_project_created_idx"
  ON "project_knowledge_bases" ("project_id", "created_at");
--> statement-breakpoint

-- Carry the single-attachment column into the join table. projects.knowledge_base_id
-- stays readable so a rollback to schema 22 keeps working; it is no longer authoritative.
INSERT INTO "project_knowledge_bases" ("project_id", "knowledge_base_id", "attached_by", "created_at")
SELECT "id", "knowledge_base_id", "user_id", now()
FROM "projects"
WHERE "knowledge_base_id" IS NOT NULL
ON CONFLICT ("project_id", "knowledge_base_id") DO NOTHING;
--> statement-breakpoint

-- A conversation may now ground against several bases, so the conversation id
-- alone can no longer be the primary key.
ALTER TABLE "knowledge_base_conversations"
  DROP CONSTRAINT IF EXISTS "knowledge_base_conversations_pkey";
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "knowledge_base_conversations"
    ADD CONSTRAINT "knowledge_base_conversations_pkey"
    PRIMARY KEY ("conversation_id", "knowledge_base_id");
EXCEPTION
  WHEN invalid_table_definition THEN null;
  WHEN duplicate_table THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_base_conversations_conversation_created_idx"
  ON "knowledge_base_conversations" ("conversation_id", "created_at");
