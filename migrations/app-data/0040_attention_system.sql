ALTER TYPE "overlay_workspace_notification_type" ADD VALUE IF NOT EXISTS 'thread';
--> statement-breakpoint
ALTER TYPE "overlay_workspace_notification_type" ADD VALUE IF NOT EXISTS 'reaction';
--> statement-breakpoint

CREATE TYPE "overlay_workspace_notification_preference_mode" AS ENUM ('activity', 'banner', 'off');
--> statement-breakpoint

ALTER TABLE "workspace_notifications"
  ADD COLUMN "thread_root_message_id" text,
  ADD COLUMN "event_sequence" bigint,
  ADD COLUMN "mention_scope" text;
--> statement-breakpoint

ALTER TABLE "workspace_notifications"
  ADD CONSTRAINT "workspace_notifications_thread_root_message_id_conversation_messages_id_fk"
    FOREIGN KEY ("thread_root_message_id") REFERENCES "conversation_messages"("id") ON DELETE cascade;
--> statement-breakpoint

CREATE TABLE "conversation_thread_follows" (
  "workspace_id" text NOT NULL,
  "conversation_id" text NOT NULL,
  "thread_root_message_id" text NOT NULL,
  "principal_id" text NOT NULL,
  "followed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "conversation_thread_follows_thread_root_message_id_principal_id_pk"
    PRIMARY KEY ("thread_root_message_id", "principal_id"),
  CONSTRAINT "conversation_thread_follows_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade,
  CONSTRAINT "conversation_thread_follows_conversation_id_conversations_id_fk"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE cascade,
  CONSTRAINT "conversation_thread_follows_thread_root_message_id_conversation_messages_id_fk"
    FOREIGN KEY ("thread_root_message_id") REFERENCES "conversation_messages"("id") ON DELETE cascade,
  CONSTRAINT "conversation_thread_follows_principal_fk"
    FOREIGN KEY ("workspace_id", "principal_id") REFERENCES "workspace_principals"("workspace_id", "id") ON DELETE cascade
);
--> statement-breakpoint

CREATE INDEX "conversation_thread_follows_principal_idx"
  ON "conversation_thread_follows" ("workspace_id", "principal_id", "followed_at");
--> statement-breakpoint
CREATE INDEX "conversation_thread_follows_thread_idx"
  ON "conversation_thread_follows" ("conversation_id", "thread_root_message_id");
--> statement-breakpoint

CREATE TABLE "workspace_notification_preferences" (
  "workspace_id" text NOT NULL,
  "principal_id" text NOT NULL,
  "dm_messages" "overlay_workspace_notification_preference_mode" DEFAULT 'activity' NOT NULL,
  "mentions" "overlay_workspace_notification_preference_mode" DEFAULT 'banner' NOT NULL,
  "thread_replies" "overlay_workspace_notification_preference_mode" DEFAULT 'activity' NOT NULL,
  "reactions" "overlay_workspace_notification_preference_mode" DEFAULT 'activity' NOT NULL,
  "channel_messages" "overlay_workspace_notification_preference_mode" DEFAULT 'activity' NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_notification_preferences_workspace_id_principal_id_pk"
    PRIMARY KEY ("workspace_id", "principal_id"),
  CONSTRAINT "workspace_notification_preferences_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade,
  CONSTRAINT "workspace_notification_preferences_principal_fk"
    FOREIGN KEY ("workspace_id", "principal_id") REFERENCES "workspace_principals"("workspace_id", "id") ON DELETE cascade
);
--> statement-breakpoint

INSERT INTO overlay_app_data_metadata (key, value, updated_at)
VALUES
  ('schema_version', '40', now()),
  ('schema_min_compatible_version', '40', now())
ON CONFLICT (key) DO UPDATE
SET value = excluded.value, updated_at = excluded.updated_at;
