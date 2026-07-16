CREATE INDEX "conversations_deleted_at_created_at_idx" ON "conversations" USING btree ("deleted_at","created_at");--> statement-breakpoint
