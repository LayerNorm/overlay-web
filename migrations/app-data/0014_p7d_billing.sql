CREATE TYPE "public"."overlay_billing_subscription_status" AS ENUM('active', 'canceled', 'past_due', 'trialing');--> statement-breakpoint
CREATE TYPE "public"."overlay_billing_top_up_source" AS ENUM('manual', 'auto');--> statement-breakpoint
CREATE TYPE "public"."overlay_billing_top_up_status" AS ENUM('pending', 'succeeded', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."overlay_billing_provider_event_status" AS ENUM('processing', 'processed', 'failed');--> statement-breakpoint
CREATE TABLE "billing_subscriptions" (
  "user_id" text PRIMARY KEY NOT NULL,
  "email" text,
  "name" text,
  "provider" text DEFAULT 'stripe' NOT NULL,
  "provider_customer_id" text,
  "provider_subscription_id" text,
  "provider_price_id" text,
  "provider_quantity" integer,
  "tier" text DEFAULT 'free' NOT NULL,
  "plan_kind" text DEFAULT 'free' NOT NULL,
  "plan_version" text,
  "plan_amount_cents" integer DEFAULT 0 NOT NULL,
  "markup_basis_points" integer,
  "status" "overlay_billing_subscription_status" DEFAULT 'active' NOT NULL,
  "auto_top_up_enabled" boolean DEFAULT false NOT NULL,
  "auto_top_up_amount_cents" integer DEFAULT 0 NOT NULL,
  "off_session_consent_at" timestamp with time zone,
  "current_period_start" timestamp with time zone,
  "current_period_end" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "billing_top_ups" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "amount_cents" integer NOT NULL,
  "source" "overlay_billing_top_up_source" NOT NULL,
  "status" "overlay_billing_top_up_status" NOT NULL,
  "provider" text DEFAULT 'stripe' NOT NULL,
  "provider_checkout_session_id" text,
  "provider_customer_id" text,
  "provider_payment_intent_id" text,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "billing_top_ups_positive_amount_check" CHECK ("amount_cents" > 0)
);--> statement-breakpoint
CREATE TABLE "billing_provider_events" (
  "provider" text NOT NULL,
  "event_id" text NOT NULL,
  "event_type" text NOT NULL,
  "payload_hash" text NOT NULL,
  "status" "overlay_billing_provider_event_status" DEFAULT 'processing' NOT NULL,
  "attempts" integer DEFAULT 1 NOT NULL,
  "last_error" text,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "billing_provider_events_provider_event_id_pk" PRIMARY KEY("provider", "event_id")
);--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "billing_top_ups" ADD CONSTRAINT "billing_top_ups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_subscriptions_provider_customer_idx" ON "billing_subscriptions" ("provider", "provider_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_subscriptions_provider_subscription_idx" ON "billing_subscriptions" ("provider", "provider_subscription_id");--> statement-breakpoint
CREATE INDEX "billing_subscriptions_status_idx" ON "billing_subscriptions" ("status");--> statement-breakpoint
CREATE INDEX "billing_top_ups_user_created_idx" ON "billing_top_ups" ("user_id", "created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_top_ups_checkout_session_idx" ON "billing_top_ups" ("provider", "provider_checkout_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_top_ups_payment_intent_idx" ON "billing_top_ups" ("provider", "provider_payment_intent_id");--> statement-breakpoint
CREATE INDEX "billing_provider_events_status_updated_idx" ON "billing_provider_events" ("status", "updated_at");
