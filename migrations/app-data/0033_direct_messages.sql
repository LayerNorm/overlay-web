CREATE TYPE "overlay_conversation_participant_role" AS ENUM ('member', 'moderator');
--> statement-breakpoint
CREATE TYPE "overlay_conversation_participant_status" AS ENUM ('active', 'removed');
--> statement-breakpoint
CREATE TYPE "overlay_conversation_notification_level" AS ENUM ('all', 'mentions', 'muted');
--> statement-breakpoint
CREATE TYPE "overlay_workspace_presence_status" AS ENUM ('online', 'away', 'offline');
--> statement-breakpoint
CREATE TYPE "overlay_workspace_notification_type" AS ENUM ('message', 'mention', 'invitation', 'participant');
--> statement-breakpoint

ALTER TABLE "conversations" ADD COLUMN "dm_identity_key" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_workspace_dm_identity_idx"
  ON "conversations" ("workspace_id", "dm_identity_key")
  WHERE "dm_identity_key" IS NOT NULL AND "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "conversation_messages"
  ADD COLUMN "client_nonce" text,
  ADD COLUMN "edited_at" timestamptz,
  ADD COLUMN "deleted_at" timestamptz;
--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_conversation_client_nonce_idx"
  ON "conversation_messages" ("conversation_id", "client_nonce")
  WHERE "client_nonce" IS NOT NULL;
--> statement-breakpoint

CREATE TABLE "conversation_participants" (
  "conversation_id" text NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "principal_id" text NOT NULL,
  "principal_type" "overlay_workspace_principal_type" NOT NULL,
  "role" "overlay_conversation_participant_role" NOT NULL DEFAULT 'member',
  "status" "overlay_conversation_participant_status" NOT NULL DEFAULT 'active',
  "notification_level" "overlay_conversation_notification_level" NOT NULL DEFAULT 'all',
  "joined_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "removed_at" timestamptz,
  "last_read_at" timestamptz,
  "marked_unread_at" timestamptz,
  "archived_at" timestamptz,
  PRIMARY KEY ("conversation_id", "principal_id"),
  CONSTRAINT "conversation_participants_principal_fk"
    FOREIGN KEY ("workspace_id", "principal_id")
    REFERENCES "workspace_principals"("workspace_id", "id") ON DELETE CASCADE,
  CONSTRAINT "conversation_participants_principal_type_check"
    CHECK ("principal_type" IN ('human', 'agent')),
  CONSTRAINT "conversation_participants_state_check"
    CHECK (
      ("status" = 'active' AND "removed_at" IS NULL)
      OR ("status" = 'removed' AND "removed_at" IS NOT NULL)
    )
);
--> statement-breakpoint
CREATE INDEX "conversation_participants_principal_status_idx"
  ON "conversation_participants" ("workspace_id", "principal_id", "status");
--> statement-breakpoint
CREATE INDEX "conversation_participants_conversation_status_idx"
  ON "conversation_participants" ("conversation_id", "status");
--> statement-breakpoint

INSERT INTO "conversation_participants" (
  "conversation_id", "workspace_id", "principal_id", "principal_type",
  "role", "status", "joined_at", "updated_at"
)
SELECT
  c."id", c."workspace_id", c."created_by_principal_id", p."type",
  'moderator', 'active', c."created_at", COALESCE(c."updated_at", c."created_at")
FROM "conversations" c
JOIN "workspace_principals" p ON p."id" = c."created_by_principal_id"
WHERE c."conversation_type" = 'dm' AND p."type" IN ('human', 'agent')
ON CONFLICT ("conversation_id", "principal_id") DO NOTHING;
--> statement-breakpoint

CREATE TABLE "workspace_presence" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "principal_id" text NOT NULL,
  "conversation_id" text REFERENCES "conversations"("id") ON DELETE SET NULL,
  "status" "overlay_workspace_presence_status" NOT NULL DEFAULT 'online',
  "last_seen_at" timestamptz NOT NULL DEFAULT now(),
  "typing_expires_at" timestamptz,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("workspace_id", "principal_id"),
  CONSTRAINT "workspace_presence_principal_fk"
    FOREIGN KEY ("workspace_id", "principal_id")
    REFERENCES "workspace_principals"("workspace_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "workspace_presence_conversation_idx"
  ON "workspace_presence" ("conversation_id", "updated_at");
--> statement-breakpoint

CREATE TABLE "workspace_notifications" (
  "id" text PRIMARY KEY,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "recipient_principal_id" text NOT NULL,
  "type" "overlay_workspace_notification_type" NOT NULL,
  "conversation_id" text REFERENCES "conversations"("id") ON DELETE CASCADE,
  "message_id" text REFERENCES "conversation_messages"("id") ON DELETE CASCADE,
  "actor_principal_id" text,
  "title" text NOT NULL,
  "body" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "read_at" timestamptz,
  CONSTRAINT "workspace_notifications_recipient_fk"
    FOREIGN KEY ("workspace_id", "recipient_principal_id")
    REFERENCES "workspace_principals"("workspace_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "workspace_notifications_recipient_unread_idx"
  ON "workspace_notifications" ("workspace_id", "recipient_principal_id", "read_at", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "workspace_notifications_conversation_idx"
  ON "workspace_notifications" ("conversation_id", "created_at" DESC);
--> statement-breakpoint

INSERT INTO overlay_app_data_metadata (key, value, updated_at)
VALUES ('schema_version', '33', now())
ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
--> statement-breakpoint
