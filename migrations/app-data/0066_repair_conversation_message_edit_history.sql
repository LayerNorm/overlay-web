-- Repair databases whose migration history recorded the original edit-history
-- migration without applying the nullable column. The guard keeps this safe on
-- databases where 0051_conversation_message_edit_history ran correctly.
ALTER TABLE "conversation_messages"
  ADD COLUMN IF NOT EXISTS "edit_history" jsonb;
