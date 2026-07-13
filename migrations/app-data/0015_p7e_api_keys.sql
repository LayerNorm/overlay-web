CREATE TABLE "api_keys" (
  "id" text PRIMARY KEY NOT NULL,
  "key_hash" text NOT NULL,
  "name" text,
  "user_id" text NOT NULL,
  "scopes" text[] NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" text,
  "created_from_ip" text,
  "last_used_at" timestamp with time zone,
  "last_used_ip" text,
  "revoked_at" timestamp with time zone,
  "revoked_reason" text
);--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_idx" ON "api_keys" ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_user_created_idx" ON "api_keys" ("user_id", "created_at");--> statement-breakpoint
CREATE INDEX "api_keys_expires_at_idx" ON "api_keys" ("expires_at");--> statement-breakpoint
CREATE INDEX "api_keys_revoked_at_idx" ON "api_keys" ("revoked_at");
