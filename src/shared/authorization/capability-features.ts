import type { AuthorizationCapability } from '@overlay/authz-contracts'
import type { CapabilityCheck } from '@overlay/app-core'

export const CAPABILITY_FEATURE: Partial<Record<AuthorizationCapability, keyof CapabilityCheck>> = {
  'automations.use': 'automations',
  'files.delete': 'files',
  'files.edit': 'files',
  'files.read': 'files',
  'files.share': 'files',
  'files.upload': 'files',
  'integrations.use': 'integrations',
  'mcp.use': 'mcpServers',
  'memory.use': 'memory',
  'models.use': 'modelRouting',
  'skills.use': 'skills',
  'tools.use': 'chat',
  'work.use': 'work',
  'web_search.use': 'webSearch',
  'webhooks.manage': 'webhooks',
}
