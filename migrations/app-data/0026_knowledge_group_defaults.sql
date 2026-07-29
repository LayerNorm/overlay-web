-- Organization-curated knowledge bases may be made the fallback retrieval
-- corpus for members of an authorization group. This relationship does not
-- grant access: the existing knowledge-base ACL remains authoritative.
CREATE TABLE IF NOT EXISTS "knowledge_base_group_defaults" (
  "group_id" text NOT NULL REFERENCES "authorization_groups"("id") ON DELETE CASCADE,
  "knowledge_base_id" text NOT NULL REFERENCES "knowledge_bases"("id") ON DELETE CASCADE,
  "created_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "knowledge_base_group_defaults_pkey"
    PRIMARY KEY ("group_id", "knowledge_base_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_base_group_defaults_base_idx"
  ON "knowledge_base_group_defaults" ("knowledge_base_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_base_group_defaults_group_idx"
  ON "knowledge_base_group_defaults" ("group_id", "created_at");
