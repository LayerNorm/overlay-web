import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Slack connect state: an HMAC-signed, self-contained payload carried in the
 * OAuth `state` param (stateless — no server-side record needed because the
 * only effect it authorizes is creating metadata rows, which is idempotent).
 * Bound to the connecting user and re-validated against their session on the
 * callback, so a leaked authorization URL cannot attach an install to a
 * different account.
 */
export interface SlackConnectState {
  /** The agent being bound; absent when a workspace connects Slack for channel sync. */
  agentId?: string
  /** `sync` installs the app for channel sync; `sync_member` signs a member in to reply as themselves. */
  purpose?: 'sync' | 'sync_member'
  workspaceId: string
  userId: string
  returnTo?: string
}

const STATE_TTL_MS = 10 * 60 * 1000

// Bot scopes from the app manifest (internal/develop/surfaces-slack-app.md). Keep
// in sync when the manifest changes.
const SLACK_BOT_SCOPES = [
  'app_mentions:read',
  'assistant:write',
  'channels:history',
  'channels:join',
  'channels:read',
  'chat:write',
  'chat:write.customize',
  'groups:history',
  'groups:read',
  'im:history',
  'im:read',
  'im:write',
  'mpim:history',
  'mpim:read',
  'reactions:read',
  'reactions:write',
  'users:read',
  'users:read.email',
].join(',')

/** User scopes a member grants so Overlay can post, edit, delete and react as them in synced channels. */
export const SLACK_SYNC_USER_SCOPES = ['chat:write', 'reactions:write']

function signingKey(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET is required for surface OAuth state')
  return secret
}

export function slackOAuthRedirectUri(baseUrl: string): string {
  return (process.env.SLACK_REDIRECT_URI?.trim())
    || `${baseUrl.replace(/\/$/, '')}/api/v1/surfaces/slack/callback`
}

/** Bot installs request the bot scopes; a member sign-in (`userScopes`) requests only user scopes. */
export function slackAuthorizeUrl(args: {
  clientId: string
  redirectUri: string
  state: string
  userScopes?: string[]
}): string {
  const url = new URL('https://slack.com/oauth/v2/authorize')
  url.searchParams.set('client_id', args.clientId)
  if (args.userScopes) url.searchParams.set('user_scope', args.userScopes.join(','))
  else url.searchParams.set('scope', SLACK_BOT_SCOPES)
  url.searchParams.set('redirect_uri', args.redirectUri)
  url.searchParams.set('state', args.state)
  return url.toString()
}

export function sealSlackConnectState(state: SlackConnectState): string {
  const payload = Buffer.from(JSON.stringify({
    ...state,
    expiresAt: Date.now() + STATE_TTL_MS,
  })).toString('base64url')
  const signature = createHmac('sha256', signingKey())
    .update(`overlay-slack-connect:v1:${payload}`)
    .digest('base64url')
  return `${payload}.${signature}`
}

export function openSlackConnectState(value: string | null | undefined): SlackConnectState | null {
  if (!value) return null
  const separator = value.lastIndexOf('.')
  if (separator <= 0) return null
  const payload = value.slice(0, separator)
  const signature = value.slice(separator + 1)
  const expected = createHmac('sha256', signingKey())
    .update(`overlay-slack-connect:v1:${payload}`)
    .digest('base64url')
  const provided = Buffer.from(signature)
  const wanted = Buffer.from(expected)
  if (provided.length !== wanted.length || !timingSafeEqual(provided, wanted)) return null
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as
      SlackConnectState & { expiresAt?: number }
    if (!parsed.workspaceId || !parsed.userId) return null
    const purpose = parsed.purpose === 'sync' || parsed.purpose === 'sync_member' ? parsed.purpose : undefined
    if (!purpose && !parsed.agentId) return null
    if (!parsed.expiresAt || parsed.expiresAt < Date.now()) return null
    return {
      ...(purpose ? { purpose } : { agentId: parsed.agentId }),
      workspaceId: parsed.workspaceId,
      userId: parsed.userId,
      returnTo: parsed.returnTo,
    }
  } catch (_error) {
    return null
  }
}

/** Only same-origin paths may be returned to — never absolute or protocol-relative URLs. */
export function sanitizeReturnTo(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return undefined
  return trimmed.slice(0, 512)
}

export type SlackUserGrant = {
  teamId: string
  userId: string
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  scopes: string[]
}

/**
 * Exchanges a member sign-in code for their user token with oauth.v2.access.
 * The Chat SDK callback handles bot installs only, so member grants are
 * exchanged here. The returned token must be sealed before it is stored.
 */
export async function exchangeSlackUserCode(code: string, redirectUri: string): Promise<SlackUserGrant> {
  const response = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID ?? '',
      client_secret: process.env.SLACK_CLIENT_SECRET ?? '',
      code,
      redirect_uri: redirectUri,
    }),
  })
  const result = await response.json().catch((_error) => null) as {
    ok?: boolean
    error?: string
    team?: { id?: string }
    authed_user?: { id?: string; scope?: string; access_token?: string; refresh_token?: string; expires_in?: number; token_type?: string }
  } | null
  const user = result?.authed_user
  if (!result?.ok || !result.team?.id || !user?.id || !user.access_token || user.token_type !== 'user') {
    throw new Error('Slack user token exchange failed: ' + (result?.error ?? 'missing_user_token'))
  }
  return {
    teamId: result.team.id,
    userId: user.id,
    accessToken: user.access_token,
    ...(user.refresh_token ? { refreshToken: user.refresh_token } : {}),
    ...(user.expires_in ? { expiresAt: Date.now() + user.expires_in * 1000 } : {}),
    scopes: (user.scope ?? '').split(',').map(scope => scope.trim()).filter(Boolean),
  }
}
