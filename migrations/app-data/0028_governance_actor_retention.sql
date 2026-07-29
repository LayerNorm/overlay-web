-- Governance evidence belongs to the governed resource, not to the administrator
-- who created or reviewed it. Preserve that evidence when an administrator
-- leaves, while allowing account deletion to anonymize the actor reference.
ALTER TABLE "governance_policies"
  DROP CONSTRAINT IF EXISTS "governance_policies_created_by_fkey";
--> statement-breakpoint
ALTER TABLE "governance_policies"
  ALTER COLUMN "created_by" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "governance_policies"
  ADD CONSTRAINT "governance_policies_created_by_users_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "governance_access_reviews"
  DROP CONSTRAINT IF EXISTS "governance_access_reviews_created_by_fkey";
--> statement-breakpoint
ALTER TABLE "governance_access_reviews"
  ALTER COLUMN "created_by" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "governance_access_reviews"
  ADD CONSTRAINT "governance_access_reviews_created_by_users_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;
