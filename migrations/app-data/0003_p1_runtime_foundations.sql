CREATE TYPE "public"."overlay_durable_job_status" AS ENUM('queued', 'running', 'succeeded', 'dead_letter');--> statement-breakpoint
CREATE TYPE "public"."overlay_idempotency_status" AS ENUM('processing', 'completed');--> statement-breakpoint
CREATE TYPE "public"."overlay_outbox_event_status" AS ENUM('pending', 'publishing', 'published', 'dead_letter');--> statement-breakpoint
CREATE TABLE "api_idempotency_keys" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"status" "overlay_idempotency_status" NOT NULL,
	"response_status" integer,
	"response_headers" jsonb,
	"response_body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "durable_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "overlay_durable_job_status" DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dedupe_key" text,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"last_error" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"dead_lettered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "model_catalog_snapshots" (
	"source" text PRIMARY KEY NOT NULL,
	"models_json" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" text PRIMARY KEY NOT NULL,
	"topic" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "overlay_outbox_event_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 10 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dedupe_key" text,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"dead_lettered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "scheduled_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"job_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"interval_ms" integer NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_enqueued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_auth_replay_nonces" (
	"jti" text PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_idempotency_keys" ADD CONSTRAINT "api_idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_idempotency_keys_user_id_idx" ON "api_idempotency_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_idempotency_keys_expires_at_idx" ON "api_idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "api_idempotency_keys_status_updated_at_idx" ON "api_idempotency_keys" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "durable_jobs_claim_idx" ON "durable_jobs" USING btree ("status","available_at","priority","created_at");--> statement-breakpoint
CREATE INDEX "durable_jobs_lease_idx" ON "durable_jobs" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "durable_jobs_type_status_idx" ON "durable_jobs" USING btree ("type","status");--> statement-breakpoint
CREATE UNIQUE INDEX "durable_jobs_dedupe_key_idx" ON "durable_jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "model_catalog_snapshots_fetched_at_idx" ON "model_catalog_snapshots" USING btree ("fetched_at");--> statement-breakpoint
CREATE INDEX "outbox_events_claim_idx" ON "outbox_events" USING btree ("status","available_at","created_at");--> statement-breakpoint
CREATE INDEX "outbox_events_lease_idx" ON "outbox_events" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "outbox_events_topic_status_idx" ON "outbox_events" USING btree ("topic","status");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_events_dedupe_key_idx" ON "outbox_events" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "scheduled_tasks_due_idx" ON "scheduled_tasks" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE INDEX "scheduled_tasks_job_type_idx" ON "scheduled_tasks" USING btree ("job_type");--> statement-breakpoint
CREATE INDEX "service_auth_replay_nonces_expires_at_idx" ON "service_auth_replay_nonces" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "service_auth_replay_nonces_subject_consumed_at_idx" ON "service_auth_replay_nonces" USING btree ("subject","consumed_at");--> statement-breakpoint
INSERT INTO "overlay_app_data_metadata" ("key", "value")
VALUES
	('schema_version', '3'),
	('schema_min_compatible_version', '3')
ON CONFLICT ("key") DO UPDATE
SET
	"value" = EXCLUDED."value",
	"updated_at" = now();
