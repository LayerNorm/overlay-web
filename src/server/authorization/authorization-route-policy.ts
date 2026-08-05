import type {
  AuthorizationCapability,
  ResourceAction,
} from '@overlay/authz-contracts'

export const AUTHORIZATION_ROUTE_ACCESS = [
  'public',
  'authenticated',
  'capability',
  'resource',
  'internal',
] as const

export type AuthorizationRouteAccess = (typeof AUTHORIZATION_ROUTE_ACCESS)[number]

export type AuthorizationRoutePolicy = {
  access: AuthorizationRouteAccess
  capabilities?: readonly AuthorizationCapability[]
  resource?: {
    action: ResourceAction
    identifiers?: readonly string[]
    optional?: boolean
    type: string
  }
}

type MethodPolicies = Partial<Record<string, AuthorizationRoutePolicy>>

export type AuthorizationRoutePolicyRule = {
  path: string
  methods: MethodPolicies
}

const publicPolicy = (): AuthorizationRoutePolicy => ({ access: 'public' })
const authenticated = (): AuthorizationRoutePolicy => ({ access: 'authenticated' })
const capability = (
  ...capabilities: AuthorizationCapability[]
): AuthorizationRoutePolicy => ({ access: 'capability', capabilities })
const resource = (
  type: string,
  action: ResourceAction,
  options: { identifiers?: readonly string[]; optional?: boolean },
  ...capabilities: AuthorizationCapability[]
): AuthorizationRoutePolicy => ({
  access: 'resource',
  capabilities,
  resource: { action, type, ...options },
})

