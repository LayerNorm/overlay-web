export const AUTHORIZATION_CAPABILITY_DEFINITIONS = [
  { key: 'administration.access', category: 'administration', label: 'Access administration' },
  { key: 'users.read', category: 'identity', label: 'View users' },
  { key: 'users.manage', category: 'identity', label: 'Manage users' },
  { key: 'groups.read', category: 'identity', label: 'View groups' },
  { key: 'groups.manage', category: 'identity', label: 'Manage groups' },
  { key: 'roles.read', category: 'identity', label: 'View roles' },
  { key: 'roles.manage', category: 'identity', label: 'Manage roles' },
  { key: 'audit.read', category: 'governance', label: 'View audit events' },
  { key: 'usage.read', category: 'governance', label: 'View usage and budgets' },
  { key: 'usage.manage', category: 'governance', label: 'Manage usage and budgets' },
  { key: 'support.access', category: 'governance', label: 'Access support controls' },
  { key: 'knowledge.create', category: 'knowledge', label: 'Create knowledge bases' },
  { key: 'knowledge.read', category: 'knowledge', label: 'Use knowledge bases' },
  { key: 'knowledge.edit', category: 'knowledge', label: 'Edit knowledge bases' },
  { key: 'knowledge.publish', category: 'knowledge', label: 'Publish knowledge bases' },
  { key: 'knowledge.share', category: 'knowledge', label: 'Share knowledge bases' },
  { key: 'knowledge.delete', category: 'knowledge', label: 'Delete knowledge bases' },
  { key: 'conversations.create', category: 'content', label: 'Create conversations' },
  { key: 'conversations.read', category: 'content', label: 'View conversations' },
  { key: 'conversations.edit', category: 'content', label: 'Edit conversations' },
  { key: 'conversations.share', category: 'content', label: 'Share conversations' },
  { key: 'conversations.delete', category: 'content', label: 'Delete conversations' },
  { key: 'projects.create', category: 'content', label: 'Create projects' },
  { key: 'projects.read', category: 'content', label: 'View projects' },
  { key: 'projects.edit', category: 'content', label: 'Edit projects' },
  { key: 'projects.share', category: 'content', label: 'Share projects' },
  { key: 'projects.delete', category: 'content', label: 'Delete projects' },
  { key: 'files.upload', category: 'content', label: 'Upload files' },
  { key: 'files.read', category: 'content', label: 'View files' },
  { key: 'files.edit', category: 'content', label: 'Edit files' },
  { key: 'files.share', category: 'content', label: 'Share files' },
  { key: 'files.delete', category: 'content', label: 'Delete files' },
  { key: 'notes.create', category: 'content', label: 'Create notes' },
  { key: 'notes.read', category: 'content', label: 'View notes' },
  { key: 'notes.edit', category: 'content', label: 'Edit notes' },
  { key: 'notes.delete', category: 'content', label: 'Delete notes' },
  { key: 'outputs.read', category: 'content', label: 'View generated outputs' },
  { key: 'outputs.delete', category: 'content', label: 'Delete generated outputs' },
  { key: 'models.use', category: 'ai', label: 'Use models' },
  { key: 'tools.use', category: 'ai', label: 'Use tools' },
  { key: 'integrations.use', category: 'ai', label: 'Use integrations' },
  { key: 'skills.use', category: 'ai', label: 'Use skills' },
  { key: 'mcp.use', category: 'ai', label: 'Use MCP servers' },
  { key: 'web_search.use', category: 'ai', label: 'Use web search' },
  { key: 'memory.use', category: 'ai', label: 'Use memory' },
  { key: 'automations.use', category: 'ai', label: 'Use automations' },
  { key: 'api_keys.manage', category: 'governance', label: 'Manage API keys' },
  { key: 'webhooks.manage', category: 'governance', label: 'Manage webhooks' },
] as const

export type AuthorizationCapability =
  (typeof AUTHORIZATION_CAPABILITY_DEFINITIONS)[number]['key']

export type AuthorizationCapabilityCategory =
  (typeof AUTHORIZATION_CAPABILITY_DEFINITIONS)[number]['category']

export type AuthorizationCapabilityDefinition = {
  key: AuthorizationCapability
  category: AuthorizationCapabilityCategory
  label: string
}

const CAPABILITY_SET: ReadonlySet<string> = new Set(
  AUTHORIZATION_CAPABILITY_DEFINITIONS.map(({ key }) => key),
)

export const AUTHORIZATION_CAPABILITIES = AUTHORIZATION_CAPABILITY_DEFINITIONS.map(
  ({ key }) => key,
) as readonly AuthorizationCapability[]

export function isAuthorizationCapability(value: unknown): value is AuthorizationCapability {
  return typeof value === 'string' && CAPABILITY_SET.has(value)
}

export function getAuthorizationCapabilityDefinition(
  capability: AuthorizationCapability,
): AuthorizationCapabilityDefinition {
  return AUTHORIZATION_CAPABILITY_DEFINITIONS.find(({ key }) => key === capability)!
}
