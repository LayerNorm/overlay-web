import 'server-only'

import type { AppDataCapabilities, AppDataProvider } from './capabilities'

export type AppDataRouteSupportStatus = 'supported' | 'degraded' | 'unsupported'

export interface AppDataRouteSupport {
  status: AppDataRouteSupportStatus
  feature: string
  reason?: string
}

export interface AppDataRouteSupportRule {
  id: string
  methods: readonly string[] | '*'
  paths?: readonly string[]
  prefixes?: readonly string[]
  status: AppDataRouteSupportStatus
  feature: string
  reason?: string
}

export const POSTGRES_APP_DATA_ROUTE_SUPPORT_RULES: readonly AppDataRouteSupportRule[] = [
  {
    id: 'administration',
    methods: '*',
    prefixes: ['/api/v1/admin'],
    status: 'supported',
    feature: 'administration',
  },
  {
    id: 'bootstrap',
    methods: ['GET'],
    paths: ['/api/v1/bootstrap'],
    status: 'supported',
    feature: 'app-shell',
  },
  {
    id: 'capabilities',
    methods: ['GET'],
    paths: ['/api/v1/capabilities'],
    status: 'supported',
    feature: 'app-shell',
  },
  {
    id: 'discovery',
    methods: ['GET'],
    paths: ['/api/v1/discovery'],
    status: 'supported',
    feature: 'server-discovery',
  },
  {
    id: 'model-catalog',
    methods: ['GET'],
    paths: ['/api/v1/model-catalog'],
    status: 'supported',
    feature: 'model-catalog',
  },
  {
    id: 'integrations',
    methods: '*',
    paths: ['/api/v1/integrations'],
    status: 'unsupported',
    feature: 'integrations',
    reason: 'Postgres mode does not yet include connector account state or external integration execution.',
  },
  {
    id: 'auth-api-keys',
    methods: '*',
    prefixes: ['/api/v1/api-keys'],
    status: 'supported',
    feature: 'api-keys',
  },
  {
    id: 'connected-agent-control-plane',
    methods: '*',
    prefixes: ['/api/v1/agent-environments', '/api/v1/agent-bindings'],
    status: 'supported',
    feature: 'connected-agent-control-plane',
  },
  {
    id: 'slack-imports-convex-only',
    methods: '*',
    prefixes: ['/api/v1/imports/slack'],
    status: 'unsupported',
    feature: 'external-imports',
    reason: 'Slack import job state and its worker bridge still use Convex.',
  },
  {
    id: 'mention-search-convex-only',
    methods: ['GET'],
    paths: ['/api/v1/mention-search'],
    status: 'degraded',
    feature: 'workspace-search',
    reason: 'PostgreSQL mode returns an empty bounded result until provider-neutral mention indexes land.',
  },
  {
    id: 'automations',
    methods: '*',
    prefixes: ['/api/v1/automations'],
    status: 'supported',
    feature: 'automations',
  },
  {
    id: 'conversations',
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    paths: ['/api/v1/conversations'],
    status: 'supported',
    feature: 'chat-persistence',
  },
  {
    id: 'conversation-realtime-and-mutations',
    methods: '*',
    prefixes: [
      '/api/v1/conversations/events',
      '/api/v1/conversations/message',
      '/api/v1/conversations/run',
      '/api/v1/conversations/share',
      '/api/v1/conversations/stop',
    ],
    status: 'supported',
    feature: 'chat-realtime',
  },
  {
    id: 'conversations-act',
    methods: ['POST'],
    paths: ['/api/v1/conversations/act'],
    status: 'supported',
    feature: 'chat-send',
  },
  {
    id: 'link-preview-embeddability',
    methods: ['GET'],
    paths: ['/api/v1/link-preview'],
    status: 'supported',
    feature: 'chat-send',
  },
  {
    id: 'conversation-title-generation',
    methods: ['POST'],
    paths: ['/api/v1/generate-title'],
    status: 'supported',
    feature: 'chat-persistence',
  },
  {
    id: 'chat-suggestions',
    methods: '*',
    prefixes: ['/api/v1/chat-suggestions'],
    status: 'supported',
    feature: 'chat-suggestions',
  },
  {
    id: 'notebook-agent',
    methods: '*',
    prefixes: ['/api/v1/notebook-agent'],
    status: 'supported',
    feature: 'usage-accounting',
  },
  {
    id: 'chat-extension-plan',
    methods: '*',
    prefixes: ['/api/v1/conversations/act/extension-plan'],
    status: 'unsupported',
    feature: 'integrations',
    reason: 'Postgres mode does not expose connector-backed chat extensions.',
  },
  {
    id: 'workspace-collaboration',
    methods: '*',
    prefixes: [
      '/api/v1/agents',
      '/api/v1/conversations',
      '/api/v1/workspaces',
    ],
    status: 'supported',
    feature: 'workspace-collaboration',
  },
  {
    id: 'settings',
    methods: ['GET', 'PATCH'],
    paths: ['/api/v1/settings'],
    status: 'supported',
    feature: 'settings',
  },
  {
    id: 'provider-connections',
    methods: '*',
    prefixes: ['/api/v1/providers/connections'],
    status: 'supported',
    feature: 'provider-connections',
  },
  {
    id: 'onboarding',
    methods: ['GET', 'POST'],
    paths: [
      '/api/v1/onboarding/status',
      '/api/v1/onboarding/complete',
      '/api/v1/onboarding/reset',
    ],
    status: 'supported',
    feature: 'onboarding',
  },
  {
    id: 'notes',
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    paths: ['/api/v1/notes'],
    status: 'supported',
    feature: 'notes',
  },
  {
    id: 'convex-file-ingest-worker',
    methods: ['POST'],
    paths: ['/api/v1/files/ingest-jobs/process'],
    status: 'unsupported',
    feature: 'file-lifecycle',
    reason: 'This internal worker bridge updates the Convex ingestion queue and is disabled in PostgreSQL mode.',
  },
  {
    id: 'files',
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    prefixes: ['/api/v1/files'],
    status: 'supported',
    feature: 'file-lifecycle',
  },
  {
    id: 'outputs',
    methods: '*',
    prefixes: ['/api/v1/outputs'],
    status: 'supported',
    feature: 'outputs',
  },
  {
    id: 'workflows',
    methods: '*',
    prefixes: ['/api/v1/workflows'],
    status: 'supported',
    feature: 'automations',
  },
  {
    id: 'generation-usage-and-outputs',
    methods: '*',
    prefixes: [
      '/api/v1/browser-task',
      '/api/v1/daytona',
      '/api/v1/generate-image',
      '/api/v1/generate-video',
    ],
    status: 'supported',
    feature: 'generated-outputs',
  },
  {
    id: 'generation-usage-only',
    methods: '*',
    prefixes: [
      '/api/v1/generate-tab-group-label',
      '/api/v1/transcribe',
    ],
    status: 'supported',
    feature: 'usage-accounting',
  },
  {
    id: 'knowledge-memory-vector-search',
    methods: '*',
    prefixes: ['/api/v1/knowledge', '/api/v1/memory'],
    status: 'supported',
    feature: 'vector-search',
  },
  {
    id: 'mcp-and-skills',
    methods: '*',
    prefixes: ['/api/v1/mcps', '/api/v1/skills'],
    status: 'supported',
    feature: 'integration-metadata',
  },
  {
    id: 'projects',
    methods: '*',
    prefixes: ['/api/v1/projects'],
    status: 'supported',
    feature: 'projects',
  },
  {
    id: 'subscription-and-billing-records',
    methods: '*',
    prefixes: ['/api/v1/subscription'],
    status: 'supported',
    feature: 'billing-records',
  },
  {
    id: 'webhooks',
    methods: '*',
    prefixes: ['/api/v1/webhooks'],
    status: 'supported',
    feature: 'webhooks',
  },
  {
    id: 'extension-proxy',
    methods: '*',
    prefixes: ['/api/v1/extensions'],
    status: 'unsupported',
    feature: 'extensions',
  },
  {
    id: 'workspace-collaboration-gated',
    methods: '*',
    prefixes: [
      // These surfaces are shipped for Convex but do not have Postgres
      // repositories yet. Keep this rule after supported conversation routes
      // so the core Postgres chat contract remains available.
      '/api/v1/knowledge-bases',
      '/api/v1/search',
      '/api/v1/shares',
      '/api/v1/workspace-invitations',
    ],
    status: 'unsupported',
    feature: 'workspace-collaboration',
    reason: 'Postgres mode gates workspace and collaboration surfaces until provider-neutral repositories and authorization contracts are available.',
  },
]

