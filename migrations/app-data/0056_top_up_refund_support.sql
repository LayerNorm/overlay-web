ALTER TYPE "overlay_billing_top_up_status" ADD VALUE IF NOT EXISTS 'refunded';--> statement-breakpoint
ALTER TABLE "billing_top_ups" ADD COLUMN IF NOT EXISTS "refunded_amount_cents" integer;--> statement-breakpoint
COMMENT ON COLUMN "billing_top_ups"."refunded_amount_cents" IS 'Cumulative amount refunded or reversed via chargeback, in cents. NULL means no refund has been applied.';