export const AUTHORIZATION_ROUTE_POLICIES: readonly AuthorizationRoutePolicyRule[] = [
  { path: '/api/v1/capabilities', methods: { GET: publicPolicy() } },
  // Deployment discovery is intentionally anonymous: it advertises API versions
  // and capabilities to clients that have not authenticated yet.
  { path: '/api/v1/discovery', methods: { GET: publicPolicy() } },
  { path: '/api/v1/bootstrap', methods: { GET: authenticated() } },
  {
    path: '/api/v1/agents',
    methods: { GET: authenticated(), POST: authenticated() },
  },
  {
    path: '/api/v1/agents/:agentId',
    methods: { GET: authenticated(), PATCH: authenticated(), DELETE: authenticated() },
  },
  {
    path: '/api/v1/shares',
    methods: { GET: authenticated(), POST: authenticated(), DELETE: authenticated() },
  },
  {
    path: '/api/v1/shares/impact',
    methods: { GET: authenticated() },
  },
  {
    path: '/api/v1/shares/shared-with-me',
    methods: { GET: authenticated() },
  },
  {
    path: '/api/v1/search',
    methods: { GET: authenticated() },
  },
  {
    path: '/api/v1/workspaces',
    methods: { GET: authenticated(), POST: authenticated() },
  },
  {
    path: '/api/v1/workspaces/active',
    methods: { POST: authenticated() },
  },
  {
    path: '/api/v1/workspaces/:workspaceId/management',
    methods: { GET: authenticated() },
  },
  {
    path: '/api/v1/workspaces/:workspaceId/invitations',
    methods: { GET: authenticated(), POST: authenticated() },
  },
  {
    path: '/api/v1/workspaces/:workspaceId/invitations/:invitationId',
    methods: { POST: authenticated(), DELETE: authenticated() },
  },
  {
    path: '/api/v1/workspaces/:workspaceId/members',
    methods: { PATCH: authenticated(), DELETE: authenticated() },
  },
  {
    path: '/api/v1/workspaces/:workspaceId/teams',
    methods: { POST: authenticated(), DELETE: authenticated() },
  },
  {
    path: '/api/v1/workspaces/:workspaceId/teams/:teamId/members',
    methods: { POST: authenticated(), DELETE: authenticated() },
  },
  {
    path: '/api/v1/workspaces/:workspaceId/lifecycle',
    methods: { DELETE: authenticated() },
  },
  {
    path: '/api/v1/workspaces/:workspaceId/policies',
    methods: { GET: authenticated(), PATCH: authenticated() },
  },
  {
    path: '/api/v1/workspaces/:workspaceId/governance',
    methods: { GET: authenticated(), POST: authenticated() },
  },
  {
    path: '/api/v1/workspaces/:workspaceId/audit-export',
    methods: { GET: authenticated() },
  },
  {
    path: '/api/v1/workspace-invitations/:invitationId/accept',
    methods: { POST: authenticated() },
  },
  { path: '/api/v1/chat-suggestions', methods: { GET: capability('conversations.create') } },
  { path: '/api/v1/settings', methods: { GET: authenticated(), PATCH: authenticated() } },
  { path: '/api/v1/onboarding/status', methods: { GET: authenticated() } },
  { path: '/api/v1/onboarding/complete', methods: { POST: authenticated() } },
  { path: '/api/v1/onboarding/reset', methods: { POST: authenticated() } },
  { path: '/api/v1/subscription', methods: { GET: authenticated() } },
  {
    path: '/api/v1/subscription/settings',
    methods: { GET: authenticated(), POST: authenticated() },
  },

  { path: '/api/v1/admin/audit', methods: { GET: capability('audit.read') } },
  {
    path: '/api/v1/admin/usage',
    methods: { GET: capability('usage.read'), POST: capability('usage.manage') },
  },
  {
    path: '/api/v1/admin/principals',
    methods: {
      GET: capability('users.read'),
      POST: capability('users.manage'),
      DELETE: capability('users.manage'),
    },
  },
  {
    path: '/api/v1/admin/authorization/capabilities',
    methods: { GET: capability('roles.read') },
  },
  {
    path: '/api/v1/admin/authorization/roles',
    methods: {
      GET: capability('roles.read'),
      POST: capability('roles.manage'),
      PATCH: capability('roles.manage'),
      DELETE: capability('roles.manage'),
    },
  },
  {
    path: '/api/v1/admin/authorization/groups',
    methods: {
      GET: capability('groups.read'),
      POST: capability('groups.manage'),
      PATCH: capability('groups.manage'),
      DELETE: capability('groups.manage'),
    },
  },
  {
    path: '/api/v1/admin/authorization/memberships',
    methods: {
      GET: capability('groups.read'),
      POST: capability('groups.manage'),
      DELETE: capability('groups.manage'),
    },
  },
  {
    path: '/api/v1/admin/authorization/assignments',
    methods: {
      GET: capability('roles.read'),
      POST: capability('roles.manage'),
      DELETE: capability('roles.manage'),
    },
  },
  {
    path: '/api/v1/admin/authorization/grants',
    methods: {
      GET: capability('roles.read'),
      POST: capability('roles.manage'),
      DELETE: capability('roles.manage'),
    },
  },
  {
    path: '/api/v1/admin/catalog',
    methods: { GET: capability('roles.read') },
  },
  {
    path: '/api/v1/admin/knowledge-bases',
    methods: { GET: capability('administration.access', 'knowledge.publish') },
  },
  {
    path: '/api/v1/admin/knowledge-bases/defaults',
    methods: {
      GET: capability('administration.access', 'groups.read', 'knowledge.publish'),
      POST: capability('administration.access', 'groups.manage', 'knowledge.publish'),
      DELETE: capability('administration.access', 'groups.manage', 'knowledge.publish'),
    },
  },
  {
    path: '/api/v1/admin/governance/policies',
    methods: {
      GET: capability('governance.read'),
      POST: capability('governance.manage'),
      PATCH: capability('governance.manage'),
    },
  },
  {
    path: '/api/v1/admin/governance/reviews',
    methods: {
      GET: capability('governance.read'),
      POST: capability('governance.manage'),
      PATCH: capability('governance.manage'),
    },
  },
  {
    path: '/api/v1/admin/governance/export',
    methods: { GET: capability('governance.export') },
  },

  {
    path: '/api/v1/conversations',
    methods: {
      GET: resource('conversation', 'view', { optional: true }, 'conversations.read'),
      POST: capability('conversations.create'),
      PATCH: resource('conversation', 'edit', {}, 'conversations.edit'),
      DELETE: resource('conversation', 'delete', {}, 'conversations.delete'),
    },
  },
  {
    path: '/api/v1/conversations/events',
    methods: { GET: capability('conversations.read') },
  },
  {
    path: '/api/v1/conversations/direct-messages',
    methods: { POST: capability('conversations.create') },
  },
  {
    path: '/api/v1/conversations/channels',
    methods: {
      GET: capability('conversations.read'),
      POST: capability('conversations.create'),
    },
  },
  {
    path: '/api/v1/conversations/search',
    methods: { GET: capability('conversations.read') },
  },
  {
    path: '/api/v1/conversations/saved-messages',
    methods: {
      GET: capability('conversations.read'),
      PATCH: capability('conversations.edit'),
    },
  },
  {
    path: '/api/v1/conversations/notifications',
    methods: {
      GET: capability('conversations.read'),
      PATCH: capability('conversations.edit'),
    },
  },
  {
    path: '/api/v1/conversations/notification-preferences',
    methods: {
      GET: capability('conversations.read'),
      PATCH: capability('conversations.edit'),
    },
  },
  {
    path: '/api/v1/conversations/:conversationId/participants',
    methods: {
      GET: resource('conversation', 'view', {}, 'conversations.read'),
      POST: resource('conversation', 'edit', {}, 'conversations.edit'),
      DELETE: resource('conversation', 'edit', {}, 'conversations.edit'),
    },
  },
  {
    path: '/api/v1/conversations/:conversationId/state',
    methods: { PATCH: resource('conversation', 'view', {}, 'conversations.read') },
  },
  {
    path: '/api/v1/conversations/:conversationId/presence',
    methods: {
      GET: resource('conversation', 'view', {}, 'conversations.read'),
      PATCH: resource('conversation', 'view', {}, 'conversations.read'),
    },
  },
  {
    path: '/api/v1/conversations/:conversationId/threads/:threadRootMessageId/follow',
    methods: {
      GET: resource('conversation', 'view', {}, 'conversations.read'),
      PATCH: resource('conversation', 'edit', {}, 'conversations.edit'),
    },
  },
  {
    path: '/api/v1/conversations/:conversationId/reactions',
    methods: {
      GET: resource('conversation', 'view', {}, 'conversations.read'),
      PATCH: resource('conversation', 'edit', {}, 'conversations.edit'),
    },
  },
  {
    path: '/api/v1/conversations/:conversationId/pins',
    methods: {
      GET: resource('conversation', 'view', {}, 'conversations.read'),
      PATCH: resource('conversation', 'edit', {}, 'conversations.edit'),
    },
  },
  {
    path: '/api/v1/conversations/:conversationId/reports',
    methods: { POST: authenticated() },
  },
  {
    path: '/api/v1/conversations/:conversationId/messages/:messageId',
    methods: {
      PATCH: resource('conversation', 'edit', {}, 'conversations.edit'),
      DELETE: resource('conversation', 'edit', {}, 'conversations.edit'),
    },
  },
  {
    path: '/api/v1/conversations/act',
    methods: { POST: resource('conversation', 'edit', { optional: true }, 'conversations.edit', 'models.use') },
  },
  {
    path: '/api/v1/conversations/act/extension-plan',
    methods: { POST: capability('conversations.edit', 'models.use') },
  },
  {
    path: '/api/v1/conversations/message',
    methods: {
      POST: resource('conversation', 'edit', {}, 'conversations.edit'),
      DELETE: resource('conversation', 'edit', {}, 'conversations.edit'),
    },
  },
  {
    // Streams a room agent's answer to a message the caller just posted, so it
    // carries the same rights as writing in that conversation.
    path: '/api/v1/conversations/agent-reply',
    methods: { POST: resource('conversation', 'edit', {}, 'conversations.edit', 'models.use') },
  },
  {
    path: '/api/v1/conversations/share',
    methods: { PATCH: resource('conversation', 'share', {}, 'conversations.share') },
  },
  {
    path: '/api/v1/conversations/stop',
    methods: { POST: resource('conversation', 'edit', {}, 'conversations.edit') },
  },
  {
    path: '/api/v1/conversations/stream-auth',
    methods: { POST: resource('conversation', 'view', {}, 'conversations.read') },
  },

  {
    path: '/api/v1/files',
    methods: {
      GET: resource('file', 'view', { optional: true }, 'files.read'),
      POST: capability('files.upload'),
      PATCH: resource('file', 'edit', {}, 'files.edit'),
      DELETE: resource('file', 'delete', {}, 'files.delete'),
    },
  },
  {
    path: '/api/v1/files/:fileId/content',
    methods: { GET: resource('file', 'view', {}, 'files.read') },
  },
  { path: '/api/v1/files/ingest-document', methods: { POST: capability('files.upload') } },
  { path: '/api/v1/files/presign', methods: { GET: capability('files.upload') } },
  { path: '/api/v1/files/search-text', methods: { POST: capability('files.read') } },
  {
    path: '/api/v1/files/share',
    methods: { PATCH: resource('file', 'share', {}, 'files.share') },
  },
  { path: '/api/v1/files/upload-url', methods: { POST: capability('files.upload') } },

  {
    path: '/api/v1/projects',
    methods: {
      GET: resource('project', 'view', { optional: true }, 'projects.read'),
      POST: capability('projects.create'),
      PATCH: resource('project', 'edit', {}, 'projects.edit'),
      DELETE: resource('project', 'delete', {}, 'projects.delete'),
    },
  },
  {
    path: '/api/v1/projects/share-directory',
    methods: { GET: capability('projects.share') },
  },
  {
    path: '/api/v1/projects/grants',
    methods: {
      GET: resource('project', 'share', {}, 'projects.share'),
      POST: resource('project', 'share', {}, 'projects.share'),
      DELETE: resource('project', 'share', {}, 'projects.share'),
    },
  },
  {
    // Duplicating reads one project's configuration and creates another, so it
    // needs view on the source and the ability to create.
    path: '/api/v1/projects/duplicate',
    methods: {
      GET: capability('projects.read'),
      POST: capability('projects.create', 'projects.read'),
    },
  },
  {
    path: '/api/v1/projects/export',
    methods: { GET: resource('project', 'view', {}, 'projects.read') },
  },
  {
    // Promotion writes into a knowledge base and copying reads from one, so both
    // directions need project edit plus the matching knowledge capability.
    // projectId is optional so an answer from a project-less chat can still be
    // captured; the handler verifies ownership whenever one is supplied.
    path: '/api/v1/projects/knowledge-transfer',
    methods: {
      POST: resource('project', 'edit', { optional: true }, 'projects.edit', 'knowledge.read'),
    },
  },
  {
    // Attaching trusted knowledge changes what a project's chats may cite, so it
    // is gated as a project edit. Read access to each base is checked separately
    // by KnowledgeBaseService.
    path: '/api/v1/projects/knowledge-bases',
    methods: {
      GET: resource('project', 'view', {}, 'projects.read', 'knowledge.read'),
      POST: resource('project', 'edit', {}, 'projects.edit', 'knowledge.read'),
      DELETE: resource('project', 'edit', {}, 'projects.edit'),
    },
  },
  {
    path: '/api/v1/notes',
    methods: {
      GET: resource('note', 'view', { optional: true }, 'notes.read'),
      POST: capability('notes.create'),
      PATCH: resource('note', 'edit', {}, 'notes.edit'),
      DELETE: resource('note', 'delete', {}, 'notes.delete'),
    },
  },
  {
    path: '/api/v1/outputs',
    methods: {
      GET: resource('output', 'view', { optional: true }, 'outputs.read'),
      PATCH: resource('output', 'share', {}, 'outputs.delete'),
      DELETE: resource('output', 'delete', {}, 'outputs.delete'),
    },
  },
  {
    path: '/api/v1/outputs/:outputId/content',
    methods: { GET: resource('output', 'view', {}, 'outputs.read') },
  },

  { path: '/api/v1/model-catalog', methods: { GET: capability('models.use') } },
  { path: '/api/v1/generate-title', methods: { POST: capability('models.use') } },
  { path: '/api/v1/generate-tab-group-label', methods: { POST: capability('models.use') } },
  { path: '/api/v1/generate-image', methods: { POST: capability('models.use') } },
  { path: '/api/v1/generate-video', methods: { POST: capability('models.use') } },
  { path: '/api/v1/notebook-agent', methods: { POST: capability('models.use', 'tools.use') } },
  { path: '/api/v1/browser-task', methods: { POST: capability('tools.use') } },
  { path: '/api/v1/daytona/run', methods: { POST: capability('tools.use') } },
  { path: '/api/v1/transcribe', methods: { POST: capability('tools.use') } },
  { path: '/api/v1/extensions/:extensionId/*', methods: { ALL: capability('tools.use') } },
  {
    path: '/api/v1/integrations',
    methods: { GET: capability('integrations.use'), POST: capability('integrations.use') },
  },
  {
    path: '/api/v1/skills',
    methods: {
      GET: capability('skills.use'),
      POST: capability('skills.use'),
      PATCH: capability('skills.use'),
      DELETE: capability('skills.use'),
    },
  },
  {
    path: '/api/v1/mcps',
    methods: {
      GET: capability('mcp.use'),
      POST: capability('mcp.use'),
      PATCH: capability('mcp.use'),
      DELETE: capability('mcp.use'),
    },
  },
  { path: '/api/v1/mcps/test', methods: { POST: capability('mcp.use') } },
  // The callback is authorized by its single-use, user-bound OAuth state (or the
  // sealed desktop confirmation cookie), because an identity provider redirect
  // cannot reliably carry an Overlay session. Starting and disconnecting still
  // require the ordinary MCP capability.
  {
    path: '/api/v1/mcps/oauth/callback',
    methods: { GET: publicPolicy(), POST: publicPolicy() },
  },
  {
    path: '/api/v1/mcps/oauth',
    methods: { POST: capability('mcp.use'), DELETE: capability('mcp.use') },
  },
  {
    path: '/api/v1/memory',
    methods: {
      GET: capability('memory.use'),
      POST: capability('memory.use'),
      PATCH: capability('memory.use'),
      DELETE: capability('memory.use'),
    },
  },
  { path: '/api/v1/knowledge/search', methods: { POST: capability('knowledge.read') } },
  {
    path: '/api/v1/knowledge-bases/share-directory',
    methods: { GET: capability('knowledge.share') },
  },
  {
    path: '/api/v1/knowledge-bases',
    methods: {
      GET: resource('knowledge_base', 'view', { optional: true }, 'knowledge.read'),
      POST: capability('knowledge.create'),
      PATCH: resource('knowledge_base', 'edit', {}, 'knowledge.edit'),
      DELETE: resource('knowledge_base', 'delete', {}, 'knowledge.delete'),
    },
  },
  {
    // A personal base is private by ownership; listing and creating your own
    // needs only the ordinary knowledge capabilities.
    path: '/api/v1/knowledge-bases/personal',
    methods: {
      GET: capability('knowledge.read'),
      POST: capability('knowledge.create'),
    },
  },
  {
    path: '/api/v1/knowledge-bases/:knowledgeBaseId/sources',
    methods: {
      GET: resource('knowledge_base', 'view', {}, 'knowledge.read'),
      POST: resource('knowledge_base', 'edit', {}, 'knowledge.edit'),
      PATCH: resource('knowledge_base', 'edit', {}, 'knowledge.edit'),
      DELETE: resource('knowledge_base', 'edit', {}, 'knowledge.edit'),
    },
  },
  {
    path: '/api/v1/knowledge-bases/:knowledgeBaseId/sources/upload',
    methods: {
      POST: resource('knowledge_base', 'edit', {}, 'knowledge.edit', 'files.upload'),
    },
  },
  {
    path: '/api/v1/knowledge-bases/:knowledgeBaseId/search',
    methods: { POST: resource('knowledge_base', 'view', {}, 'knowledge.read') },
  },
  {
    path: '/api/v1/knowledge-bases/:knowledgeBaseId/conversations',
    methods: { GET: resource('knowledge_base', 'view', {}, 'knowledge.read') },
  },
  {
    // Diagnostics and extraction previews expose source content, so they need the
    // same read access as retrieval itself.
    path: '/api/v1/knowledge-bases/:knowledgeBaseId/diagnostics',
    methods: { GET: resource('knowledge_base', 'view', {}, 'knowledge.read') },
  },
  {
    // Re-embedding rewrites the retrieval index, so it is an edit even though it
    // does not change source content.
    path: '/api/v1/knowledge-bases/:knowledgeBaseId/reindex',
    methods: {
      GET: resource('knowledge_base', 'view', {}, 'knowledge.read'),
      POST: resource('knowledge_base', 'edit', {}, 'knowledge.edit'),
    },
  },
  {
    path: '/api/v1/knowledge-bases/:knowledgeBaseId/grants',
    methods: {
      GET: resource('knowledge_base', 'share', {}, 'knowledge.share'),
      POST: resource('knowledge_base', 'share', {}, 'knowledge.share'),
      DELETE: resource('knowledge_base', 'share', {}, 'knowledge.share'),
    },
  },
  {
    path: '/api/v1/automations',
    methods: {
      GET: resource('automation', 'view', { optional: true }, 'automations.use'),
      POST: capability('automations.use'),
      PATCH: resource('automation', 'edit', {}, 'automations.use'),
      DELETE: resource('automation', 'delete', {}, 'automations.use'),
    },
  },
  { path: '/api/v1/automations/run', methods: { POST: capability('automations.use') } },
  { path: '/api/v1/automations/test', methods: {
    POST: resource('automation', 'execute', {}, 'automations.use'),
  } },
  { path: '/api/v1/automations/execute', methods: {
    POST: capability('automations.use'),
    PATCH: capability('automations.use'),
  } },
  {
    path: '/api/v1/automations/:id/run',
    methods: { POST: resource('automation', 'execute', {}, 'automations.use') },
  },
  {
    path: '/api/v1/automations/:runId/stream',
    methods: { GET: resource('automation', 'view', { optional: true }, 'automations.use') },
  },
  {
    path: '/api/v1/api-keys',
    methods: {
      GET: capability('api_keys.manage'),
      POST: capability('api_keys.manage'),
      PATCH: capability('api_keys.manage'),
      DELETE: capability('api_keys.manage'),
    },
  },
  {
    path: '/api/v1/webhooks',
    methods: {
      GET: capability('webhooks.manage'),
      POST: capability('webhooks.manage'),
      PATCH: capability('webhooks.manage'),
      DELETE: capability('webhooks.manage'),
    },
  },
] as const

export function getAuthorizationRoutePolicy(
  method: string,
  pathname: string,
): AuthorizationRoutePolicy | null {
  const normalizedMethod = method.toUpperCase()
  const normalizedPath = normalizePath(pathname)
  for (const rule of AUTHORIZATION_ROUTE_POLICIES) {
    if (!matchesPath(rule.path, normalizedPath)) continue
    return rule.methods[normalizedMethod] ?? rule.methods.ALL ?? null
  }
  return null
}

function normalizePath(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, '')
  return normalized || '/'
}

function matchesPath(pattern: string, pathname: string): boolean {
  const patternSegments = normalizePath(pattern).split('/').filter(Boolean)
  const pathSegments = pathname.split('/').filter(Boolean)
  let index = 0
  for (; index < patternSegments.length; index += 1) {
    const expected = patternSegments[index]
    if (expected === '*') return true
    const actual = pathSegments[index]
    if (actual === undefined) return false
    if (expected.startsWith(':')) continue
    if (expected !== actual) return false
  }
  return index === pathSegments.length
}
