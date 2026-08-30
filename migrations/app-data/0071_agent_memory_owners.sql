-- Memory and knowledge-index ownership is principal-neutral. Human owners use
-- their user id; workspace agents use the `agent-memory:<agentId>` namespace.
-- Human account deletion removes these rows explicitly before deleting users.
ALTER TABLE "knowledge_chunk_embeddings"
  DROP CONSTRAINT IF EXISTS "knowledge_chunk_embeddings_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "knowledge_chunks"
  DROP CONSTRAINT IF EXISTS "knowledge_chunks_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "memories"
  DROP CONSTRAINT IF EXISTS "memories_user_id_users_id_fk";--> statement-breakpoint

-- Preserve the old ON DELETE CASCADE behavior for human owners even when an
-- older application runtime is temporarily serving during rollout/rollback.
CREATE OR REPLACE FUNCTION "cleanup_human_memory_owner"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM "knowledge_chunk_embeddings" WHERE "user_id" = OLD."id";
  DELETE FROM "knowledge_chunks" WHERE "user_id" = OLD."id";
  DELETE FROM "memories" WHERE "user_id" = OLD."id";
  RETURN OLD;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS "users_cleanup_human_memory_owner" ON "users";--> statement-breakpoint
CREATE TRIGGER "users_cleanup_human_memory_owner"
  BEFORE DELETE ON "users"
  FOR EACH ROW
  EXECUTE FUNCTION "cleanup_human_memory_owner"();
