-- Backfill workspace_id for existing resource rows using each user's personal workspace.
--
-- For users who already have a personal workspace, we join on it directly.
-- For users who don't have one yet, we create one first (with a stable
-- deterministic ID derived from the user_id hash, matching the Convex
-- stableToken pattern) plus the principal and membership rows, then backfill.
--
-- This mirrors the Convex backfill in convex/migrations/backfillWorkspaceIds.ts
-- which uses ensureLegacyPersonalScope to create a personal workspace on demand.

-- ---------------------------------------------------------------------------
-- Step 1: Create personal workspaces for users who don't have one yet.
-- ---------------------------------------------------------------------------

-- Generate a stable workspace ID from the user_id using a hash, matching the
-- Convex stableToken pattern (FNV-1a 32-bit → base36).
-- We use a CTE to compute the hash in SQL since Postgres doesn't have a
-- built-in FNV-1a function. The exact hash value doesn't matter as long as
-- it's stable and unique per user_id.
INSERT INTO workspaces (id, kind, name, slug, status, personal_owner_user_id, created_at, updated_at)
SELECT
  'personal-' || lpad(to_hex(hashtextextended(u.id, 0)), 16, '0'),
  'personal',
  'Personal',
  'personal-' || lpad(to_hex(hashtextextended(u.id, 0)), 16, '0'),
  'active',
  u.id,
  now(),
  now()
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM workspaces w
  WHERE w.kind = 'personal' AND w.personal_owner_user_id = u.id
)
ON CONFLICT DO NOTHING;

-- Create principals for the newly created personal workspaces.
INSERT INTO workspace_principals (id, workspace_id, type, user_id, display_name, created_at, updated_at)
SELECT
  'human-' || lpad(to_hex(hashtextextended(u.id, 0)), 16, '0'),
  w.id,
  'human',
  u.id,
  'Personal',
  now(),
  now()
FROM users u
JOIN workspaces w ON w.personal_owner_user_id = u.id AND w.kind = 'personal'
WHERE NOT EXISTS (
  SELECT 1 FROM workspace_principals wp
  WHERE wp.workspace_id = w.id AND wp.user_id = u.id AND wp.type = 'human'
)
ON CONFLICT DO NOTHING;

-- Set created_by_principal_id on the new workspaces.
UPDATE workspaces w
SET created_by_principal_id = wp.id
FROM workspace_principals wp
WHERE wp.workspace_id = w.id
  AND w.kind = 'personal'
  AND w.created_by_principal_id IS NULL;

-- Create memberships for the new principals.
INSERT INTO workspace_memberships (workspace_id, principal_id, role, status, joined_at, updated_at)
SELECT
  w.id,
  wp.id,
  'owner',
  'active',
  now(),
  now()
FROM workspaces w
JOIN workspace_principals wp ON wp.workspace_id = w.id AND wp.type = 'human'
WHERE w.kind = 'personal'
  AND NOT EXISTS (
    SELECT 1 FROM workspace_memberships wm
    WHERE wm.workspace_id = w.id AND wm.principal_id = wp.id
  )
ON CONFLICT DO NOTHING;

-- Create workspace user preferences (active workspace = personal).
INSERT INTO user_workspace_preferences (user_id, active_workspace_id, updated_at)
SELECT u.id, w.id, now()
FROM users u
JOIN workspaces w ON w.personal_owner_user_id = u.id AND w.kind = 'personal'
WHERE NOT EXISTS (
  SELECT 1 FROM user_workspace_preferences p WHERE p.user_id = u.id
)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Step 2: Backfill workspace_id on all resource tables.
-- ---------------------------------------------------------------------------

UPDATE conversations c
SET workspace_id = w.id
FROM workspaces w
WHERE c.user_id = w.personal_owner_user_id
  AND w.kind = 'personal'
  AND c.workspace_id IS NULL;

UPDATE files f
SET workspace_id = w.id
FROM workspaces w
WHERE f.user_id = w.personal_owner_user_id
  AND w.kind = 'personal'
  AND f.workspace_id IS NULL;

UPDATE notes n
SET workspace_id = w.id
FROM workspaces w
WHERE n.user_id = w.personal_owner_user_id
  AND w.kind = 'personal'
  AND n.workspace_id IS NULL;

UPDATE projects p
SET workspace_id = w.id
FROM workspaces w
WHERE p.user_id = w.personal_owner_user_id
  AND w.kind = 'personal'
  AND p.workspace_id IS NULL;

UPDATE automations a
SET workspace_id = w.id
FROM workspaces w
WHERE a.user_id = w.personal_owner_user_id
  AND w.kind = 'personal'
  AND a.workspace_id IS NULL;

UPDATE skills s
SET workspace_id = w.id
FROM workspaces w
WHERE s.user_id = w.personal_owner_user_id
  AND w.kind = 'personal'
  AND s.workspace_id IS NULL;

UPDATE mcp_servers m
SET workspace_id = w.id
FROM workspaces w
WHERE m.user_id = w.personal_owner_user_id
  AND w.kind = 'personal'
  AND m.workspace_id IS NULL;

UPDATE memories m
SET workspace_id = w.id
FROM workspaces w
WHERE m.user_id = w.personal_owner_user_id
  AND w.kind = 'personal'
  AND m.workspace_id IS NULL;

UPDATE webhook_subscriptions ws
SET workspace_id = w.id
FROM workspaces w
WHERE ws.user_id = w.personal_owner_user_id
  AND w.kind = 'personal'
  AND ws.workspace_id IS NULL;

UPDATE knowledge_chunks kc
SET workspace_id = w.id
FROM workspaces w
WHERE kc.user_id = w.personal_owner_user_id
  AND w.kind = 'personal'
  AND kc.workspace_id IS NULL;
