ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "knowledge_base_id" text;
--> statement-breakpoint
ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "projects"
    ADD CONSTRAINT "projects_knowledge_base_id_knowledge_bases_id_fk"
    FOREIGN KEY ("knowledge_base_id")
    REFERENCES "public"."knowledge_bases"("id")
    ON DELETE SET NULL
    ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_knowledge_base_id_idx"
  ON "projects" ("knowledge_base_id");
CREATE INDEX IF NOT EXISTS "projects_user_id_archived_at_idx"
  ON "projects" ("user_id", "archived_at");
