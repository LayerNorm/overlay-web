-- Versioned governance policies are polymorphic across projects and knowledge
-- bases. Resource existence is enforced by GovernanceService so both backends
-- expose the same contract.
CREATE TABLE IF NOT EXISTS "governance_policies" (
  "id" text PRIMARY KEY NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" text NOT NULL,
  "version" integer NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "retention_until" timestamp with time zone,
  "legal_hold" boolean DEFAULT false NOT NULL,
  "notes" text,
  "created_by" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "approved_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "approved_at" timestamp with time zone,
  "rejected_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "rejected_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "governance_policies_resource_type_check"
    CHECK ("resource_type" IN ('project', 'knowledge_base')),
  CONSTRAINT "governance_policies_status_check"
    CHECK ("status" IN ('draft', 'active', 'superseded', 'rejected')),
  CONSTRAINT "governance_policies_resource_version_unique"
    UNIQUE ("resource_type", "resource_id", "version")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "governance_policies_one_active_idx"
  ON "governance_policies" ("resource_type", "resource_id")
  WHERE "status" = 'active';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "governance_policies_resource_idx"
  ON "governance_policies" ("resource_type", "resource_id", "version" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "governance_policies_status_idx"
  ON "governance_policies" ("status", "updated_at" DESC);
--> statement-breakpoint

-- Reviews are immutable snapshots of the owner and ACL at review-open time.
-- Completing a review records the reviewer and conclusion without rewriting
-- the evidence that was actually reviewed.
CREATE TABLE IF NOT EXISTS "governance_access_reviews" (
  "id" text PRIMARY KEY NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" text NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "owner_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "grants" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_by" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "reviewer_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "notes" text,
  "due_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "governance_access_reviews_resource_type_check"
    CHECK ("resource_type" IN ('project', 'knowledge_base')),
  CONSTRAINT "governance_access_reviews_status_check"
    CHECK ("status" IN ('open', 'completed'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "governance_access_reviews_resource_idx"
  ON "governance_access_reviews" ("resource_type", "resource_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "governance_access_reviews_status_idx"
  ON "governance_access_reviews" ("status", "due_at", "created_at" DESC);
