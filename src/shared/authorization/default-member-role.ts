import type { AuthorizationCapability } from '@overlay/authz-contracts'

export const MEMBER_AUTHORIZATION_ROLE_ID = 'system:member'

export const MEMBER_AUTHORIZATION_CAPABILITIES: AuthorizationCapability[] = [
  'conversations.create',
  'conversations.read',
  'conversations.edit',
  'conversations.share',
  'conversations.delete',
  'files.upload',
  'files.read',
  'files.edit',
  'files.share',
  'files.delete',
  'notes.create',
  'notes.read',
  'notes.edit',
  'notes.delete',
  'work.use',
  'outputs.read',
  'outputs.delete',
  'models.use',
  'tools.use',
  'integrations.use',
  'skills.use',
  'mcp.use',
  'web_search.use',
  'memory.use',
  'automations.use',
  'api_keys.manage',
  'webhooks.manage',
]

