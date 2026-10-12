import 'server-only'

import { randomUUID } from 'node:crypto'
import type { AuditService } from '@/server/admin'
import { isMcpAccessLevel, MCP_ACCESS_LABEL, type McpAccessLevel } from '@/shared/mcp/access'
import type { McpGrantRecord, McpGrantRepository } from './McpGrantRepository'
import {
  MCP_ACCESS_TOKEN_TTL_MS,
  MCP_CODE_TTL_MS,
  MCP_REFRESH_TOKEN_TTL_MS,
  openMcpValue,
  pkceMatches,
  sealMcpValue,
} from './mcp-tokens'

export const MAX_ACTIVE_MCP_GRANTS_PER_USER = 50
const MAX_REDIRECT_URIS = 10
const MAX_REDIRECT_URI_LENGTH = 1_024
const MAX_CLIENT_NAME_LENGTH = 80
const MAX_PERSONAL_TOKEN_DAYS = 365
const FORBIDDEN_REDIRECT_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'about:', 'blob:'])

/** OAuth-shaped failure: `error` is the RFC 6749 code a client expects. */
export class McpOAuthError extends Error {
  constructor(readonly error: string, message: string, readonly statusCode = 400) {
    super(message)
    this.name = 'McpOAuthError'
  }
}

export type McpPrincipal = {
  grantId: string
  userId: string
  workspaceId: string
  access: McpAccessLevel
  clientName: string
}

export type McpTokenResponse = {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  refresh_token: string
  scope: string
}

type WorkspaceAccessCheck = { resolveActiveWorkspace(userId: string, workspaceId?: string): Promise<unknown> }

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : ''
}

function validRedirectUri(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_REDIRECT_URI_LENGTH) return false
  let url: URL
  try { url = new URL(value) } catch (_error) { return false }
  if (url.hash) return false
  if (FORBIDDEN_REDIRECT_SCHEMES.has(url.protocol)) return false
  if (url.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  // https for web apps; a custom scheme for desktop and local apps (cursor://, claude://, …).
  return true
}

/**
 * Lets another AI app use a person's Overlay workspace over MCP, with the person's
 * consent: OAuth 2.1 (dynamic client registration, authorization code with PKCE,
 * rotating refresh tokens) for apps like ChatGPT and Claude, and personal tokens
 * for local agents. Everything the app can later do is bounded by its grant row
 * (person, workspace, access level) and ends when the person revokes it.
 */
export class McpAccessService {
  constructor(private readonly dependencies: {
    grants: McpGrantRepository
    workspaces: WorkspaceAccessCheck
    audit: Pick<AuditService, 'record'>
    now?: () => number
  }) {}

  registerClient(metadata: unknown): { client_id: string; client_name: string; redirect_uris: string[]; token_endpoint_auth_method: 'none'; grant_types: string[]; response_types: string[] } {
    const body = (metadata && typeof metadata === 'object' ? metadata : {}) as Record<string, unknown>
    const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : []
    if (uris.length === 0 || uris.length > MAX_REDIRECT_URIS || !uris.every(validRedirectUri)) {
      throw new McpOAuthError('invalid_redirect_uri', 'Provide up to 10 redirect URIs: https, http on localhost, or an app scheme.')
    }
    const name = cleanText(body.client_name, MAX_CLIENT_NAME_LENGTH) || 'An AI app'
    const clientId = sealMcpValue('client', { ru: [...new Set(uris as string[])], n: name })
    if (!clientId) throw new McpOAuthError('server_error', 'MCP access is not configured on this server.', 503)
    return {
      client_id: clientId, client_name: name, redirect_uris: [...new Set(uris as string[])],
      token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
    }
  }

  describeClient(clientId: string): { name: string; redirectUris: string[] } | null {
    const payload = openMcpValue('client', clientId)
    if (!payload || !Array.isArray(payload.ru) || typeof payload.n !== 'string') return null
    return { name: payload.n, redirectUris: payload.ru.filter((uri): uri is string => typeof uri === 'string') }
  }

  /** The person approved: issue a single-use code bound to the client, redirect, challenge, workspace, and level. */
  async approveAuthorization(args: {
    userId: string; workspaceId: string; access: unknown; clientId: string; redirectUri: string; codeChallenge: string; state?: string
  }): Promise<{ redirectUrl: string }> {
    const client = this.requireClient(args.clientId, args.redirectUri)
    if (!isMcpAccessLevel(args.access)) throw new McpOAuthError('invalid_request', 'Choose what the app can do.')
    if (!/^[A-Za-z0-9\-._~]{43}$/.test(args.codeChallenge)) throw new McpOAuthError('invalid_request', 'A PKCE S256 code challenge is required.')
    await this.requireMember(args.userId, args.workspaceId)
    const code = sealMcpValue('code', {
      id: randomUUID(), uid: args.userId, ws: args.workspaceId, ac: args.access, cid: args.clientId,
      cn: client.name, ru: args.redirectUri, cc: args.codeChallenge,
    }, MCP_CODE_TTL_MS)
    if (!code) throw new McpOAuthError('server_error', 'MCP access is not configured on this server.', 503)
    return { redirectUrl: redirectWith(args.redirectUri, { code, ...(args.state ? { state: args.state } : {}) }) }
  }

