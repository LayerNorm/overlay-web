import 'server-only'

import { randomBytes } from 'node:crypto'
import type {
  McpOAuthClient,
  McpOAuthStatus,
  McpOAuthSurface,
  McpOAuthTokens,
  McpServerRepository,
} from './McpServerRepository'

/**
 * Bridges the MCP SDK's OAuthClientProvider onto our repository. The SDK owns the protocol
 * (discovery, PKCE, DCR, token exchange and refresh); this class owns storage, and decides what
 * happens when a flow needs a human.
 *
 * Two modes matter:
 * - **Interactive** (the Connect route): `redirectToAuthorization` captures the URL so the route can
 *   hand it to the browser.
 * - **Runtime** (a chat turn): there is no browser to redirect, so `redirectToAuthorization` throws
 *   McpOAuthInteractionRequiredError. That converts "silently hangs mid-conversation" into a
 *   deterministic, actionable failure.
 */

/** Long enough to survive a slow human, short enough to bound replay of a leaked `state`. */
export const MCP_OAUTH_SESSION_TTL_MS = 10 * 60 * 1000

export class McpOAuthInteractionRequiredError extends Error {
  constructor(public readonly serverName: string) {
    super(`${serverName} needs to be reconnected in MCP settings (OAuth session expired)`)
    this.name = 'McpOAuthInteractionRequiredError'
  }
}

export interface OAuthClientMetadataShape {
  client_name: string
  redirect_uris: string[]
  grant_types: string[]
  response_types: string[]
  token_endpoint_auth_method: string
  scope?: string
  client_uri?: string
}

export interface McpOAuthProviderOptions {
  repository: McpServerRepository
  mcpServerId: string
  userId: string
  serverName: string
  redirectUri: string
  clientUri?: string
  scope?: string
  /** Pre-loaded state so the common path avoids a repository round-trip per SDK callback. */
  initialTokens?: McpOAuthTokens
  initialClient?: McpOAuthClient
  initialTokenVersion?: number
  /** Interactive flows supply this; omitting it makes the provider non-interactive. */
  onRedirect?: (authorizationUrl: URL) => void | Promise<void>
  /** Interactive flows persist the PKCE verifier; runtime refreshes never need one. */
  onSaveCodeVerifier?: (codeVerifier: string) => void | Promise<void>
  /** Supplies the verifier when completing a flow from the callback route. */
  codeVerifierValue?: string
  /**
   * The OAuth `state` to send. We pass our stored session id so the callback can look the flow up;
   * the SDK reads this via `state()`, it has no `state` option on `auth()`.
   */
  stateValue?: string
}

export class McpOAuthProvider {
  private tokensCache?: McpOAuthTokens
  private clientCache?: McpOAuthClient
  private tokenVersion: number
  private capturedAuthorizationUrl?: URL

  constructor(private readonly options: McpOAuthProviderOptions) {
    this.tokensCache = options.initialTokens
    this.clientCache = options.initialClient
    this.tokenVersion = options.initialTokenVersion ?? 0
  }

  /** Fixed for every surface so DCR registrations stay valid when desktop joins the flow. */
  get redirectUrl(): string {
    return this.options.redirectUri
  }

  get clientMetadata(): OAuthClientMetadataShape {
    return {
      client_name: 'Overlay',
      grant_types: ['authorization_code', 'refresh_token'],
      redirect_uris: [this.options.redirectUri],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
      ...(this.options.clientUri ? { client_uri: this.options.clientUri } : {}),
      ...(this.options.scope ? { scope: this.options.scope } : {}),
    }
  }

  /** The URL the SDK wanted to send the user to, once redirectToAuthorization has run. */
  get authorizationUrl(): URL | undefined {
    return this.capturedAuthorizationUrl
  }

  state(): string {
    // Must be the stored session id: the callback has nothing else to correlate the flow with.
    if (!this.options.stateValue) {
      throw new Error('No OAuth state was provided for this MCP authorization')
    }
    return this.options.stateValue
  }

  clientInformation(): McpOAuthClientInformation | undefined {
    if (!this.clientCache) return undefined
    return {
      client_id: this.clientCache.clientId,
      ...(this.clientCache.clientSecret ? { client_secret: this.clientCache.clientSecret } : {}),
    }
  }

