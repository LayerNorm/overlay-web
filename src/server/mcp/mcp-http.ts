import 'server-only'

import { getBaseUrl } from '@/server/web/app-url'

/**
 * Bearer-only endpoints (no cookies) that other AI apps call, some of them from a
 * browser (MCP Inspector, web clients): any origin may read the response, and
 * credentials are never sent, so this exposes nothing a token does not already allow.
 */
export const MCP_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id',
  'Access-Control-Expose-Headers': 'WWW-Authenticate',
  'Access-Control-Max-Age': '86400',
}

export function mcpPreflight(): Response {
  return new Response(null, { status: 204, headers: MCP_CORS_HEADERS })
}

export function withMcpCors(response: Response): Response {
  for (const [name, value] of Object.entries(MCP_CORS_HEADERS)) response.headers.set(name, value)
  return response
}

/**
 * The address clients should use. The app may be served from two hosts (an apex that redirects to
 * `www`), and OAuth clients compare the resource and issuer they are told with the address they called,
 * so the URLs advertised are built from the host the request arrived on, but only if that is the app's
 * own host or its `www` twin. Anything else falls back to the configured app URL.
 */
export function mcpBaseUrl(request?: Pick<Request, 'url' | 'headers'>): string {
  const configured = getBaseUrl()
  if (!request) return configured
  try {
    const own = new URL(configured)
    const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
    const seen = new URL(request.url)
    const host = (forwardedHost || seen.host).toLowerCase()
    const bare = (value: string) => value.replace(/^www\./, '')
    if (bare(host) !== bare(own.host.toLowerCase())) return configured
    return `${own.protocol}//${host}`
  } catch (_error) {
    return configured
  }
}

export function mcpUrls(base = getBaseUrl()) {
  return {
    issuer: base,
    resource: `${base}/api/mcp`,
    resourceMetadata: `${base}/.well-known/oauth-protected-resource/api/mcp`,
    authorize: `${base}/oauth/authorize`,
    token: `${base}/api/oauth/token`,
    register: `${base}/api/oauth/register`,
  }
}