  denyAuthorization(args: { clientId: string; redirectUri: string; state?: string }): { redirectUrl: string } {
    this.requireClient(args.clientId, args.redirectUri)
    return { redirectUrl: redirectWith(args.redirectUri, { error: 'access_denied', ...(args.state ? { state: args.state } : {}) }) }
  }

  /** `POST /api/oauth/token`: authorization_code or refresh_token. */
  async exchange(params: URLSearchParams): Promise<McpTokenResponse> {
    const grantType = params.get('grant_type')
    if (grantType === 'authorization_code') return await this.exchangeCode(params)
    if (grantType === 'refresh_token') return await this.exchangeRefresh(params)
    throw new McpOAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token.')
  }

  /** A long-lived token for a local agent that does not do OAuth. Shown once; revocable like any grant. */
  async createPersonalToken(args: { userId: string; workspaceId: string; access: unknown; name: unknown; ttlDays?: number }): Promise<{ token: string; grant: McpGrantRecord }> {
    if (!isMcpAccessLevel(args.access)) throw new McpOAuthError('invalid_request', 'Choose what the token can do.')
    const name = cleanText(args.name, MAX_CLIENT_NAME_LENGTH) || 'Personal token'
    await this.requireMember(args.userId, args.workspaceId)
    const days = Math.min(MAX_PERSONAL_TOKEN_DAYS, Math.max(1, Math.floor(args.ttlDays ?? 90)))
    const now = this.now()
    const expiresAt = now + days * 24 * 60 * 60_000
    const created = await this.dependencies.grants.create({
      userId: args.userId, workspaceId: args.workspaceId, access: args.access, kind: 'token', clientName: name,
      expiresAt, maxActive: MAX_ACTIVE_MCP_GRANTS_PER_USER, now,
    })
    if (!created.ok || !created.id) throw grantFailure(created.reason)
    const token = sealMcpValue('personal', { g: created.id }, expiresAt - now)
    if (!token) throw new McpOAuthError('server_error', 'MCP access is not configured on this server.', 503)
    await this.audit('mcp.token.created', args.userId, created.id, { access: args.access, workspaceId: args.workspaceId })
    const grant = await this.dependencies.grants.get({ grantId: created.id })
    return { token, grant: grant! }
  }

  /** Resolves a bearer credential to who may act and where, or null (revoked, expired, left the workspace). */
  async authenticate(bearer: string | null): Promise<McpPrincipal | null> {
    const payload = openMcpValue('access', bearer) ?? openMcpValue('personal', bearer)
    const grantId = typeof payload?.g === 'string' ? payload.g : null
    if (!grantId) return null
    const grant = await this.dependencies.grants.get({ grantId }).catch((_error) => null)
    if (!grant || grant.revokedAt !== undefined) return null
    if (grant.expiresAt !== undefined && grant.expiresAt <= this.now()) return null
    // The person may have left the workspace since they connected the app.
    const member = await this.dependencies.workspaces.resolveActiveWorkspace(grant.userId, grant.workspaceId).then(() => true, () => false)
    if (!member) return null
    void this.dependencies.grants.touch({ grantId, now: this.now() }).catch((_error) => undefined)
    return { grantId, userId: grant.userId, workspaceId: grant.workspaceId, access: grant.access, clientName: grant.clientName }
  }

  async list(userId: string): Promise<McpGrantRecord[]> {
    return await this.dependencies.grants.listActive({ userId })
  }

  async revoke(userId: string, grantId: string): Promise<boolean> {
    const revoked = await this.dependencies.grants.revoke({ grantId, userId, now: this.now() })
    if (revoked) await this.audit('mcp.grant.revoked', userId, grantId, {})
    return revoked
  }

