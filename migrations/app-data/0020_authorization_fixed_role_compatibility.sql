INSERT INTO authorization_roles (
  id, name, description, capabilities, is_system
) VALUES
  (
    'system:administrator',
    '[System] Administrator',
    'Built-in compatibility role with every authorization capability.',
    ARRAY[
      'administration.access', 'users.read', 'users.manage', 'groups.read', 'groups.manage',
      'roles.read', 'roles.manage', 'audit.read', 'usage.read', 'usage.manage', 'support.access',
      'knowledge.create', 'knowledge.read', 'knowledge.edit', 'knowledge.publish',
      'knowledge.share', 'knowledge.delete', 'projects.create', 'projects.read', 'projects.edit',
      'projects.share', 'files.upload', 'files.read', 'files.delete', 'models.use', 'tools.use',
      'integrations.use', 'skills.use', 'mcp.use', 'web_search.use', 'memory.use', 'automations.use'
    ]::text[],
    true
  ),
  (
    'system:auditor',
    '[System] Auditor',
    'Built-in compatibility role for read-only governance and audit access.',
    ARRAY['administration.access', 'users.read', 'groups.read', 'roles.read', 'audit.read']::text[],
    true
  ),
  (
    'system:billing-administrator',
    '[System] Billing administrator',
    'Built-in compatibility role for usage and budget administration.',
    ARRAY['administration.access', 'users.read', 'usage.read', 'usage.manage']::text[],
    true
  ),
  (
    'system:support',
    '[System] Support',
    'Built-in compatibility role for support controls.',
    ARRAY['administration.access', 'users.read', 'support.access']::text[],
    true
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  capabilities = EXCLUDED.capabilities,
  is_system = true,
  updated_at = now();

DELETE FROM authorization_user_roles
WHERE role_id IN (
  'system:administrator',
  'system:auditor',
  'system:billing-administrator',
  'system:support'
)
AND user_id IN (SELECT user_id FROM administrative_principals);

INSERT INTO authorization_user_roles (user_id, role_id, assigned_by)
SELECT
  principal.user_id,
  CASE principal.role
    WHEN 'admin' THEN 'system:administrator'
    WHEN 'auditor' THEN 'system:auditor'
    WHEN 'billing_admin' THEN 'system:billing-administrator'
    WHEN 'support' THEN 'system:support'
  END,
  principal.granted_by
FROM administrative_principals principal
WHERE principal.revoked_at IS NULL
ON CONFLICT (user_id, role_id) DO UPDATE SET
  assigned_by = EXCLUDED.assigned_by;