  async saveClientInformation(info: McpOAuthClientInformation): Promise<void> {
    const client: McpOAuthClient = {
      clientId: info.client_id,
      registered: true,
      ...(info.client_secret ? { clientSecret: info.client_secret } : {}),
    }
    this.clientCache = client
    await this.options.repository.updateOAuthState({
      client,
      mcpServerId: this.options.mcpServerId,
      userId: this.options.userId,
    })
  }

  tokens(): McpOAuthTokensShape | undefined {
    if (!this.tokensCache) return undefined
    return toSdkTokens(this.tokensCache)
  }

  /**
   * Compare-and-set against the version we loaded. A lost race means another request already
   * refreshed — its tokens are the live ones, so we drop ours rather than clobbering a rotated
   * refresh token with a now-invalid one.
   */
  async saveTokens(tokens: McpOAuthTokensShape): Promise<void> {
    const next = fromSdkTokens(tokens)
    const applied = await this.options.repository.updateOAuthState({
      error: null,
      expectedTokenVersion: this.tokenVersion,
      mcpServerId: this.options.mcpServerId,
      status: 'connected',
      tokens: next,
      userId: this.options.userId,
    })
    if (applied) {
      this.tokensCache = next
      this.tokenVersion += 1
      return
    }
    const fresh = await this.options.repository.get({
      mcpServerId: this.options.mcpServerId,
      userId: this.options.userId,
    })
    this.tokensCache = fresh?.oauthTokens
    this.tokenVersion = fresh?.oauthTokenVersion ?? this.tokenVersion + 1
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    this.capturedAuthorizationUrl = authorizationUrl
    if (!this.options.onRedirect) {
      // No browser here: mark the server so the UI can offer Reconnect, then fail loudly.
      await this.markNeedsReauth()
      throw new McpOAuthInteractionRequiredError(this.options.serverName)
    }
    await this.options.onRedirect(authorizationUrl)
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    if (!this.options.onSaveCodeVerifier) {
      throw new Error('No MCP OAuth session is available to store a PKCE verifier')
    }
    await this.options.onSaveCodeVerifier(codeVerifier)
  }

  codeVerifier(): string {
    if (!this.options.codeVerifierValue) {
      throw new Error('No PKCE verifier is available for this MCP OAuth session')
    }
    return this.options.codeVerifierValue
  }

  async markNeedsReauth(error?: string): Promise<void> {
    await this.options.repository.updateOAuthState({
      error: error ?? null,
      mcpServerId: this.options.mcpServerId,
      status: 'needs_reauth',
      userId: this.options.userId,
    }).catch((_error) => undefined)
  }

  async setStatus(status: McpOAuthStatus): Promise<void> {
    await this.options.repository.updateOAuthState({
      mcpServerId: this.options.mcpServerId,
      status,
      userId: this.options.userId,
    })
  }
}

export interface McpOAuthClientInformation {
  client_id: string
  client_secret?: string
}

export interface McpOAuthTokensShape {
  access_token: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
}

/** SDK speaks `expires_in` (relative seconds); storage keeps an absolute epoch. */
export function toSdkTokens(tokens: McpOAuthTokens): McpOAuthTokensShape {
  return {
    access_token: tokens.accessToken,
    token_type: tokens.tokenType ?? 'Bearer',
    ...(tokens.refreshToken ? { refresh_token: tokens.refreshToken } : {}),
    ...(tokens.scope ? { scope: tokens.scope } : {}),
    ...(tokens.expiresAt
      ? { expires_in: Math.max(0, Math.floor((tokens.expiresAt - Date.now()) / 1000)) }
      : {}),
  }
}

export function fromSdkTokens(tokens: McpOAuthTokensShape): McpOAuthTokens {
  return {
    accessToken: tokens.access_token,
    ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
    ...(tokens.scope ? { scope: tokens.scope } : {}),
    ...(tokens.token_type ? { tokenType: tokens.token_type } : {}),
    ...(typeof tokens.expires_in === 'number'
      ? { expiresAt: Date.now() + tokens.expires_in * 1000 }
      : {}),
  }
}

export function createMcpOAuthSessionId(): string {
  return randomBytes(32).toString('base64url')
}

export function mcpOAuthSessionExpiry(now = Date.now()): number {
  return now + MCP_OAUTH_SESSION_TTL_MS
}

export type { McpOAuthSurface }
