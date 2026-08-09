CREATE TABLE "email_suppressions" (
	"user_id" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"source" text NOT NULL,
	"suppressed_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_suppressions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "email_suppressions_reason_check" CHECK ("reason" IN ('bounce', 'complaint', 'manual', 'provider_suppression')),
	CONSTRAINT "email_suppressions_source_check" CHECK ("source" IN ('admin', 'provider'))
);
--> statement-breakpoint
CREATE INDEX "email_suppressions_suppressed_at_idx" ON "email_suppressions" USING btree ("suppressed_at");
