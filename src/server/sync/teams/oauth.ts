import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Signed, self-contained OAuth state for the two Microsoft redirects: an
 * owner or admin granting tenant-wide admin consent ('connect'), and a member
 * signing in to reply as themselves ('account'). Same scheme as the Slack
 * connect state, with its own label so a state minted for one flow is never
 * accepted by another.
 */
export type TeamsOAuthState = {
  purpose: 'connect' | 'account'
  workspaceId: string
  userId: string
  returnTo?: string
}

const STATE_TTL_MS = 10 * 60 * 1000
const LABEL = 'overlay-teams-sync:v1:'

/** Delegated scopes a member grants so Overlay can post in Teams as them. */
export const TEAMS_MEMBER_SCOPES = ['openid', 'profile', 'offline_access', 'User.Read', 'ChannelMessage.Send']

export const TEAMS_SETTINGS_PATH = '/app/settings?section=workspace&workspace_tab=import'

function signingKey(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET is required for Teams OAuth state')
  return secret
}

function sign(payload: string): string {
  return createHmac('sha256', signingKey()).update(LABEL + payload).digest('base64url')
}

export function sealTeamsState(state: TeamsOAuthState): string {
  const payload = Buffer.from(JSON.stringify({ ...state, expiresAt: Date.now() + STATE_TTL_MS })).toString('base64url')
  return payload + '.' + sign(payload)
}

export function openTeamsState(value: string | null | undefined, purpose: TeamsOAuthState['purpose']): TeamsOAuthState | null {
  if (!value) return null
  const separator = value.lastIndexOf('.')
  if (separator <= 0) return null
  const payload = value.slice(0, separator)
  const provided = Buffer.from(value.slice(separator + 1))
  const expected = Buffer.from(sign(payload))
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as TeamsOAuthState & { expiresAt?: number }
    if (parsed.purpose !== purpose || !parsed.workspaceId || !parsed.userId) return null
    if (!parsed.expiresAt || parsed.expiresAt < Date.now()) return null
    return { purpose, workspaceId: parsed.workspaceId, userId: parsed.userId, ...(parsed.returnTo ? { returnTo: parsed.returnTo } : {}) }
  } catch (_error) {
    return null
  }
}

export function teamsRedirectUri(baseUrl: string, purpose: TeamsOAuthState['purpose']): string {
  return baseUrl.replace(/\/$/, '') + (purpose === 'connect' ? '/api/v1/sync/teams/callback' : '/api/v1/sync/teams/account/callback')
}

/** Microsoft's admin consent page for every application permission the Entra app declares. */
export function teamsAdminConsentUrl(args: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL('https://login.microsoftonline.com/organizations/v2.0/adminconsent')
  url.searchParams.set('client_id', args.clientId)
  url.searchParams.set('scope', 'https://graph.microsoft.com/.default')
  url.searchParams.set('redirect_uri', args.redirectUri)
  url.searchParams.set('state', args.state)
  return url.toString()
}

/** A member's sign-in, pinned to the workspace's connected tenant so they can't grant from another organization. */
export function teamsMemberAuthorizeUrl(args: { clientId: string; tenantId: string; redirectUri: string; state: string }): string {
  const url = new URL('https://login.microsoftonline.com/' + encodeURIComponent(args.tenantId) + '/oauth2/v2.0/authorize')
  url.searchParams.set('client_id', args.clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('response_mode', 'query')
  url.searchParams.set('redirect_uri', args.redirectUri)
  url.searchParams.set('scope', TEAMS_MEMBER_SCOPES.join(' '))
  url.searchParams.set('state', args.state)
  url.searchParams.set('prompt', 'select_account')
  return url.toString()
}

/** Reads the tenant and user claims from an ID token received directly from Microsoft's token endpoint over TLS. */
export function idTokenClaims(idToken: unknown): { tid?: string; oid?: string; name?: string } {
  if (typeof idToken !== 'string') return {}
  try {
    return JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8')) as { tid?: string; oid?: string; name?: string }
  } catch (_error) {
    return {}
  }
}
