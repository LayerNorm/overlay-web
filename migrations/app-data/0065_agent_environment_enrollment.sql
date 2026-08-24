ALTER TABLE "agent_environments" ADD COLUMN IF NOT EXISTS "filesystem_grant" jsonb;
--> statement-breakpoint
ALTER TABLE "agent_environments" ADD COLUMN IF NOT EXISTS "approved_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "agent_environments" ADD COLUMN IF NOT EXISTS "approved_by_user_id" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_enrollment_sessions" (
  "id" text PRIMARY KEY,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "created_by_user_id" text NOT NULL,
  "code_hash" text NOT NULL UNIQUE,
  "verification_phrase" text NOT NULL,
  "status" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "environment_id" text REFERENCES "agent_environments"("id") ON DELETE SET NULL,
  "redeemed_at" timestamptz,
  "approved_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_enrollment_sessions_workspace_created_idx" ON "agent_enrollment_sessions" ("workspace_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_enrollment_sessions_expiry_idx" ON "agent_enrollment_sessions" ("status", "expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_environment_proof_challenges" (
  "id" text PRIMARY KEY,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "environment_id" text NOT NULL REFERENCES "agent_environments"("id") ON DELETE CASCADE,
  "challenge_hash" text NOT NULL UNIQUE,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_environment_proof_challenges_environment_idx" ON "agent_environment_proof_challenges" ("environment_id", "expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_environment_credentials" (
  "id" text PRIMARY KEY,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "environment_id" text NOT NULL REFERENCES "agent_environments"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL UNIQUE,
  "audience" text NOT NULL,
  "methods" jsonb NOT NULL,
  "token_nonce" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_environment_credentials_environment_expiry_idx" ON "agent_environment_credentials" ("environment_id", "expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_environment_proof_nonces" (
  "id" text PRIMARY KEY,
  "credential_id" text NOT NULL REFERENCES "agent_environment_credentials"("id") ON DELETE CASCADE,
  "nonce_hash" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("credential_id", "nonce_hash")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_environment_proof_nonces_expiry_idx" ON "agent_environment_proof_nonces" ("expires_at");
