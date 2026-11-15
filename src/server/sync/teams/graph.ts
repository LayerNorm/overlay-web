import 'server-only'

import { SyncRateLimitedError } from '@/server/sync/adapters'

export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
const LOGIN_BASE = 'https://login.microsoftonline.com'
const APP_TOKEN_MARGIN_MS = 5 * 60 * 1000

export class TeamsSyncUnavailableError extends Error {}

/** A non-success Graph response, keeping the status so callers can tell a missing app (403/404) from an outage. */
export class GraphError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

export function microsoftSyncCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.MICROSOFT_SYNC_CLIENT_ID?.trim()
  const clientSecret = process.env.MICROSOFT_SYNC_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) throw new TeamsSyncUnavailableError('MICROSOFT_SYNC_CLIENT_ID and MICROSOFT_SYNC_CLIENT_SECRET are required for Teams sync')
  return { clientId, clientSecret }
}

export function teamsSyncConfigured(): boolean {
  return Boolean(process.env.MICROSOFT_SYNC_CLIENT_ID?.trim() && process.env.MICROSOFT_SYNC_CLIENT_SECRET?.trim())
}

export function retryAfterMs(value: string | null): number {
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds * 1000)
  const date = value ? Date.parse(value) : NaN
  return Number.isFinite(date) ? Math.max(1000, date - Date.now()) : 30_000
}

/** Posts a form to the Microsoft identity platform's token endpoint for a tenant. */
export async function microsoftTokenRequest(tenantId: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetch(LOGIN_BASE + '/' + encodeURIComponent(tenantId) + '/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  })
  const body = await response.json().catch((_error) => ({})) as Record<string, unknown>
  if (!response.ok) {
    throw new GraphError(response.status, typeof body.error === 'string' ? body.error : 'token_error', 'Microsoft token request failed: ' + (typeof body.error === 'string' ? body.error : response.status))
  }
  return body
}

const appTokens = new Map<string, { token: string; expiresAt: number }>()

/** An app-only Graph token for a tenant that granted admin consent, cached until shortly before it expires. */
export async function graphAppToken(tenantId: string): Promise<string> {
  const cached = appTokens.get(tenantId)
  if (cached && cached.expiresAt - APP_TOKEN_MARGIN_MS > Date.now()) return cached.token
  const { clientId, clientSecret } = microsoftSyncCredentials()
  const body = await microsoftTokenRequest(tenantId, {
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    scope: 'https://graph.microsoft.com/.default',
  })
  if (typeof body.access_token !== 'string') throw new GraphError(500, 'token_error', 'Microsoft returned no access token')
  appTokens.set(tenantId, { token: body.access_token, expiresAt: Date.now() + Number(body.expires_in ?? 3600) * 1000 })
  return body.access_token
}

/**
 * Calls Graph with a bearer token. A path is relative to v1.0; a full URL must be
 * a Graph URL (paging links). 429 and 503 become SyncRateLimitedError with
 * Graph's Retry-After; other failures become GraphError.
 */
export async function graphRequest<T>(token: string, pathOrUrl: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const url = pathOrUrl.startsWith('https://') ? pathOrUrl : GRAPH_BASE + pathOrUrl
  if (!url.startsWith('https://graph.microsoft.com/')) throw new GraphError(400, 'invalid_url', 'Refusing a non-Graph URL')
  const response = await fetch(url, {
    method: init.method ?? 'GET',
    headers: { Authorization: 'Bearer ' + token, ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
  if (response.status === 429 || response.status === 503) {
    throw new SyncRateLimitedError(retryAfterMs(response.headers.get('Retry-After')), 'Microsoft Graph asked us to wait')
  }
  if (!response.ok) {
    const body = await response.json().catch((_error) => ({})) as { error?: { code?: string; message?: string } }
    throw new GraphError(response.status, body.error?.code ?? 'graph_error', 'Graph ' + response.status + ': ' + (body.error?.code ?? 'request failed'))
  }
  if (response.status === 204) return undefined as T
  const text = await response.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export function isAppMissing(error: unknown): boolean {
  return error instanceof GraphError && (error.status === 403 || error.status === 404)
}
