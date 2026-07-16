ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "chat_suggestions" jsonb;
--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "chat_suggestion_day" text;
