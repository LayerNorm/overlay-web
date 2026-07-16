CREATE TABLE "conversation_events" (
	"sequence" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "conversation_events_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"type" text NOT NULL,
	"message_id" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_events_user_sequence_idx" ON "conversation_events" USING btree ("user_id","sequence");--> statement-breakpoint
CREATE INDEX "conversation_events_conversation_sequence_idx" ON "conversation_events" USING btree ("conversation_id","sequence");--> statement-breakpoint
CREATE INDEX "conversation_events_created_at_idx" ON "conversation_events" USING btree ("created_at");--> statement-breakpoint
INSERT INTO "overlay_app_data_metadata" ("key", "value")
VALUES
	('schema_version', '4'),
	('schema_min_compatible_version', '4')
ON CONFLICT ("key") DO UPDATE
SET
	"value" = EXCLUDED."value",
	"updated_at" = now();
