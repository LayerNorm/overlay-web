DO $$ BEGIN
  CREATE TYPE "public"."overlay_knowledge_base_kind" AS ENUM('personal', 'organization');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."overlay_knowledge_base_status" AS ENUM('active', 'archived');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."overlay_canonical_knowledge_source_kind" AS ENUM('file', 'note', 'memory', 'text');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."overlay_knowledge_source_status" AS ENUM(
    'pending', 'extracting', 'indexing', 'ready', 'failed', 'deleting'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "knowledge_bases" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "description" text,
  "kind" "overlay_knowledge_base_kind" DEFAULT 'personal' NOT NULL,
  "status" "overlay_knowledge_base_status" DEFAULT 'active' NOT NULL,
  "created_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_bases_owner_status_updated_idx"
  ON "knowledge_bases" ("owner_user_id", "status", "updated_at" DESC);
CREATE INDEX IF NOT EXISTS "knowledge_bases_kind_status_idx"
  ON "knowledge_bases" ("kind", "status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "knowledge_sources" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "kind" "overlay_canonical_knowledge_source_kind" NOT NULL,
  "source_ref" text,
  "title" text NOT NULL,
  "mime_type" text,
  "content_hash" text,
  "status" "overlay_knowledge_source_status" DEFAULT 'pending' NOT NULL,
  "status_message" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_sources_owner_status_updated_idx"
  ON "knowledge_sources" ("owner_user_id", "status", "updated_at" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_sources_owner_ref_active_idx"
  ON "knowledge_sources" ("owner_user_id", "kind", "source_ref")
  WHERE "source_ref" IS NOT NULL AND "deleted_at" IS NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "knowledge_source_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "source_id" text NOT NULL REFERENCES "knowledge_sources"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "content_hash" text NOT NULL,
  "status" "overlay_knowledge_source_status" DEFAULT 'pending' NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_source_versions_source_version_idx"
  ON "knowledge_source_versions" ("source_id", "version");
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_source_versions_source_hash_idx"
  ON "knowledge_source_versions" ("source_id", "content_hash");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "knowledge_base_sources" (
  "knowledge_base_id" text NOT NULL REFERENCES "knowledge_bases"("id") ON DELETE CASCADE,
  "source_id" text NOT NULL REFERENCES "knowledge_sources"("id") ON DELETE CASCADE,
  "added_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("knowledge_base_id", "source_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_base_sources_source_idx"
  ON "knowledge_base_sources" ("source_id", "knowledge_base_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "knowledge_base_conversations" (
  "conversation_id" text PRIMARY KEY NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "knowledge_base_id" text NOT NULL REFERENCES "knowledge_bases"("id") ON DELETE CASCADE,
  "created_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_base_conversations_base_created_idx"
  ON "knowledge_base_conversations" ("knowledge_base_id", "created_at" DESC);
--> statement-breakpoint

ALTER TABLE "knowledge_chunks"
  ADD COLUMN IF NOT EXISTS "knowledge_source_id" text REFERENCES "knowledge_sources"("id") ON DELETE CASCADE;
ALTER TABLE "knowledge_chunks"
  ADD COLUMN IF NOT EXISTS "knowledge_source_version_id" text REFERENCES "knowledge_source_versions"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_chunks_canonical_source_idx"
  ON "knowledge_chunks" ("knowledge_source_id", "chunk_index");
CREATE INDEX IF NOT EXISTS "knowledge_chunks_source_version_idx"
  ON "knowledge_chunks" ("knowledge_source_version_id");
