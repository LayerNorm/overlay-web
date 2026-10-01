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
  agentId: string
  workspaceId: string
  userId: string
  returnTo?: string
}

const STATE_TTL_MS = 10 * 60 * 1000

// Bot scopes from the app manifest (docs/develop/surfaces-slack-app.md). Keep
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

function signingKey(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET is required for surface OAuth state')
  return secret
}

export function slackOAuthRedirectUri(baseUrl: string): string {
  return (process.env.SLACK_REDIRECT_URI?.trim())
    || `${baseUrl.replace(/\/$/, '')}/api/v1/surfaces/slack/callback`
}

export function slackAuthorizeUrl(args: {
  clientId: string
  redirectUri: string
  state: string
}): string {
  const url = new URL('https://slack.com/oauth/v2/authorize')
  url.searchParams.set('client_id', args.clientId)
  url.searchParams.set('scope', SLACK_BOT_SCOPES)
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
    if (!parsed.agentId || !parsed.workspaceId || !parsed.userId) return null
    if (!parsed.expiresAt || parsed.expiresAt < Date.now()) return null
    return {
      agentId: parsed.agentId,
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
