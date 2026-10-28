import type { OverlayCapability } from '@overlay/app-core'

export const CAPABILITY_LABELS: Record<OverlayCapability, string> = {
  chat: 'Chat',
  files: 'Files',
  memory: 'Memory',
  knowledge: 'Knowledge',
  integrations: 'Integrations',
  skills: 'Skills',
  mcpServers: 'MCP servers',
  sandboxes: 'Sandboxes',
  webSearch: 'Web search',
  analytics: 'Analytics',
  errorReporting: 'Error reporting',
  modelRouting: 'Model routing',
  billing: 'Billing',
  sso: 'SSO',
  apiKeys: 'API key management',
  webhooks: 'Webhook management',
  vectorSearch: 'Vector search',
  automations: 'Automation scheduling',
  multiTenant: 'Multi-tenant support',
  connectedAgents: 'Connected agents',
  externalAgents: 'External agents',
  computers: 'Computers',
  cloudAgents: 'Agents on Overlay Cloud',
  work: 'Work',
}

export type CapabilityDisabledError = {
  error: string
  code: 'capability_disabled'
  capability: OverlayCapability
}

function normalizePath(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, '')
  return normalized || '/'
}

function startsWithRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`)
}

function getAgentEnvironmentRequiredCapability(
  method: string,
  pathname: string,
): OverlayCapability | null {
  if (pathname === '/api/v1/agent-environments' && method === 'GET') return null
  if (pathname.endsWith('/commands') && method === 'GET') return null
  if (
    /^\/api\/v1\/agent-environments\/[^/]+\/commands\/[^/]+\/ack$/.test(pathname)
    || pathname.endsWith('/events')
    || pathname.endsWith('/heartbeat')
    || pathname.endsWith('/capabilities')
    || pathname === '/api/v1/agent-environments/operations/reconcile'
    || pathname.endsWith('/artifacts/cleanup')
    || pathname.endsWith('/revoke')
    || pathname.endsWith('/credentials/refresh')
    || pathname === '/api/v1/agent-environments/artifacts/cleanup'
  ) return null
  return 'externalAgents'
}

export function getRequiredCapabilityForRoute(
  method: string,
  pathname: string,
): OverlayCapability | null {
  const normalizedPath = normalizePath(pathname)
  const normalizedMethod = method.toUpperCase()

  if (startsWithRoute(normalizedPath, '/api/v1/subscription')) return 'billing'
  if (startsWithRoute(normalizedPath, '/api/v1/webhooks')) return 'webhooks'
  if (startsWithRoute(normalizedPath, '/api/v1/api-keys')) return 'apiKeys'
  if (startsWithRoute(normalizedPath, '/api/v1/automations')) return 'automations'
  if (startsWithRoute(normalizedPath, '/api/v1/computers')) return 'computers'
  if (startsWithRoute(normalizedPath, '/api/v1/work')) return 'work'
  if (startsWithRoute(normalizedPath, '/api/v1/agent-environments')) {
    return getAgentEnvironmentRequiredCapability(normalizedMethod, normalizedPath)
  }
  if (startsWithRoute(normalizedPath, '/api/v1/agent-bindings')) {
    return normalizedMethod === 'GET' || normalizedMethod === 'DELETE' ? null : 'externalAgents'
  }
  if (startsWithRoute(normalizedPath, '/api/v1/provider-accounts')) {
    return normalizedMethod === 'GET' || normalizedMethod === 'DELETE' ? null : 'externalAgents'
  }
  if (startsWithRoute(normalizedPath, '/api/v1/integrations')) return 'integrations'
  if (startsWithRoute(normalizedPath, '/api/v1/skills')) return 'skills'
  if (startsWithRoute(normalizedPath, '/api/v1/mcps')) return 'mcpServers'
  if (startsWithRoute(normalizedPath, '/api/v1/providers/connections')) return 'modelRouting'
  if (startsWithRoute(normalizedPath, '/api/v1/memory')) return 'memory'
  if (startsWithRoute(normalizedPath, '/api/v1/files')) return 'files'
  if (normalizedPath === '/api/v1/knowledge/search') return 'vectorSearch'

  return null
}

export function getCapabilityDisabledError(
  capability: OverlayCapability,
): CapabilityDisabledError {
  return {
    error: `${CAPABILITY_LABELS[capability]} is disabled for this deployment.`,
    code: 'capability_disabled',
    capability,
  }
}
