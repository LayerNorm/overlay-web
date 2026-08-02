CREATE TYPE "overlay_channel_visibility" AS ENUM ('public', 'private');
--> statement-breakpoint

ALTER TABLE "conversations"
  ADD COLUMN "channel_slug" text,
  ADD COLUMN "channel_visibility" "overlay_channel_visibility",
  ADD COLUMN "channel_topic" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_workspace_channel_slug_idx"
  ON "conversations" ("workspace_id", "channel_slug")
  WHERE "conversation_type" = 'channel' AND "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_channel_shape_check" CHECK (
  ("conversation_type" <> 'channel' AND "channel_slug" IS NULL AND "channel_visibility" IS NULL)
  OR ("conversation_type" = 'channel' AND "channel_slug" IS NOT NULL AND "channel_visibility" IS NOT NULL)
);
--> statement-breakpoint

ALTER TABLE "conversation_messages"
  ADD COLUMN "thread_root_message_id" text REFERENCES "conversation_messages"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX "conversation_messages_thread_root_created_idx"
  ON "conversation_messages" ("thread_root_message_id", "created_at");
--> statement-breakpoint

CREATE TABLE "conversation_message_reactions" (
  "conversation_id" text NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "message_id" text NOT NULL REFERENCES "conversation_messages"("id") ON DELETE CASCADE,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "principal_id" text NOT NULL,
  "emoji" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("message_id", "principal_id", "emoji"),
  CONSTRAINT "conversation_message_reactions_principal_fk"
    FOREIGN KEY ("workspace_id", "principal_id")
    REFERENCES "workspace_principals"("workspace_id", "id") ON DELETE CASCADE,
  CONSTRAINT "conversation_message_reactions_emoji_check"
    CHECK (char_length("emoji") BETWEEN 1 AND 32)
);
--> statement-breakpoint
CREATE INDEX "conversation_message_reactions_conversation_idx"
  ON "conversation_message_reactions" ("conversation_id", "created_at");
--> statement-breakpoint

CREATE TABLE "conversation_pins" (
  "conversation_id" text NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "message_id" text NOT NULL REFERENCES "conversation_messages"("id") ON DELETE CASCADE,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "pinned_by_principal_id" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("conversation_id", "message_id"),
  CONSTRAINT "conversation_pins_principal_fk"
    FOREIGN KEY ("workspace_id", "pinned_by_principal_id")
    REFERENCES "workspace_principals"("workspace_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint

CREATE TABLE "conversation_saved_messages" (
  "conversation_id" text NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "message_id" text NOT NULL REFERENCES "conversation_messages"("id") ON DELETE CASCADE,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "principal_id" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("message_id", "principal_id"),
  CONSTRAINT "conversation_saved_messages_principal_fk"
    FOREIGN KEY ("workspace_id", "principal_id")
    REFERENCES "workspace_principals"("workspace_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "conversation_saved_messages_principal_idx"
  ON "conversation_saved_messages" ("workspace_id", "principal_id", "created_at" DESC);
--> statement-breakpoint

-- Every active organization receives exactly one durable #general room. The
-- deterministic identifiers make this safe across rehearsals and partial runs.
INSERT INTO "conversations" (
  "id", "workspace_id", "conversation_type", "created_by_principal_id", "user_id",
  "title", "last_modified", "updated_at", "created_at", "last_mode",
  "ask_model_ids", "act_model_id", "channel_slug", "channel_visibility", "channel_topic"
)
SELECT
  'channel_general_' || md5(workspace."id"),
  workspace."id",
  'channel',
  owner_principal."id",
  owner_principal."user_id",
  'general',
  now(), now(), now(), 'act',
  '["moonshotai/kimi-k2.6"]'::jsonb,
  'moonshotai/kimi-k2.6',
  'general',
  'public',
  'Company-wide announcements and conversation'
FROM "workspaces" workspace
JOIN LATERAL (
  SELECT principal."id", principal."user_id"
  FROM "workspace_memberships" membership
  JOIN "workspace_principals" principal
    ON principal."workspace_id" = membership."workspace_id"
   AND principal."id" = membership."principal_id"
  WHERE membership."workspace_id" = workspace."id"
    AND membership."status" = 'active'
    AND membership."role" = 'owner'
    AND principal."type" = 'human'
    AND principal."user_id" IS NOT NULL
  ORDER BY membership."joined_at", principal."id"
  LIMIT 1
) owner_principal ON true
WHERE workspace."kind" = 'organization'
  AND workspace."status" = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM "conversations" existing
    WHERE existing."workspace_id" = workspace."id"
      AND existing."conversation_type" = 'channel'
      AND existing."channel_slug" = 'general'
      AND existing."deleted_at" IS NULL
  );
--> statement-breakpoint

INSERT INTO "conversation_participants" (
  "conversation_id", "workspace_id", "principal_id", "principal_type",
  "role", "status", "notification_level", "joined_at", "updated_at"
)
SELECT
  channel."id", channel."workspace_id", principal."id", principal."type",
  (CASE WHEN membership."role" IN ('owner', 'admin') THEN 'moderator' ELSE 'member' END)::overlay_conversation_participant_role,
  'active', 'all', now(), now()
FROM "conversations" channel
JOIN "workspace_memberships" membership
  ON membership."workspace_id" = channel."workspace_id"
 AND membership."status" = 'active'
JOIN "workspace_principals" principal
  ON principal."workspace_id" = membership."workspace_id"
 AND principal."id" = membership."principal_id"
 AND principal."type" IN ('human', 'agent')
 AND principal."archived_at" IS NULL
WHERE channel."conversation_type" = 'channel'
  AND channel."channel_slug" = 'general'
  AND channel."deleted_at" IS NULL
ON CONFLICT ("conversation_id", "principal_id") DO NOTHING;
--> statement-breakpoint

INSERT INTO "workspace_resource_scopes" (
  "workspace_id", "resource_type", "resource_id", "created_at", "updated_at"
)
SELECT channel."workspace_id", 'conversation', channel."id", now(), now()
FROM "conversations" channel
WHERE channel."conversation_type" = 'channel'
  AND channel."channel_slug" = 'general'
  AND channel."deleted_at" IS NULL
ON CONFLICT ("resource_type", "resource_id") DO NOTHING;
--> statement-breakpoint

INSERT INTO overlay_app_data_metadata (key, value, updated_at)
VALUES ('schema_version', '34', now())
ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
--> statement-breakpoint
