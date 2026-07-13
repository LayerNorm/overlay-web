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
    reason: 'Postgres pilot mode does not yet include connector account state or external integration execution.',
  },
  {
    id: 'auth-api-keys',
    methods: '*',
    prefixes: ['/api/v1/api-keys'],
    status: 'supported',
    feature: 'api-keys',
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
      '/api/v1/conversations/share',
      '/api/v1/conversations/stop',
      '/api/v1/conversations/stream-auth',
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
  },
  {
    id: 'settings',
    methods: ['GET', 'PATCH'],
    paths: ['/api/v1/settings'],
    status: 'supported',
    feature: 'settings',
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
    status: 'unsupported',
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
