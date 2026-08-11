CREATE TABLE "billing_account_spend_limits" (
  "billing_account_id" text NOT NULL,
  "subject_kind" text NOT NULL,
  "subject_id" text NOT NULL,
  "limit_micros" bigint NOT NULL,
  "used_micros" bigint DEFAULT 0 NOT NULL,
  "reserved_micros" bigint DEFAULT 0 NOT NULL,
  "period_start" timestamp with time zone NOT NULL,
  "period_end" timestamp with time zone NOT NULL,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "billing_account_spend_limits_pk" PRIMARY KEY ("billing_account_id", "subject_kind", "subject_id"),
  CONSTRAINT "billing_account_spend_limits_subject_kind_check" CHECK ("subject_kind" IN ('member', 'programmatic')),
  CONSTRAINT "billing_account_spend_limits_non_negative_check" CHECK (
    "limit_micros" >= 0 AND "used_micros" >= 0 AND "reserved_micros" >= 0 AND
    "used_micros" + "reserved_micros" <= "limit_micros"
  ),
  CONSTRAINT "billing_account_spend_limits_period_check" CHECK ("period_end" > "period_start")
);--> statement-breakpoint
ALTER TABLE "billing_account_spend_limits" ADD CONSTRAINT "billing_account_spend_limits_account_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "billing_account_spend_limits_account_updated_idx" ON "billing_account_spend_limits" USING btree ("billing_account_id", "updated_at");--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD COLUMN "spend_subject_kind" text;--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD COLUMN "spend_subject_id" text;--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_spend_subject_check" CHECK (
  ("spend_subject_kind" IS NULL AND "spend_subject_id" IS NULL) OR
  ("spend_subject_kind" IN ('member', 'programmatic') AND "spend_subject_id" IS NOT NULL)
);--> statement-breakpoint
CREATE INDEX "usage_reservations_billing_account_status_created_idx" ON "usage_reservations" USING btree ("billing_account_id", "status", "created_at");
