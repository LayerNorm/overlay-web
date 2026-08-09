ALTER TABLE "usage_budget_accounts" ADD COLUMN "institutional_grant_micros" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "usage_budget_accounts" ADD COLUMN "allowance_used_micros" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "usage_budget_accounts" ADD COLUMN "top_up_purchased_micros" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "usage_budget_accounts" ADD COLUMN "top_up_balance_micros" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
WITH topups AS (
  SELECT user_id, COALESCE(sum(amount_cents), 0)::bigint * 10000 AS purchased_micros
  FROM billing_top_ups
  WHERE status = 'succeeded'
  GROUP BY user_id
), normalized AS (
  SELECT account.user_id,
         LEAST(account.granted_micros, COALESCE(topups.purchased_micros, 0)) AS top_up_purchased_micros,
         GREATEST(0, account.granted_micros - COALESCE(topups.purchased_micros, 0)) AS institutional_grant_micros,
         account.included_micros,
         account.used_micros
  FROM usage_budget_accounts account
  LEFT JOIN topups ON topups.user_id = account.user_id
)
UPDATE usage_budget_accounts account
SET top_up_purchased_micros = normalized.top_up_purchased_micros,
    institutional_grant_micros = normalized.institutional_grant_micros,
    allowance_used_micros = LEAST(
      normalized.used_micros,
      normalized.included_micros + normalized.institutional_grant_micros
    ),
    top_up_balance_micros = GREATEST(
      0,
      normalized.top_up_purchased_micros - GREATEST(
        0,
        normalized.used_micros - normalized.included_micros - normalized.institutional_grant_micros
      )
    ),
    updated_at = now()
FROM normalized
WHERE account.user_id = normalized.user_id;
--> statement-breakpoint
ALTER TABLE "usage_budget_accounts" DROP CONSTRAINT "usage_budget_accounts_non_negative_check";
--> statement-breakpoint
ALTER TABLE "usage_budget_accounts" ADD CONSTRAINT "usage_budget_accounts_non_negative_check" CHECK (
  "included_micros" >= 0 AND
  "institutional_grant_micros" >= 0 AND
  "allowance_used_micros" >= 0 AND
  "top_up_purchased_micros" >= 0 AND
  "top_up_balance_micros" >= 0 AND
  "top_up_balance_micros" <= "top_up_purchased_micros" AND
  "granted_micros" >= 0 AND
  "used_micros" >= 0 AND
  "reserved_micros" >= 0
);
