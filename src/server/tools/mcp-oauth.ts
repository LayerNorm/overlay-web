import 'server-only'

import { createHmac } from 'node:crypto'
import { getOverlayServerContext } from '@/server/bootstrap'
import { logger } from '@/server/observability/logger'
import { createGuardedFetch } from '@/server/security/guarded-fetch'
import {
  createMcpOAuthSessionId,
  McpCredentialCipher,
  mcpOAuthSessionExpiry,
  McpOAuthProvider,
  type McpOAuthClient,
  type McpOAuthSurface,
  type McpOAuthTokens,
  type McpServerRecord,
} from '@/server/extensions'

/**
 * Orchestrates MCP OAuth: discovery, dynamic client registration, the authorization redirect, the
 * code exchange, and non-interactive refresh. All network calls run through the guarded fetch,
 * because every endpoint address originates from the remote server's own metadata document.
 */

type AuthModule = typeof import('@modelcontextprotocol/sdk/client/auth.js')

let authModule: AuthModule | undefined

async function loadAuthModule(): Promise<AuthModule> {
  authModule ??= await import('@modelcontextprotocol/sdk/client/auth.js')
  return authModule
}

function repository() {
  return getOverlayServerContext().appData.repositories.mcpServers
}

export function mcpOAuthRedirectUri(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}/api/v1/mcps/oauth/callback`
}

/**
 * Bind a browser-started flow to its account without storing the account identifier itself.
 *
 * A plain digest is reversible by enumeration for a stable user id. The credential-encryption key
 * is already required to persist this flow's verifier, so use it as an HMAC key rather than adding
 * a second secret or pretending a password KDF is the right primitive for a deterministic lookup.
 */
export function hashSessionBinding(value: string): string {
  const key = process.env.MCP_CREDENTIAL_ENCRYPTION_KEY?.trim()
  if (!key || key.length < 32) {
    throw new McpCredentialConfigurationError(
      'MCP_CREDENTIAL_ENCRYPTION_KEY is required before starting an authenticated MCP OAuth flow',
    )
  }
  return createHmac('sha256', key).update(`mcp-oauth-binding:v1:${value}`).digest('hex')
}

export const MCP_OAUTH_CONFIRM_COOKIE = 'overlay_mcp_oauth_confirm'
const CONFIRM_TTL_MS = 5 * 60 * 1000

export interface McpOAuthConfirmPayload {
  mcpServerId: string
  userId: string
  codeVerifier: string
  authorizationCode: string
  expiresAt: number
}

/**
 * The desktop flow returns through a browser that may hold no Overlay session, so there is no
 * cookie to bind against. Instead the callback consumes the single-use state immediately (keeping
 * replay protection), parks the in-flight exchange in this sealed cookie, and only completes it
 * after the user explicitly confirms — which is what stops a leaked authorization URL from silently
 * attaching someone else's account.
 */
export function sealOAuthConfirmation(payload: Omit<McpOAuthConfirmPayload, 'expiresAt'>): string {
  const cipher = McpCredentialCipher.fromEnvironment()
  const sealed = cipher.encrypt({
    bearerToken: JSON.stringify({ ...payload, expiresAt: Date.now() + CONFIRM_TTL_MS }),
  })
  if (!sealed) throw new Error('Failed to seal MCP OAuth confirmation')
  return sealed
}

export function openOAuthConfirmation(value: string | undefined): McpOAuthConfirmPayload | null {
  if (!value) return null
  try {
    const opened = McpCredentialCipher.fromEnvironment().decrypt(value)
    if (!opened?.bearerToken) return null
    const payload = JSON.parse(opened.bearerToken) as McpOAuthConfirmPayload
    if (!payload.mcpServerId || !payload.userId || !payload.authorizationCode) return null
    if (payload.expiresAt < Date.now()) return null
    return payload
  } catch (_error) {
    return null
  }
}

export interface StartMcpOAuthResult {
  authorizationUrl: string
  sessionId: string
}

/**
 * Phase one of Connect: discover the server's OAuth configuration, register a client if the server
 * supports DCR, persist a single-use session carrying the PKCE verifier, and return the URL the
 * browser should visit.
 */
export async function startMcpOAuth(args: {
  server: McpServerRecord
  baseUrl: string
  surface: McpOAuthSurface
  returnTo?: string
  sessionBinding?: string
  scope?: string
}): Promise<StartMcpOAuthResult> {
  const { auth } = await loadAuthModule()
  const sessionId = createMcpOAuthSessionId()
  let codeVerifier: string | undefined

  const provider = new McpOAuthProvider({
    clientUri: args.baseUrl,
    initialClient: args.server.oauthClient,
    initialTokenVersion: args.server.oauthTokenVersion,
    mcpServerId: args.server._id,
    onRedirect: () => undefined,
    onSaveCodeVerifier: (verifier) => { codeVerifier = verifier },
    redirectUri: mcpOAuthRedirectUri(args.baseUrl),
    repository: repository(),
    scope: args.scope ?? args.server.oauthScope,
    serverName: args.server.name,
    stateValue: sessionId,
    userId: args.server.userId,
  })

  const result = await auth(provider as never, {
    fetchFn: createGuardedFetch({ timeoutMs: 15_000 }) as never,
    scope: args.scope ?? args.server.oauthScope,
    serverUrl: args.server.url,
  })

  if (result === 'AUTHORIZED') {
    // Already holds usable tokens — nothing to authorize.
    await provider.setStatus('connected')
    throw new McpOAuthAlreadyAuthorizedError(args.server.name)
  }

  const authorizationUrl = provider.authorizationUrl
  if (!authorizationUrl || !codeVerifier) {
    throw new Error('MCP OAuth provider did not produce an authorization URL')
  }

  await repository().createOAuthSession({
    codeVerifier,
    expiresAt: mcpOAuthSessionExpiry(),
    id: sessionId,
    mcpServerId: args.server._id,
    returnTo: args.returnTo,
    sessionBindingHash: args.sessionBinding ? hashSessionBinding(args.sessionBinding) : undefined,
    surface: args.surface,
    userId: args.server.userId,
  })
  await repository().updateOAuthState({
    error: null,
    mcpServerId: args.server._id,
    status: 'pending',
    userId: args.server.userId,
  })

  return { authorizationUrl: authorizationUrl.toString(), sessionId }
}

export class McpOAuthAlreadyAuthorizedError extends Error {
  constructor(serverName: string) {
    super(`${serverName} is already connected`)
    this.name = 'McpOAuthAlreadyAuthorizedError'
  }
}

/** Phase two of Connect: exchange the authorization code for tokens and store them. */
export async function completeMcpOAuth(args: {
  server: McpServerRecord
  baseUrl: string
  authorizationCode: string
  codeVerifier: string
}): Promise<void> {
  const { auth } = await loadAuthModule()
  const provider = new McpOAuthProvider({
    clientUri: args.baseUrl,
    codeVerifierValue: args.codeVerifier,
    initialClient: args.server.oauthClient,
    initialTokenVersion: args.server.oauthTokenVersion,
    mcpServerId: args.server._id,
    onRedirect: () => undefined,
    redirectUri: mcpOAuthRedirectUri(args.baseUrl),
    repository: repository(),
    scope: args.server.oauthScope,
    serverName: args.server.name,
    userId: args.server.userId,
  })

  const result = await auth(provider as never, {
    authorizationCode: args.authorizationCode,
    fetchFn: createGuardedFetch({ timeoutMs: 15_000 }) as never,
    serverUrl: args.server.url,
  })

  if (result !== 'AUTHORIZED') {
    throw new Error('MCP OAuth token exchange did not complete')
  }
}

/**
 * Serializes refresh per server within this process. Servers that rotate refresh tokens invalidate
 * the old one on use, so two concurrent tool calls refreshing at once would leave one holding a
 * dead token. The repository's compare-and-set covers the cross-process case; this avoids the
 * common single-process race entirely.
 */
const refreshInFlight = new Map<string, Promise<McpOAuthTokens | undefined>>()

export async function ensureFreshMcpOAuthTokens(args: {
  server: McpServerRecord
  baseUrl: string
  /** Refresh this many ms before actual expiry so a long tool call does not expire mid-flight. */
  skewMs?: number
}): Promise<McpOAuthTokens | undefined> {
  const tokens = args.server.oauthTokens
  if (!tokens) return undefined
  const skew = args.skewMs ?? 60_000
  if (!tokens.expiresAt || tokens.expiresAt - skew > Date.now()) return tokens
  if (!tokens.refreshToken) return tokens

  const key = args.server._id
  const existing = refreshInFlight.get(key)
  if (existing) return existing

  const pending = refreshTokens(args).finally(() => refreshInFlight.delete(key))
  refreshInFlight.set(key, pending)
  return pending
}

async function refreshTokens(args: {
  server: McpServerRecord
  baseUrl: string
}): Promise<McpOAuthTokens | undefined> {
  const { auth } = await loadAuthModule()
  const provider = new McpOAuthProvider({
    clientUri: args.baseUrl,
    initialClient: args.server.oauthClient,
    initialTokens: args.server.oauthTokens,
    initialTokenVersion: args.server.oauthTokenVersion,
    mcpServerId: args.server._id,
    redirectUri: mcpOAuthRedirectUri(args.baseUrl),
    repository: repository(),
    // No onRedirect: a runtime refresh that needs a human must throw, not hang.
    serverName: args.server.name,
    userId: args.server.userId,
  })

  try {
    await auth(provider as never, {
      fetchFn: createGuardedFetch({ timeoutMs: 15_000 }) as never,
      serverUrl: args.server.url,
    })
  } catch (error) {
    logger.warn('[MCP] OAuth refresh failed', {
      mcpServerId: args.server._id,
      reason: error instanceof Error ? error.message : 'unknown',
    })
    await provider.markNeedsReauth('The stored OAuth session could not be refreshed')
    throw error
  }

  const fresh = await repository().get({
    mcpServerId: args.server._id,
    userId: args.server.userId,
  })
  return fresh?.oauthTokens
}

export async function disconnectMcpOAuth(args: {
  server: McpServerRecord
  client?: McpOAuthClient
}): Promise<void> {
  await repository().updateOAuthState({
    client: null,
    error: null,
    mcpServerId: args.server._id,
    status: undefined,
    tokens: null,
    userId: args.server.userId,
  })
}