  private async exchangeCode(params: URLSearchParams): Promise<McpTokenResponse> {
    const payload = openMcpValue('code', params.get('code'))
    if (!payload) throw new McpOAuthError('invalid_grant', 'The authorization code is invalid or expired.')
    const clientId = params.get('client_id')
    if (!clientId || clientId !== payload.cid) throw new McpOAuthError('invalid_grant', 'The code was issued to a different client.')
    if (params.get('redirect_uri') !== payload.ru) throw new McpOAuthError('invalid_grant', 'The redirect URI does not match the authorization request.')
    const verifier = params.get('code_verifier') ?? ''
    if (typeof payload.cc !== 'string' || !pkceMatches(verifier, payload.cc)) throw new McpOAuthError('invalid_grant', 'The PKCE verifier does not match.')
    const userId = String(payload.uid)
    const workspaceId = String(payload.ws)
    const access = payload.ac
    if (!isMcpAccessLevel(access)) throw new McpOAuthError('invalid_grant', 'The authorization code is invalid.')
    // The person may have left the workspace in the minute since they approved.
    await this.requireMember(userId, workspaceId)
    const created = await this.dependencies.grants.create({
      userId, workspaceId, access, kind: 'oauth', clientName: String(payload.cn), clientId, codeId: String(payload.id),
      maxActive: MAX_ACTIVE_MCP_GRANTS_PER_USER, now: this.now(),
    })
    if (!created.ok || !created.id) throw grantFailure(created.reason)
    await this.audit('mcp.grant.created', userId, created.id, { access, workspaceId, client: String(payload.cn) })
    return this.issuePair(created.id, 0, access)
  }

  private async exchangeRefresh(params: URLSearchParams): Promise<McpTokenResponse> {
    const payload = openMcpValue('refresh', params.get('refresh_token'))
    if (!payload || typeof payload.g !== 'string' || typeof payload.v !== 'number') {
      throw new McpOAuthError('invalid_grant', 'The refresh token is invalid or expired.')
    }
    const rotated = await this.dependencies.grants.rotateRefresh({ grantId: payload.g, presentedVersion: payload.v, now: this.now() })
    if (!rotated.ok || rotated.version === undefined) {
      if (rotated.reason === 'reused') await this.audit('mcp.grant.refresh_reuse', 'unknown', payload.g, {})
      throw new McpOAuthError('invalid_grant', 'The refresh token is no longer valid. Connect the app again.')
    }
    const grant = await this.dependencies.grants.get({ grantId: payload.g })
    if (!grant) throw new McpOAuthError('invalid_grant', 'The grant no longer exists.')
    await this.requireMember(grant.userId, grant.workspaceId)
    return this.issuePair(payload.g, rotated.version, grant.access)
  }

  private issuePair(grantId: string, version: number, access: McpAccessLevel): McpTokenResponse {
    const accessToken = sealMcpValue('access', { g: grantId }, MCP_ACCESS_TOKEN_TTL_MS)
    const refreshToken = sealMcpValue('refresh', { g: grantId, v: version }, MCP_REFRESH_TOKEN_TTL_MS)
    if (!accessToken || !refreshToken) throw new McpOAuthError('server_error', 'MCP access is not configured on this server.', 503)
    return { access_token: accessToken, token_type: 'Bearer', expires_in: MCP_ACCESS_TOKEN_TTL_MS / 1_000, refresh_token: refreshToken, scope: `mcp:${access}` }
  }

  private requireClient(clientId: string, redirectUri: string) {
    const client = this.describeClient(clientId)
    if (!client) throw new McpOAuthError('invalid_client', 'Unknown client. The app must register first.', 401)
    // Exact match only: a redirect to anywhere else would hand the code to the wrong party.
    if (!client.redirectUris.includes(redirectUri)) throw new McpOAuthError('invalid_request', 'The redirect URI was not registered for this client.')
    return client
  }

  private async requireMember(userId: string, workspaceId: string) {
    try {
      await this.dependencies.workspaces.resolveActiveWorkspace(userId, workspaceId)
    } catch (_error) {
      throw new McpOAuthError('access_denied', 'You do not have access to that workspace.', 403)
    }
  }

  private async audit(action: string, userId: string, resourceId: string, metadata: Record<string, unknown>) {
    await this.dependencies.audit.record({
      action, actorType: 'user', actorUserId: userId, outcome: 'success',
      resourceType: 'mcp_grant', resourceId, metadata,
    }).catch((_error) => undefined)
  }

  private now() {
    return this.dependencies.now?.() ?? Date.now()
  }
}

function grantFailure(reason: string | undefined): McpOAuthError {
  if (reason === 'code_already_used') return new McpOAuthError('invalid_grant', 'The authorization code was already used.')
  if (reason === 'too_many_grants') return new McpOAuthError('invalid_request', 'Too many connected apps. Remove one in Settings and try again.')
  return new McpOAuthError('server_error', 'Could not create the connection.', 503)
}

function redirectWith(redirectUri: string, params: Record<string, string>): string {
  const url = new URL(redirectUri)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}

export function describeMcpAccess(access: McpAccessLevel): string {
  return MCP_ACCESS_LABEL[access]
}
