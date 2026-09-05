ALTER TABLE "billing_account_subscriptions" ADD COLUMN "cancel_at_period_end" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD COLUMN "cancel_at_period_end" boolean DEFAULT false NOT NULL;
