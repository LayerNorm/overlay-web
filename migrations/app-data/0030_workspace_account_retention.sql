ALTER TABLE "workspace_principals"
  DROP CONSTRAINT "workspace_principals_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "workspace_principals"
  ADD CONSTRAINT "workspace_principals_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "workspace_principals"
  DROP CONSTRAINT "workspace_principals_identity_check";
--> statement-breakpoint
ALTER TABLE "workspace_principals"
  ADD CONSTRAINT "workspace_principals_identity_check" CHECK (
    (
      "type" = 'human'
      AND "agent_id" IS NULL
      AND "service_id" IS NULL
      AND ("user_id" IS NOT NULL OR "archived_at" IS NOT NULL)
    )
    OR (
      "type" = 'agent'
      AND "user_id" IS NULL
      AND "agent_id" IS NOT NULL
      AND "service_id" IS NULL
    )
    OR (
      "type" = 'service'
      AND "user_id" IS NULL
      AND "agent_id" IS NULL
      AND "service_id" IS NOT NULL
    )
  );
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_workspace_membership_invariants()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  checked_workspace_id text := COALESCE(NEW.workspace_id, OLD.workspace_id);
  checked_principal_id text := COALESCE(NEW.principal_id, OLD.principal_id);
  principal_kind overlay_workspace_principal_type;
  parent_workspace_kind overlay_workspace_kind;
  parent_workspace_status overlay_workspace_status;
  remaining_owner_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(checked_workspace_id, 0));

  SELECT kind, status
    INTO parent_workspace_kind, parent_workspace_status
    FROM workspaces
    WHERE id = checked_workspace_id;

  -- Personal workspaces are erased with their account, and archived
  -- organizations may be retained without an active owner.
  IF parent_workspace_kind IS NULL
     OR parent_workspace_kind = 'personal'
     OR parent_workspace_status = 'archived' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

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
INSERT INTO overlay_app_data_metadata (key, value, updated_at)
VALUES ('schema_version', '30', now())
ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
--> statement-breakpoint
INSERT INTO overlay_app_data_metadata (key, value, updated_at)
VALUES ('schema_min_compatible_version', '30', now())
ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
