CREATE TYPE "public"."overlay_automation_concurrency_policy" AS ENUM('skip', 'queue');--> statement-breakpoint
CREATE TYPE "public"."overlay_automation_run_status" AS ENUM('queued', 'running', 'completed', 'succeeded', 'failed', 'cancel_requested', 'cancelled', 'skipped', 'dead_letter');--> statement-breakpoint
CREATE TYPE "public"."overlay_automation_trigger_kind" AS ENUM('manual', 'schedule', 'event');--> statement-breakpoint
CREATE TABLE "automations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"instructions" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"schedule" jsonb NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_run_status" text,
	"last_error" text,
	"model_id" text,
	"graph_source" text,
	"source_conversation_id" text,
	"conversation_id" text,
	"concurrency_policy" "overlay_automation_concurrency_policy" DEFAULT 'skip' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "automation_triggers" (
	"id" text PRIMARY KEY NOT NULL,
	"automation_id" text NOT NULL,
	"kind" "overlay_automation_trigger_kind" NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_fire_at" timestamp with time zone,
	"last_fired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"automation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"trigger_id" text,
	"trigger_source" "overlay_automation_trigger_kind" NOT NULL,
	"status" "overlay_automation_run_status" DEFAULT 'queued' NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"idempotency_key" text NOT NULL,
	"job_id" text,
	"conversation_id" text,
	"turn_id" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"cancellation_requested_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_run_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"job_id" text,
	"worker_id" text,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"error" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_source_conversation_id_conversations_id_fk" FOREIGN KEY ("source_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_triggers" ADD CONSTRAINT "automation_triggers_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_trigger_id_automation_triggers_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."automation_triggers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run_attempts" ADD CONSTRAINT "automation_run_attempts_run_id_automation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."automation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automations_user_id_updated_at_idx" ON "automations" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "automations_user_id_enabled_idx" ON "automations" USING btree ("user_id","enabled");--> statement-breakpoint
CREATE INDEX "automations_project_id_idx" ON "automations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "automations_due_idx" ON "automations" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_triggers_automation_id_kind_idx" ON "automation_triggers" USING btree ("automation_id","kind");--> statement-breakpoint
CREATE INDEX "automation_triggers_due_idx" ON "automation_triggers" USING btree ("kind","enabled","next_fire_at");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_runs_idempotency_key_idx" ON "automation_runs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "automation_runs_automation_id_created_at_idx" ON "automation_runs" USING btree ("automation_id","created_at");--> statement-breakpoint
CREATE INDEX "automation_runs_automation_id_status_idx" ON "automation_runs" USING btree ("automation_id","status");--> statement-breakpoint
CREATE INDEX "automation_runs_user_id_created_at_idx" ON "automation_runs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "automation_runs_status_scheduled_for_idx" ON "automation_runs" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_run_attempts_run_id_attempt_idx" ON "automation_run_attempts" USING btree ("run_id","attempt_number");--> statement-breakpoint
CREATE INDEX "automation_run_attempts_job_id_idx" ON "automation_run_attempts" USING btree ("job_id");
