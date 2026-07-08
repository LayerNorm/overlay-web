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
    status: 'degraded',
    feature: 'app-shell',
    reason: 'Bootstrap falls back to session user, default settings, and null entitlements.',
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
    methods: ['GET', 'POST'],
    paths: ['/api/v1/integrations'],
    status: 'supported',
    feature: 'integrations',
    reason: 'Composio integration state is external to Overlay app-data.',
  },
  {
    id: 'auth-api-keys',
    methods: '*',
    prefixes: ['/api/v1/api-keys'],
    status: 'unsupported',
    feature: 'api-keys',
  },
  {
    id: 'automations',
    methods: '*',
    prefixes: ['/api/v1/automations'],
    status: 'unsupported',
    feature: 'automations',
  },
  {
    id: 'chat',
    methods: '*',
    prefixes: ['/api/v1/chat-suggestions', '/api/v1/conversations', '/api/v1/notebook-agent'],
    status: 'unsupported',
    feature: 'chat-persistence',
  },
  {
    id: 'files-and-outputs',
    methods: '*',
    prefixes: ['/api/v1/files', '/api/v1/outputs'],
    status: 'unsupported',
    feature: 'file-metadata',
  },
  {
    id: 'generation-usage-and-outputs',
    methods: '*',
    prefixes: [
      '/api/v1/browser-task',
      '/api/v1/daytona',
      '/api/v1/generate-image',
      '/api/v1/generate-tab-group-label',
      '/api/v1/generate-title',
      '/api/v1/generate-video',
      '/api/v1/transcribe',
    ],
    status: 'unsupported',
    feature: 'usage-accounting',
  },
  {
    id: 'knowledge-memory-vector-search',
    methods: '*',
    prefixes: ['/api/v1/knowledge', '/api/v1/memory'],
    status: 'unsupported',
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
    id: 'notes-projects-settings-onboarding',
    methods: '*',
    prefixes: ['/api/v1/notes', '/api/v1/onboarding', '/api/v1/projects', '/api/v1/settings'],
    status: 'unsupported',
    feature: 'app-data-records',
  },
  {
    id: 'subscription-and-billing-records',
    methods: '*',
    prefixes: ['/api/v1/subscription'],
    status: 'unsupported',
    feature: 'billing-records',
  },
  {
    id: 'webhooks',
    methods: '*',
    prefixes: ['/api/v1/webhooks'],
    status: 'unsupported',
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
