CREATE TYPE "public"."overlay_usage_budget_mode" AS ENUM('unlimited', 'budgeted');--> statement-breakpoint
CREATE TYPE "public"."overlay_usage_reservation_status" AS ENUM('reserved', 'finalized', 'released', 'reconcile_required', 'expired');--> statement-breakpoint
CREATE TYPE "public"."overlay_usage_transaction_type" AS ENUM('reserve', 'finalize', 'release', 'adjustment');--> statement-breakpoint
CREATE TABLE "usage_budget_accounts" (
  "user_id" text PRIMARY KEY NOT NULL,
  "mode" "overlay_usage_budget_mode" DEFAULT 'unlimited' NOT NULL,
  "included_micros" bigint DEFAULT 0 NOT NULL,
  "granted_micros" bigint DEFAULT 0 NOT NULL,
  "used_micros" bigint DEFAULT 0 NOT NULL,
  "reserved_micros" bigint DEFAULT 0 NOT NULL,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "usage_budget_accounts_non_negative_check" CHECK ("included_micros" >= 0 AND "granted_micros" >= 0 AND "used_micros" >= 0 AND "reserved_micros" >= 0)
);--> statement-breakpoint
CREATE TABLE "usage_reservations" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "kind" text NOT NULL,
  "model_id" text,
  "reserved_micros" bigint NOT NULL,
  "actual_micros" bigint,
  "status" "overlay_usage_reservation_status" DEFAULT 'reserved' NOT NULL,
  "provider_work_started" boolean DEFAULT false NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "reason" text,
  "error" text,
  "expires_at" timestamp with time zone NOT NULL,
  "finalized_at" timestamp with time zone,
  "released_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "usage_events" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "reservation_id" text,
  "operation_id" text NOT NULL,
  "kind" text NOT NULL,
  "model_id" text,
  "input_tokens" integer,
  "output_tokens" integer,
  "cached_tokens" integer,
  "provider_cost_micros" bigint,
  "billable_cost_micros" bigint NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "usage_budget_transactions" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "reservation_id" text,
  "event_id" text,
  "type" "overlay_usage_transaction_type" NOT NULL,
  "amount_micros" bigint NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "usage_budget_accounts" ADD CONSTRAINT "usage_budget_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_reservation_id_usage_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."usage_reservations"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "usage_budget_transactions" ADD CONSTRAINT "usage_budget_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "usage_budget_transactions" ADD CONSTRAINT "usage_budget_transactions_reservation_id_usage_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."usage_reservations"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "usage_budget_transactions" ADD CONSTRAINT "usage_budget_transactions_event_id_usage_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."usage_events"("id") ON DELETE set null;--> statement-breakpoint
CREATE INDEX "usage_budget_accounts_mode_idx" ON "usage_budget_accounts" ("mode");--> statement-breakpoint
CREATE INDEX "usage_reservations_user_created_idx" ON "usage_reservations" ("user_id", "created_at");--> statement-breakpoint
CREATE INDEX "usage_reservations_status_expires_idx" ON "usage_reservations" ("status", "expires_at");--> statement-breakpoint
CREATE INDEX "usage_events_user_occurred_idx" ON "usage_events" ("user_id", "occurred_at");--> statement-breakpoint
CREATE INDEX "usage_events_operation_idx" ON "usage_events" ("operation_id");--> statement-breakpoint
CREATE INDEX "usage_events_reservation_idx" ON "usage_events" ("reservation_id");--> statement-breakpoint
CREATE INDEX "usage_budget_transactions_user_created_idx" ON "usage_budget_transactions" ("user_id", "created_at");--> statement-breakpoint
CREATE INDEX "usage_budget_transactions_reservation_idx" ON "usage_budget_transactions" ("reservation_id");
