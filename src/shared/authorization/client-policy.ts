import type { AppAuthorizationState } from '@overlay/app-core'
import type { AuthorizationCapability } from '@overlay/authz-contracts'

export type ClientAuthorizationRequirement = {
  all?: readonly AuthorizationCapability[]
  any?: readonly AuthorizationCapability[]
}

const NAVIGATION_REQUIREMENTS: Record<string, ClientAuthorizationRequirement> = {
  chat: { any: ['conversations.read', 'conversations.create'] },
  files: { any: ['files.read', 'notes.read', 'outputs.read'] },
  extensions: { any: ['integrations.use', 'skills.use', 'mcp.use', 'tools.use'] },
  projects: { any: ['projects.read', 'projects.create'] },
  knowledge: { any: ['knowledge.read', 'knowledge.create'] },
  automations: { all: ['automations.use'] },
}

const SIDEBAR_ACTION_REQUIREMENTS: Record<string, ClientAuthorizationRequirement> = {
  'chat.create': { all: ['conversations.create'] },
  'notes.create': { all: ['notes.create'] },
  'projects.create': { all: ['projects.create'] },
  'automations.create': { all: ['automations.use'] },
}

const SETTINGS_SECTION_REQUIREMENTS: Record<string, ClientAuthorizationRequirement> = {
  memories: { all: ['memory.use'] },
  models: { all: ['models.use'] },
  webhooks: { all: ['webhooks.manage'] },
}

const ROUTE_REQUIREMENTS: Array<{
  prefix: string
  requirement: ClientAuthorizationRequirement
}> = [
  { prefix: '/app/admin', requirement: { all: ['administration.access'] } },
  { prefix: '/app/automations', requirement: { all: ['automations.use'] } },
  { prefix: '/app/knowledge', requirement: { all: ['knowledge.read'] } },
  { prefix: '/app/memories', requirement: { all: ['memory.use'] } },
  { prefix: '/app/notes', requirement: { all: ['notes.read'] } },
  { prefix: '/app/outputs', requirement: { all: ['outputs.read'] } },
  { prefix: '/app/projects', requirement: { all: ['projects.read'] } },
  { prefix: '/app/files', requirement: { all: ['files.read'] } },
  { prefix: '/app/tools', requirement: { any: ['integrations.use', 'skills.use', 'mcp.use', 'tools.use'] } },
  { prefix: '/app/chat', requirement: { any: ['conversations.read', 'conversations.create'] } },
]

export function getNavigationAuthorizationRequirement(
  itemId: string,
): ClientAuthorizationRequirement | null {
  return NAVIGATION_REQUIREMENTS[itemId] ?? null
}

export function getAppRouteAuthorizationRequirement(
  pathname: string,
): ClientAuthorizationRequirement | null {
  return ROUTE_REQUIREMENTS.find(({ prefix }) => (
    pathname === prefix || pathname.startsWith(`${prefix}/`)
  ))?.requirement ?? null
}

export function getSidebarActionAuthorizationRequirement(
  actionKey: string,
): ClientAuthorizationRequirement | null {
  return SIDEBAR_ACTION_REQUIREMENTS[actionKey] ?? null
}

export function getSettingsSectionAuthorizationRequirement(
  sectionId: string,
): ClientAuthorizationRequirement | null {
  return SETTINGS_SECTION_REQUIREMENTS[sectionId] ?? null
}

export function satisfiesAuthorizationRequirement(
  authorization: AppAuthorizationState,
  requirement: ClientAuthorizationRequirement | null,
): boolean {
  if (!requirement || authorization.isDeploymentOwner) return true
  const capabilities = new Set(authorization.capabilities)
  if (requirement.all?.some((capability) => !capabilities.has(capability))) return false
  if (requirement.any && !requirement.any.some((capability) => capabilities.has(capability))) {
    return false
  }
  return true
}

export function allowsClientRequirement(
  authorization: AppAuthorizationState,
  requirement: ClientAuthorizationRequirement | null,
): boolean {
  if (authorization.enforcementMode === 'observe') return true
  return satisfiesAuthorizationRequirement(authorization, requirement)
}
