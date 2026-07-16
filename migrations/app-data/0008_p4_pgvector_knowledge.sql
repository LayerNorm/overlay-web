CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."overlay_memory_source" AS ENUM('chat', 'note', 'manual');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."overlay_memory_type" AS ENUM('preference', 'fact', 'project', 'decision', 'agent');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."overlay_memory_actor" AS ENUM('user', 'agent');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."overlay_knowledge_source_kind" AS ENUM('file', 'memory');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memories" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "client_id" text,
  "content" text NOT NULL,
  "content_hash" text NOT NULL,
  "source" "overlay_memory_source" NOT NULL,
  "type" "overlay_memory_type",
  "importance" integer,
  "project_id" text,
  "conversation_id" text,
  "note_id" text,
  "message_id" text,
  "turn_id" text,
  "tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "actor" "overlay_memory_actor",
  "index_status" "overlay_file_index_status" DEFAULT 'pending' NOT NULL,
  "indexed_at" timestamp with time zone,
  "index_error" text,
  "embedding_model_version" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_chunks" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "project_id" text,
  "source_kind" "overlay_knowledge_source_kind" NOT NULL,
  "source_id" text NOT NULL,
  "chunk_index" integer NOT NULL,
  "start_offset" integer NOT NULL,
  "text" text NOT NULL,
  "title" text,
  "content_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_chunk_embeddings" (
  "chunk_id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "source_kind" "overlay_knowledge_source_kind" NOT NULL,
  "embedding" vector(1536) NOT NULL,
  "provider" text NOT NULL,
  "model_id" text NOT NULL,
  "model_version" text NOT NULL,
  "dimensions" integer NOT NULL,
  "content_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "memories" ADD CONSTRAINT "memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
  ALTER TABLE "memories" ADD CONSTRAINT "memories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null;
  ALTER TABLE "memories" ADD CONSTRAINT "memories_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null;
  ALTER TABLE "memories" ADD CONSTRAINT "memories_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE set null;
  ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
  ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null;
  ALTER TABLE "knowledge_chunk_embeddings" ADD CONSTRAINT "knowledge_chunk_embeddings_chunk_id_knowledge_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."knowledge_chunks"("id") ON DELETE cascade;
  ALTER TABLE "knowledge_chunk_embeddings" ADD CONSTRAINT "knowledge_chunk_embeddings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memories_user_id_updated_at_idx" ON "memories" USING btree ("user_id", "updated_at");
CREATE UNIQUE INDEX IF NOT EXISTS "memories_user_id_client_id_idx" ON "memories" USING btree ("user_id", "client_id");
CREATE UNIQUE INDEX IF NOT EXISTS "memories_user_id_content_hash_active_idx" ON "memories" USING btree ("user_id", "content_hash") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "memories_project_id_idx" ON "memories" USING btree ("project_id");
CREATE INDEX IF NOT EXISTS "memories_conversation_id_idx" ON "memories" USING btree ("conversation_id");
CREATE INDEX IF NOT EXISTS "memories_note_id_idx" ON "memories" USING btree ("note_id");
CREATE INDEX IF NOT EXISTS "memories_index_status_idx" ON "memories" USING btree ("index_status", "updated_at");
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_chunks_source_chunk_idx" ON "knowledge_chunks" USING btree ("source_kind", "source_id", "chunk_index");
CREATE INDEX IF NOT EXISTS "knowledge_chunks_user_source_idx" ON "knowledge_chunks" USING btree ("user_id", "source_kind");
CREATE INDEX IF NOT EXISTS "knowledge_chunks_user_project_idx" ON "knowledge_chunks" USING btree ("user_id", "project_id");
CREATE INDEX IF NOT EXISTS "knowledge_chunks_source_idx" ON "knowledge_chunks" USING btree ("source_kind", "source_id");
CREATE INDEX IF NOT EXISTS "knowledge_chunks_search_idx" ON "knowledge_chunks" USING gin (to_tsvector('simple', coalesce("title", '') || ' ' || "text"));
CREATE INDEX IF NOT EXISTS "knowledge_chunk_embeddings_user_model_idx" ON "knowledge_chunk_embeddings" USING btree ("user_id", "provider", "model_id", "model_version");
CREATE INDEX IF NOT EXISTS "knowledge_chunk_embeddings_source_idx" ON "knowledge_chunk_embeddings" USING btree ("source_kind");
CREATE INDEX IF NOT EXISTS "knowledge_chunk_embeddings_hnsw_idx" ON "knowledge_chunk_embeddings" USING hnsw ("embedding" vector_cosine_ops);