export function getAppDataRouteSupport(args: {
  appDataCapabilities: AppDataCapabilities
  method: string
  pathname: string
}): AppDataRouteSupport {
  if (args.appDataCapabilities.provider === 'convex') {
    return { status: 'supported', feature: 'convex-app-data' }
  }

  const rule = findPostgresRouteRule(args.method, normalizeRoutePath(args.pathname))
  if (!rule) {
    return {
      status: 'unsupported',
      feature: 'unclassified',
      reason: 'This route has not been classified for Postgres app-data mode.',
    }
  }
  return {
    status: rule.status,
    feature: rule.feature,
    reason: rule.reason,
  }
}

export function findPostgresRouteRule(
  method: string,
  pathname: string,
): AppDataRouteSupportRule | null {
  const normalizedMethod = method.toUpperCase()
  const normalizedPathname = normalizeRoutePath(pathname)
  return POSTGRES_APP_DATA_ROUTE_SUPPORT_RULES.find((rule) => {
    const methodMatches = rule.methods === '*' || rule.methods.includes(normalizedMethod)
    if (!methodMatches) return false
    if (rule.paths?.includes(normalizedPathname)) return true
    return rule.prefixes?.some((prefix) =>
      normalizedPathname === prefix || normalizedPathname.startsWith(`${prefix}/`),
    ) ?? false
  }) ?? null
}

export function appDataRouteUnsupportedResponse(args: {
  databaseProvider: AppDataProvider
  method: string
  pathname: string
  support: AppDataRouteSupport
}): Response {
  return Response.json(
    {
      error: 'Route is not available for the selected app-data provider',
      code: 'app_data_route_not_supported',
      provider: args.databaseProvider,
      method: args.method.toUpperCase(),
      route: normalizeRoutePath(args.pathname),
      feature: args.support.feature,
      reason: args.support.reason ?? 'This route is waiting for a Postgres repository implementation.',
    },
    { status: 501 },
  )
}

export function normalizeRoutePath(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/'
}
