-- Chat-platform workspace installs (Slack teams, Teams tenants, ...).
-- Tokens are stored as server-side AES-256-GCM ciphertext, never plaintext.
CREATE TABLE "workspace_platform_installations" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "directory" text NOT NULL,
  "external_team_id" text NOT NULL,
  "enterprise_id" text,
  "is_enterprise_install" boolean DEFAULT false NOT NULL,
  "team_name" text,
  "bot_user_id" text,
  "bot_token_cipher" text NOT NULL,
  "installed_by_principal_id" text NOT NULL REFERENCES "workspace_principals"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_platform_installations_directory_check" CHECK ("directory" <> ''),
  CONSTRAINT "workspace_platform_installations_team_check" CHECK ("external_team_id" <> ''),
  CONSTRAINT "workspace_platform_installations_cipher_check" CHECK ("bot_token_cipher" <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_platform_installations_workspace_idx"
  ON "workspace_platform_installations" ("workspace_id", "directory", "external_team_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_platform_installations_team_idx"
  ON "workspace_platform_installations" ("directory", "external_team_id");
