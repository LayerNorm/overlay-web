INSERT INTO "billing_accounts" (
  "id", "scope", "owner_user_id", "status", "primary_billing_contact_user_id",
  "pricing_version", "markup_basis_points"
)
SELECT
  'ba_p_' || md5("user_row"."id"),
  'personal',
  "user_row"."id",
  'active',
  "user_row"."id",
  'markup_25_v1',
  2500
FROM "users" "user_row"
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO "billing_account_balances" ("billing_account_id", "mode")
SELECT "account"."id", 'budgeted'
FROM "billing_accounts" "account"
WHERE "account"."scope" = 'personal'
ON CONFLICT ("billing_account_id") DO NOTHING;--> statement-breakpoint

UPDATE "billing_subscriptions" "legacy"
SET "billing_account_id" = "account"."id"
FROM "billing_accounts" "account"
WHERE "account"."scope" = 'personal'
  AND "account"."owner_user_id" = "legacy"."user_id"
  AND "legacy"."billing_account_id" IS NULL;--> statement-breakpoint

UPDATE "billing_top_ups" "legacy"
SET "billing_account_id" = "account"."id"
FROM "billing_accounts" "account"
WHERE "account"."scope" = 'personal'
  AND "account"."owner_user_id" = "legacy"."user_id"
  AND "legacy"."billing_account_id" IS NULL;--> statement-breakpoint

UPDATE "usage_budget_accounts" "legacy"
SET "billing_account_id" = "account"."id"
FROM "billing_accounts" "account"
WHERE "account"."scope" = 'personal'
  AND "account"."owner_user_id" = "legacy"."user_id"
  AND "legacy"."billing_account_id" IS NULL;--> statement-breakpoint

UPDATE "usage_reservations" "legacy"
SET "billing_account_id" = "account"."id"
FROM "billing_accounts" "account"
WHERE "account"."scope" = 'personal'
  AND "account"."owner_user_id" = "legacy"."user_id"
  AND "legacy"."billing_account_id" IS NULL;--> statement-breakpoint

UPDATE "usage_events" "legacy"
SET "billing_account_id" = "account"."id"
FROM "billing_accounts" "account"
WHERE "account"."scope" = 'personal'
  AND "account"."owner_user_id" = "legacy"."user_id"
  AND "legacy"."billing_account_id" IS NULL;--> statement-breakpoint

UPDATE "usage_budget_transactions" "legacy"
SET "billing_account_id" = "account"."id"
FROM "billing_accounts" "account"
WHERE "account"."scope" = 'personal'
  AND "account"."owner_user_id" = "legacy"."user_id"
  AND "legacy"."billing_account_id" IS NULL;--> statement-breakpoint

INSERT INTO "billing_account_subscriptions" (
  "billing_account_id", "provider", "provider_customer_id", "provider_subscription_id",
  "provider_price_id", "provider_quantity", "plan_kind", "plan_version",
  "plan_amount_cents", "markup_basis_points", "status", "auto_top_up_enabled",
  "auto_top_up_amount_cents", "off_session_consent_at", "current_period_start",
  "current_period_end", "provider_event_created_at", "created_at", "updated_at"
)
SELECT
  "legacy"."billing_account_id",
  "legacy"."provider",
  "legacy"."provider_customer_id",
  "legacy"."provider_subscription_id",
  "legacy"."provider_price_id",
  "legacy"."provider_quantity",
  "legacy"."plan_kind",
  'variable_v2',
  "legacy"."plan_amount_cents",
  COALESCE("legacy"."markup_basis_points", 2500),
  "legacy"."status",
  "legacy"."auto_top_up_enabled",
  "legacy"."auto_top_up_amount_cents",
  "legacy"."off_session_consent_at",
  "legacy"."current_period_start",
  "legacy"."current_period_end",
  "legacy"."provider_event_created_at",
  "legacy"."created_at",
  "legacy"."updated_at"
FROM "billing_subscriptions" "legacy"
WHERE "legacy"."billing_account_id" IS NOT NULL
ON CONFLICT ("billing_account_id") DO UPDATE SET
  "provider" = EXCLUDED."provider",
  "provider_customer_id" = EXCLUDED."provider_customer_id",
  "provider_subscription_id" = EXCLUDED."provider_subscription_id",
  "provider_price_id" = EXCLUDED."provider_price_id",
  "provider_quantity" = EXCLUDED."provider_quantity",
  "plan_kind" = EXCLUDED."plan_kind",
  "plan_version" = EXCLUDED."plan_version",
  "plan_amount_cents" = EXCLUDED."plan_amount_cents",
  "markup_basis_points" = EXCLUDED."markup_basis_points",
  "status" = EXCLUDED."status",
  "auto_top_up_enabled" = EXCLUDED."auto_top_up_enabled",
  "auto_top_up_amount_cents" = EXCLUDED."auto_top_up_amount_cents",
  "off_session_consent_at" = EXCLUDED."off_session_consent_at",
  "current_period_start" = EXCLUDED."current_period_start",
  "current_period_end" = EXCLUDED."current_period_end",
  "provider_event_created_at" = EXCLUDED."provider_event_created_at",
  "updated_at" = EXCLUDED."updated_at";--> statement-breakpoint

INSERT INTO "billing_account_balances" (
  "billing_account_id", "mode", "included_micros", "institutional_grant_micros",
  "allowance_used_micros", "top_up_purchased_micros", "top_up_balance_micros",
  "used_micros", "reserved_micros", "version", "updated_at"
)
SELECT
  "legacy"."billing_account_id",
  "legacy"."mode",
  "legacy"."included_micros",
  "legacy"."institutional_grant_micros",
  "legacy"."allowance_used_micros",
  "legacy"."top_up_purchased_micros",
  "legacy"."top_up_balance_micros",
  "legacy"."used_micros",
  "legacy"."reserved_micros",
  "legacy"."version",
  "legacy"."updated_at"
FROM "usage_budget_accounts" "legacy"
WHERE "legacy"."billing_account_id" IS NOT NULL
ON CONFLICT ("billing_account_id") DO UPDATE SET
  "mode" = EXCLUDED."mode",
  "included_micros" = EXCLUDED."included_micros",
  "institutional_grant_micros" = EXCLUDED."institutional_grant_micros",
  "allowance_used_micros" = EXCLUDED."allowance_used_micros",
  "top_up_purchased_micros" = EXCLUDED."top_up_purchased_micros",
  "top_up_balance_micros" = EXCLUDED."top_up_balance_micros",
  "used_micros" = EXCLUDED."used_micros",
  "reserved_micros" = EXCLUDED."reserved_micros",
  "version" = EXCLUDED."version",
  "updated_at" = EXCLUDED."updated_at";
