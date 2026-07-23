import 'server-only'

import type { AuthorizationCapability } from '@overlay/authz-contracts'
import type { CapabilityCheck } from '@overlay/app-core'
import type { AuthorizationCapabilityPolicy } from './AuthorizationService'

const CAPABILITY_FEATURE: Partial<Record<AuthorizationCapability, keyof CapabilityCheck>> = {
  'automations.use': 'automations',
  'files.delete': 'files',
  'files.read': 'files',
  'files.upload': 'files',
  'integrations.use': 'integrations',
  'knowledge.create': 'knowledge',
  'knowledge.delete': 'knowledge',
  'knowledge.edit': 'knowledge',
  'knowledge.publish': 'knowledge',
  'knowledge.read': 'knowledge',
  'knowledge.share': 'knowledge',
  'mcp.use': 'mcpServers',
  'memory.use': 'memory',
  'models.use': 'modelRouting',
  'projects.create': 'projects',
  'projects.edit': 'projects',
  'projects.read': 'projects',
  'projects.share': 'projects',
  'skills.use': 'skills',
  'tools.use': 'chat',
  'web_search.use': 'webSearch',
}

export function createAuthorizationCapabilityPolicy(
  capabilities: CapabilityCheck,
): AuthorizationCapabilityPolicy {
  return {
    isEnabled(capability) {
      const feature = CAPABILITY_FEATURE[capability]
      return feature ? capabilities[feature] : true
    },
  }
}
