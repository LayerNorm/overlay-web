CREATE TYPE "public"."overlay_billing_account_scope" AS ENUM('personal', 'workspace');--> statement-breakpoint
CREATE TYPE "public"."overlay_billing_account_status" AS ENUM('active', 'suspended', 'closed');--> statement-breakpoint
CREATE TABLE "billing_accounts" (
  "id" text PRIMARY KEY NOT NULL,
  "scope" "overlay_billing_account_scope" NOT NULL,
  "owner_user_id" text,
  "workspace_id" text,
  "status" "overlay_billing_account_status" DEFAULT 'active' NOT NULL,
  "primary_billing_contact_user_id" text,
  "pricing_version" text DEFAULT 'markup_25_v1' NOT NULL,
  "markup_basis_points" integer DEFAULT 2500 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "closed_at" timestamp with time zone,
  CONSTRAINT "billing_accounts_owner_check" CHECK (
    ("scope" = 'personal' AND "owner_user_id" IS NOT NULL AND "workspace_id" IS NULL) OR
    ("scope" = 'workspace' AND "workspace_id" IS NOT NULL AND "owner_user_id" IS NULL)
  ),
  CONSTRAINT "billing_accounts_markup_non_negative_check" CHECK ("markup_basis_points" >= 0),
  CONSTRAINT "billing_accounts_pricing_version_check" CHECK ("pricing_version" = 'markup_25_v1')
);--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_primary_billing_contact_user_id_users_id_fk" FOREIGN KEY ("primary_billing_contact_user_id") REFERENCES "public"."users"("id") ON DELETE set null;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_accounts_personal_owner_idx" ON "billing_accounts" USING btree ("owner_user_id") WHERE "scope" = 'personal';--> statement-breakpoint
CREATE UNIQUE INDEX "billing_accounts_workspace_idx" ON "billing_accounts" USING btree ("workspace_id") WHERE "scope" = 'workspace';--> statement-breakpoint
CREATE INDEX "billing_accounts_status_updated_idx" ON "billing_accounts" USING btree ("status", "updated_at");--> statement-breakpoint

CREATE TABLE "billing_account_subscriptions" (
  "billing_account_id" text PRIMARY KEY NOT NULL,
  "provider" text DEFAULT 'stripe' NOT NULL,
  "provider_customer_id" text,
  "provider_subscription_id" text,
  "provider_price_id" text,
  "provider_quantity" integer,
  "plan_kind" text DEFAULT 'free' NOT NULL,
  "plan_version" text DEFAULT 'variable_v2' NOT NULL,
  "plan_amount_cents" integer DEFAULT 0 NOT NULL,
  "markup_basis_points" integer DEFAULT 2500 NOT NULL,
  "status" "overlay_billing_subscription_status" DEFAULT 'active' NOT NULL,
  "auto_top_up_enabled" boolean DEFAULT false NOT NULL,
  "auto_top_up_amount_cents" integer DEFAULT 0 NOT NULL,
  "off_session_consent_at" timestamp with time zone,
  "current_period_start" timestamp with time zone,
  "current_period_end" timestamp with time zone,
  "provider_event_created_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "billing_account_subscriptions_plan_kind_check" CHECK ("plan_kind" IN ('free', 'paid')),
  CONSTRAINT "billing_account_subscriptions_plan_version_check" CHECK ("plan_version" = 'variable_v2'),
  CONSTRAINT "billing_account_subscriptions_amount_check" CHECK ("plan_amount_cents" >= 0),
  CONSTRAINT "billing_account_subscriptions_markup_check" CHECK ("markup_basis_points" >= 0)
);--> statement-breakpoint
ALTER TABLE "billing_account_subscriptions" ADD CONSTRAINT "billing_account_subscriptions_billing_account_id_billing_accounts_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_account_subscriptions_provider_customer_idx" ON "billing_account_subscriptions" USING btree ("provider", "provider_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_account_subscriptions_provider_subscription_idx" ON "billing_account_subscriptions" USING btree ("provider", "provider_subscription_id");--> statement-breakpoint
CREATE INDEX "billing_account_subscriptions_status_updated_idx" ON "billing_account_subscriptions" USING btree ("status", "updated_at");--> statement-breakpoint

CREATE TABLE "billing_account_balances" (
  "billing_account_id" text PRIMARY KEY NOT NULL,
  "mode" "overlay_usage_budget_mode" DEFAULT 'budgeted' NOT NULL,
  "included_micros" bigint DEFAULT 0 NOT NULL,
  "institutional_grant_micros" bigint DEFAULT 0 NOT NULL,
  "allowance_used_micros" bigint DEFAULT 0 NOT NULL,
  "top_up_purchased_micros" bigint DEFAULT 0 NOT NULL,
  "top_up_balance_micros" bigint DEFAULT 0 NOT NULL,
  "used_micros" bigint DEFAULT 0 NOT NULL,
  "reserved_micros" bigint DEFAULT 0 NOT NULL,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "billing_account_balances_non_negative_check" CHECK (
    "included_micros" >= 0 AND
    "institutional_grant_micros" >= 0 AND
    "allowance_used_micros" >= 0 AND
    "top_up_purchased_micros" >= 0 AND
    "top_up_balance_micros" >= 0 AND
    "top_up_balance_micros" <= "top_up_purchased_micros" AND
    "used_micros" >= 0 AND
    "reserved_micros" >= 0
  )
);--> statement-breakpoint
ALTER TABLE "billing_account_balances" ADD CONSTRAINT "billing_account_balances_billing_account_id_billing_accounts_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "billing_account_balances_mode_updated_idx" ON "billing_account_balances" USING btree ("mode", "updated_at");--> statement-breakpoint

ALTER TABLE "usage_budget_accounts" ADD COLUMN "billing_account_id" text;--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD COLUMN "billing_account_id" text;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "billing_account_id" text;--> statement-breakpoint
ALTER TABLE "usage_budget_transactions" ADD COLUMN "billing_account_id" text;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD COLUMN "billing_account_id" text;--> statement-breakpoint
ALTER TABLE "billing_top_ups" ADD COLUMN "billing_account_id" text;--> statement-breakpoint
ALTER TABLE "usage_budget_accounts" ADD CONSTRAINT "usage_budget_accounts_billing_account_id_billing_accounts_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_billing_account_id_billing_accounts_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_billing_account_id_billing_accounts_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "usage_budget_transactions" ADD CONSTRAINT "usage_budget_transactions_billing_account_id_billing_accounts_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_billing_account_id_billing_accounts_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "billing_top_ups" ADD CONSTRAINT "billing_top_ups_billing_account_id_billing_accounts_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE set null;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_budget_accounts_billing_account_idx" ON "usage_budget_accounts" USING btree ("billing_account_id") WHERE "billing_account_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "usage_reservations_billing_account_created_idx" ON "usage_reservations" USING btree ("billing_account_id", "created_at");--> statement-breakpoint
CREATE INDEX "usage_events_billing_account_occurred_idx" ON "usage_events" USING btree ("billing_account_id", "occurred_at");--> statement-breakpoint
CREATE INDEX "usage_budget_transactions_billing_account_created_idx" ON "usage_budget_transactions" USING btree ("billing_account_id", "created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_subscriptions_billing_account_idx" ON "billing_subscriptions" USING btree ("billing_account_id") WHERE "billing_account_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "billing_top_ups_billing_account_created_idx" ON "billing_top_ups" USING btree ("billing_account_id", "created_at");
