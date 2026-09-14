-- Surface-linked conversations: a platform thread (Slack thread_ts) maps to
-- one Overlay conversation. The partial unique index guarantees a single live
-- conversation per (binding, thread); deleted conversations don't block a
-- fresh mapping. conversation_messages gains the imported-author columns the
-- Convex schema already had so inbound surface senders persist their real
-- identity on both backends.
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "external_platform" text;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "external_channel_id" text;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "external_thread_id" text;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "surface_binding_id" text;
--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN IF NOT EXISTS "imported_author_name" text;
--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN IF NOT EXISTS "imported_author_email" text;
--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN IF NOT EXISTS "imported_author_status" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_surface_thread_idx" ON "conversations" USING btree ("surface_binding_id","external_thread_id") WHERE "deleted_at" IS NULL;
