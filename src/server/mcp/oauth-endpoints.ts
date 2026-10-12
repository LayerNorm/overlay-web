import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { logger } from '@/server/observability/logger'
import { rateLimitByIp } from '@/server/security/rate-limit'
import { MCP_ACCESS_LEVELS } from '@/shared/mcp/access'
import { McpOAuthError } from './McpAccessService'
import { mcpBaseUrl, mcpUrls, withMcpCors } from './mcp-http'

const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' }
const TEN_MINUTES = 10 * 60_000
const ONE_HOUR = 60 * 60_000
const MAX_BODY_BYTES = 16_384
// Hosted apps (Claude, ChatGPT) register and exchange codes from a few shared egress IPs on behalf of
// every user, so per-IP limits here are loose abuse backstops. Registration stores nothing; a code
// exchange needs a valid, single-use, PKCE-bound code.

function oauthError(error: McpOAuthError | unknown): Response {
  if (error instanceof McpOAuthError) {
    return NextResponse.json({ error: error.error, error_description: error.message }, { status: error.statusCode, headers: NO_STORE })
  }
  logger.warn('[mcp-oauth] request failed', { error: error instanceof Error ? error.message : String(error) })
  return NextResponse.json({ error: 'server_error', error_description: 'Something went wrong. Try again.' }, { status: 500, headers: NO_STORE })
}

async function readBody(request: NextRequest): Promise<string> {
  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) throw new McpOAuthError('invalid_request', 'The request is too large.')
  return text
}

export function protectedResourceMetadata(request: Request): Response {
  const urls = mcpUrls(mcpBaseUrl(request))
  return withMcpCors(NextResponse.json({
    resource: urls.resource,
    authorization_servers: [urls.issuer],
    bearer_methods_supported: ['header'],
    resource_name: 'Overlay',
    scopes_supported: MCP_ACCESS_LEVELS.map((level) => `mcp:${level}`),
  }, { headers: { 'Cache-Control': 'public, max-age=300' } }))
}

export function authorizationServerMetadata(request: Request): Response {
  const urls = mcpUrls(mcpBaseUrl(request))
  return withMcpCors(NextResponse.json({
    issuer: urls.issuer,
    authorization_endpoint: urls.authorize,
    token_endpoint: urls.token,
    registration_endpoint: urls.register,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: MCP_ACCESS_LEVELS.map((level) => `mcp:${level}`),
  }, { headers: { 'Cache-Control': 'public, max-age=300' } }))
}

export async function handleMcpClientRegistration(request: NextRequest): Promise<Response> {
  const limited = await rateLimitByIp(request, 'mcp-oauth:register:ip', 1_200, ONE_HOUR)
  if (limited) return limited
  try {
    let metadata: unknown
    try { metadata = JSON.parse(await readBody(request)) } catch (error) {
      if (error instanceof McpOAuthError) throw error
      throw new McpOAuthError('invalid_client_metadata', 'Send the client metadata as JSON.')
    }
    return NextResponse.json(getOverlayServerContext().mcpAccess.registerClient(metadata), { status: 201, headers: NO_STORE })
  } catch (error) {
    return oauthError(error)
  }
}

export async function handleMcpTokenRequest(request: NextRequest): Promise<Response> {
  const limited = await rateLimitByIp(request, 'mcp-oauth:token:ip', 3_000, TEN_MINUTES)
  if (limited) return limited
  try {
    const text = await readBody(request)
    const contentType = request.headers.get('content-type') ?? ''
    const params = contentType.includes('application/json')
      ? new URLSearchParams(Object.entries(JSON.parse(text || '{}') as Record<string, unknown>).filter(([, value]) => typeof value === 'string') as Array<[string, string]>)
      : new URLSearchParams(text)
    return NextResponse.json(await getOverlayServerContext().mcpAccess.exchange(params), { headers: NO_STORE })
  } catch (error) {
    if (error instanceof SyntaxError) return oauthError(new McpOAuthError('invalid_request', 'The request body could not be read.'))
    return oauthError(error)
  }
}
