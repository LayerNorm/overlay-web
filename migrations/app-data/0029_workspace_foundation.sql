CREATE TYPE "overlay_workspace_kind" AS ENUM ('personal', 'organization');
--> statement-breakpoint
CREATE TYPE "overlay_workspace_status" AS ENUM ('active', 'archived');
--> statement-breakpoint
CREATE TYPE "overlay_workspace_principal_type" AS ENUM ('human', 'agent', 'service');
--> statement-breakpoint
CREATE TYPE "overlay_workspace_membership_role" AS ENUM ('owner', 'admin', 'member', 'guest');
--> statement-breakpoint
CREATE TYPE "overlay_workspace_membership_status" AS ENUM ('active', 'suspended');
--> statement-breakpoint
CREATE TYPE "overlay_workspace_invitation_status" AS ENUM (
  'pending', 'accepted', 'expired', 'cancelled', 'replaced'
);
--> statement-breakpoint
CREATE TYPE "overlay_workspace_resource_guest_status" AS ENUM (
  'pending', 'active', 'expired', 'revoked'
);
--> statement-breakpoint
CREATE TYPE "overlay_workspace_resource_guest_access_role" AS ENUM ('viewer', 'editor');
--> statement-breakpoint

CREATE TABLE "workspaces" (
  "id" text PRIMARY KEY NOT NULL,
  "kind" "overlay_workspace_kind" NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "status" "overlay_workspace_status" DEFAULT 'active' NOT NULL,
  "personal_owner_user_id" text REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_by_principal_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  CONSTRAINT "workspaces_personal_owner_check" CHECK (
    ("kind" = 'personal' AND "personal_owner_user_id" IS NOT NULL)
    OR ("kind" = 'organization' AND "personal_owner_user_id" IS NULL)
  ),
  CONSTRAINT "workspaces_archive_state_check" CHECK (
    ("status" = 'archived') = ("archived_at" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_slug_idx" ON "workspaces" (lower("slug"));
--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_personal_owner_idx"
  ON "workspaces" ("personal_owner_user_id") WHERE "kind" = 'personal';
--> statement-breakpoint
CREATE INDEX "workspaces_status_updated_idx" ON "workspaces" ("status", "updated_at");
--> statement-breakpoint

CREATE TABLE "workspace_principals" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "type" "overlay_workspace_principal_type" NOT NULL,
  "user_id" text REFERENCES "users"("id") ON DELETE CASCADE,
  "agent_id" text,
  "service_id" text,
  "display_name" text NOT NULL,
  "email" text,
  "created_by_principal_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  CONSTRAINT "workspace_principals_workspace_id_id_unique" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "workspace_principals_identity_check" CHECK (
    ("type" = 'human' AND "user_id" IS NOT NULL AND "agent_id" IS NULL AND "service_id" IS NULL)
    OR ("type" = 'agent' AND "user_id" IS NULL AND "agent_id" IS NOT NULL AND "service_id" IS NULL)
    OR ("type" = 'service' AND "user_id" IS NULL AND "agent_id" IS NULL AND "service_id" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_principals_human_idx"
  ON "workspace_principals" ("workspace_id", "user_id") WHERE "type" = 'human';
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_principals_agent_idx"
  ON "workspace_principals" ("workspace_id", "agent_id") WHERE "type" = 'agent';
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_principals_service_idx"
  ON "workspace_principals" ("workspace_id", "service_id") WHERE "type" = 'service';
--> statement-breakpoint
CREATE INDEX "workspace_principals_workspace_type_idx"
  ON "workspace_principals" ("workspace_id", "type", "archived_at");
--> statement-breakpoint

ALTER TABLE "workspaces"
  ADD CONSTRAINT "workspaces_created_by_principal_id_fk"
  FOREIGN KEY ("created_by_principal_id") REFERENCES "workspace_principals"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "workspace_principals"
  ADD CONSTRAINT "workspace_principals_created_by_principal_id_fk"
  FOREIGN KEY ("created_by_principal_id") REFERENCES "workspace_principals"("id") ON DELETE SET NULL;
--> statement-breakpoint

CREATE TABLE "workspace_memberships" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "principal_id" text NOT NULL,
  "role" "overlay_workspace_membership_role" NOT NULL,
  "status" "overlay_workspace_membership_status" DEFAULT 'active' NOT NULL,
  "invited_by_principal_id" text REFERENCES "workspace_principals"("id") ON DELETE SET NULL,
  "joined_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_memberships_pk" PRIMARY KEY ("workspace_id", "principal_id"),
  CONSTRAINT "workspace_memberships_principal_fk"
    FOREIGN KEY ("workspace_id", "principal_id")
    REFERENCES "workspace_principals"("workspace_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "workspace_memberships_principal_idx" ON "workspace_memberships" ("principal_id");
--> statement-breakpoint
CREATE INDEX "workspace_memberships_workspace_role_status_idx"
  ON "workspace_memberships" ("workspace_id", "role", "status");
--> statement-breakpoint

CREATE TABLE "user_workspace_preferences" (
  "user_id" text PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "active_workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "user_workspace_preferences_workspace_idx"
  ON "user_workspace_preferences" ("active_workspace_id");
--> statement-breakpoint

CREATE TABLE "workspace_teams" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "created_by_principal_id" text NOT NULL REFERENCES "workspace_principals"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  CONSTRAINT "workspace_teams_workspace_id_id_unique" UNIQUE ("workspace_id", "id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_teams_active_name_idx"
  ON "workspace_teams" ("workspace_id", lower("name")) WHERE "archived_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "workspace_teams_workspace_updated_idx"
  ON "workspace_teams" ("workspace_id", "updated_at");
--> statement-breakpoint

CREATE TABLE "workspace_team_members" (
  "team_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "principal_id" text NOT NULL,
  "principal_type" "overlay_workspace_principal_type" NOT NULL,
  "added_by_principal_id" text REFERENCES "workspace_principals"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_team_members_pk" PRIMARY KEY ("team_id", "principal_id"),
  CONSTRAINT "workspace_team_members_team_fk"
    FOREIGN KEY ("workspace_id", "team_id")
    REFERENCES "workspace_teams"("workspace_id", "id") ON DELETE CASCADE,
  CONSTRAINT "workspace_team_members_principal_fk"
    FOREIGN KEY ("workspace_id", "principal_id")
    REFERENCES "workspace_principals"("workspace_id", "id") ON DELETE CASCADE,
  CONSTRAINT "workspace_team_members_principal_type_check"
    CHECK ("principal_type" IN ('human', 'agent'))
);
--> statement-breakpoint
CREATE INDEX "workspace_team_members_principal_idx"
  ON "workspace_team_members" ("workspace_id", "principal_id");
--> statement-breakpoint

CREATE TABLE "workspace_invitations" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "role" "overlay_workspace_membership_role" NOT NULL,
  "status" "overlay_workspace_invitation_status" DEFAULT 'pending' NOT NULL,
  "invited_by_principal_id" text NOT NULL REFERENCES "workspace_principals"("id") ON DELETE RESTRICT,
  "accepted_by_principal_id" text REFERENCES "workspace_principals"("id") ON DELETE SET NULL,
  "replaced_by_invitation_id" text REFERENCES "workspace_invitations"("id") ON DELETE SET NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "accepted_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "replaced_at" timestamp with time zone,
  CONSTRAINT "workspace_invitations_role_check" CHECK ("role" <> 'owner')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_invitations_pending_email_idx"
  ON "workspace_invitations" ("workspace_id", lower("email")) WHERE "status" = 'pending';
--> statement-breakpoint
CREATE INDEX "workspace_invitations_workspace_status_idx"
  ON "workspace_invitations" ("workspace_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX "workspace_invitations_expiry_idx"
  ON "workspace_invitations" ("status", "expires_at");
--> statement-breakpoint

CREATE TABLE "workspace_resource_guests" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "resource_type" text NOT NULL,
  "resource_id" text NOT NULL,
  "principal_id" text NOT NULL,
  "access_role" "overlay_workspace_resource_guest_access_role" NOT NULL,
  "status" "overlay_workspace_resource_guest_status" DEFAULT 'pending' NOT NULL,
  "granted_by_principal_id" text NOT NULL REFERENCES "workspace_principals"("id") ON DELETE RESTRICT,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "workspace_resource_guests_principal_fk"
    FOREIGN KEY ("workspace_id", "principal_id")
    REFERENCES "workspace_principals"("workspace_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_resource_guests_active_idx"
  ON "workspace_resource_guests" ("workspace_id", "resource_type", "resource_id", "principal_id")
  WHERE "status" IN ('pending', 'active');
--> statement-breakpoint
CREATE INDEX "workspace_resource_guests_resource_idx"
  ON "workspace_resource_guests" ("workspace_id", "resource_type", "resource_id", "status");
--> statement-breakpoint
CREATE INDEX "workspace_resource_guests_principal_idx"
  ON "workspace_resource_guests" ("workspace_id", "principal_id", "status");
--> statement-breakpoint

-- Serialize owner mutation per workspace so two concurrent demotions cannot
-- both observe another owner and leave the workspace ownerless.
CREATE FUNCTION enforce_workspace_membership_invariants()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  checked_workspace_id text := COALESCE(NEW.workspace_id, OLD.workspace_id);
  checked_principal_id text := COALESCE(NEW.principal_id, OLD.principal_id);
  principal_kind overlay_workspace_principal_type;
  remaining_owner_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(checked_workspace_id, 0));

  IF TG_OP <> 'DELETE' AND NEW.role = 'owner' THEN
    SELECT type INTO principal_kind
      FROM workspace_principals
      WHERE workspace_id = NEW.workspace_id AND id = NEW.principal_id;
    IF principal_kind IS DISTINCT FROM 'human' THEN
      RAISE EXCEPTION 'workspace owner must be a human principal'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.status <> 'active' THEN
      RAISE EXCEPTION 'workspace owner membership must be active'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'DELETE'
     OR (OLD.role = 'owner' AND OLD.status = 'active'
         AND (NEW.role <> 'owner' OR NEW.status <> 'active')) THEN
    IF OLD.role = 'owner' AND OLD.status = 'active' THEN
      SELECT count(*) INTO remaining_owner_count
      FROM workspace_memberships
      WHERE workspace_id = OLD.workspace_id
        AND role = 'owner'
        AND status = 'active'
        AND principal_id <> checked_principal_id;
      IF remaining_owner_count = 0 THEN
        RAISE EXCEPTION 'cannot remove or demote the final workspace owner'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "workspace_membership_invariants"
  BEFORE INSERT OR UPDATE OR DELETE ON "workspace_memberships"
  FOR EACH ROW EXECUTE FUNCTION enforce_workspace_membership_invariants();
--> statement-breakpoint

CREATE FUNCTION enforce_workspace_team_member_type()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  stored_type overlay_workspace_principal_type;
BEGIN
  SELECT type INTO stored_type
  FROM workspace_principals
  WHERE workspace_id = NEW.workspace_id AND id = NEW.principal_id;
  IF stored_type NOT IN ('human', 'agent') OR stored_type <> NEW.principal_type THEN
    RAISE EXCEPTION 'workspace team member type does not match principal'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "workspace_team_member_type"
  BEFORE INSERT OR UPDATE ON "workspace_team_members"
  FOR EACH ROW EXECUTE FUNCTION enforce_workspace_team_member_type();
