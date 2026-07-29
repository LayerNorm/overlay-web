CREATE TYPE "overlay_conversation_type" AS ENUM ('personal', 'dm', 'channel');
--> statement-breakpoint
CREATE TYPE "overlay_message_author_kind" AS ENUM ('human', 'agent', 'model', 'system');
--> statement-breakpoint

-- Existing accounts predate workspaces. Create a deterministic Personal workspace
-- and human principal before binding their conversations. The identifiers are
-- stable, so a rehearsal can be safely re-run after a partial deployment.
INSERT INTO "workspaces" (
  "id", "kind", "name", "slug", "status", "personal_owner_user_id", "created_at", "updated_at"
)
SELECT
  'personal_ws_' || md5(u."id"),
  'personal',
  COALESCE(NULLIF(trim(concat_ws(' ', u."first_name", u."last_name")), ''), 'Personal'),
  'personal-' || md5(u."id"),
  'active',
  u."id",
  COALESCE(u."created_at", now()),
  now()
FROM "users" u
WHERE NOT EXISTS (
  SELECT 1 FROM "workspaces" w
  WHERE w."kind" = 'personal' AND w."personal_owner_user_id" = u."id"
);
--> statement-breakpoint

INSERT INTO "workspace_principals" (
  "id", "workspace_id", "type", "user_id", "display_name", "email", "created_at", "updated_at"
)
SELECT
  'principal_human_' || md5(u."id"),
  w."id",
  'human',
  u."id",
  COALESCE(NULLIF(trim(concat_ws(' ', u."first_name", u."last_name")), ''), u."email", 'Member'),
  u."email",
  COALESCE(u."created_at", now()),
  now()
FROM "users" u
JOIN "workspaces" w
  ON w."kind" = 'personal' AND w."personal_owner_user_id" = u."id"
WHERE NOT EXISTS (
  SELECT 1 FROM "workspace_principals" p
  WHERE p."workspace_id" = w."id" AND p."type" = 'human' AND p."user_id" = u."id"
);
--> statement-breakpoint

INSERT INTO "workspace_memberships" (
  "workspace_id", "principal_id", "role", "status", "joined_at", "updated_at"
)
SELECT w."id", p."id", 'owner', 'active', COALESCE(p."created_at", now()), now()
FROM "workspaces" w
JOIN "workspace_principals" p
  ON p."workspace_id" = w."id"
 AND p."type" = 'human'
 AND p."user_id" = w."personal_owner_user_id"
WHERE w."kind" = 'personal'
ON CONFLICT ("workspace_id", "principal_id") DO NOTHING;
--> statement-breakpoint

UPDATE "workspaces" w
SET "created_by_principal_id" = p."id", "updated_at" = now()
FROM "workspace_principals" p
WHERE w."kind" = 'personal'
  AND p."workspace_id" = w."id"
  AND p."type" = 'human'
  AND p."user_id" = w."personal_owner_user_id"
  AND w."created_by_principal_id" IS NULL;
--> statement-breakpoint

INSERT INTO "user_workspace_preferences" ("user_id", "active_workspace_id", "updated_at")
SELECT w."personal_owner_user_id", w."id", now()
FROM "workspaces" w
WHERE w."kind" = 'personal'
ON CONFLICT ("user_id") DO NOTHING;
--> statement-breakpoint

ALTER TABLE "conversations"
  ADD COLUMN "workspace_id" text,
  ADD COLUMN "conversation_type" "overlay_conversation_type" DEFAULT 'personal',
  ADD COLUMN "created_by_principal_id" text;
--> statement-breakpoint

UPDATE "conversations" c
SET
  "workspace_id" = w."id",
  "conversation_type" = 'personal',
  "created_by_principal_id" = p."id"
FROM "workspaces" w
JOIN "workspace_principals" p
  ON p."workspace_id" = w."id"
 AND p."type" = 'human'
 AND p."user_id" = w."personal_owner_user_id"
WHERE w."kind" = 'personal'
  AND w."personal_owner_user_id" = c."user_id";
--> statement-breakpoint

ALTER TABLE "conversations"
  ALTER COLUMN "workspace_id" SET NOT NULL,
  ALTER COLUMN "conversation_type" SET NOT NULL,
  ALTER COLUMN "created_by_principal_id" SET NOT NULL,
  ADD CONSTRAINT "conversations_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "conversations_created_by_principal_id_fkey"
    FOREIGN KEY ("created_by_principal_id") REFERENCES "workspace_principals"("id") ON DELETE RESTRICT;
--> statement-breakpoint

DROP INDEX "conversations_user_id_client_id_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_workspace_id_client_id_idx"
  ON "conversations" ("workspace_id", "client_id");
--> statement-breakpoint
CREATE INDEX "conversations_workspace_type_last_modified_idx"
  ON "conversations" ("workspace_id", "conversation_type", "last_modified" DESC);
--> statement-breakpoint

ALTER TABLE "conversation_messages"
  ADD COLUMN "author_kind" "overlay_message_author_kind",
  ADD COLUMN "author_principal_id" text;
--> statement-breakpoint

UPDATE "conversation_messages" m
SET
  "author_kind" = (
    CASE WHEN m."role" = 'user' THEN 'human' ELSE 'model' END
  )::"overlay_message_author_kind",
  "author_principal_id" = CASE WHEN m."role" = 'user' THEN c."created_by_principal_id" ELSE NULL END
FROM "conversations" c
WHERE c."id" = m."conversation_id";
--> statement-breakpoint

ALTER TABLE "conversation_messages"
  ALTER COLUMN "author_kind" SET NOT NULL,
  ADD CONSTRAINT "conversation_messages_author_principal_id_fkey"
    FOREIGN KEY ("author_principal_id") REFERENCES "workspace_principals"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "conversation_messages_author_identity_check" CHECK (
    ("author_kind" IN ('human', 'agent') AND "author_principal_id" IS NOT NULL)
    OR ("author_kind" IN ('model', 'system'))
  );
--> statement-breakpoint

INSERT INTO "workspace_resource_scopes" (
  "workspace_id", "resource_type", "resource_id", "created_at", "updated_at"
)
SELECT
  c."workspace_id",
  'conversation',
  c."id",
  c."created_at",
  COALESCE(c."updated_at", c."last_modified", c."created_at")
FROM "conversations" c
ON CONFLICT ("resource_type", "resource_id") DO UPDATE
SET "workspace_id" = excluded."workspace_id", "updated_at" = excluded."updated_at";
--> statement-breakpoint

INSERT INTO overlay_app_data_metadata (key, value, updated_at)
VALUES ('schema_version', '32', now())
ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
--> statement-breakpoint
INSERT INTO overlay_app_data_metadata (key, value, updated_at)
VALUES ('schema_min_compatible_version', '32', now())
ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
