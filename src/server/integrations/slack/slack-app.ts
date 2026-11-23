import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * The Overlay Slack app (internal/develop/slack-integration.md): its OAuth configuration, the sealed state that
 * carries a person and workspace through Slack and back, and Sign in with Slack for linking a member's Slack account.
 */

const SLACK_OAUTH_AUTHORIZE = 'https://slack.com/oauth/v2/authorize'
const SLACK_OIDC_AUTHORIZE = 'https://slack.com/openid/connect/authorize'
const SLACK_OIDC_TOKEN = 'https://slack.com/api/openid.connect.token'
const STATE_TTL_MS = 10 * 60_000

/** Bot scopes for Phase 1: mentions, follow-ups in threads the bot joined, DMs, and the names shown on threads. */
export const SLACK_BOT_SCOPES = [
  'app_mentions:read',
  'channels:history',
  'channels:read',
  'chat:write',
  'groups:history',
  'groups:read',
  'im:history',
  'im:read',
  'im:write',
  'users:read',
] as const

export type SlackAppConfig = {
  clientId: string
  clientSecret: string
  signingSecret: string
  encryptionKey: string
}

export function slackAppConfig(): SlackAppConfig | null {
  const clientId = process.env.SLACK_CLIENT_ID?.trim()
  const clientSecret = process.env.SLACK_CLIENT_SECRET?.trim()
  const signingSecret = process.env.SLACK_SIGNING_SECRET?.trim()
  const encryptionKey = process.env.SLACK_ENCRYPTION_KEY?.trim()
  if (!clientId || !clientSecret || !signingSecret || !encryptionKey) return null
  return { clientId, clientSecret, signingSecret, encryptionKey }
}

export function slackInstallUrl(config: SlackAppConfig, state: string, redirectUri: string): string {
  const url = new URL(SLACK_OAUTH_AUTHORIZE)
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('scope', SLACK_BOT_SCOPES.join(','))
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  return url.toString()
}

export function slackLinkUrl(config: SlackAppConfig, state: string, redirectUri: string, teamId?: string): string {
  const url = new URL(SLACK_OIDC_AUTHORIZE)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid profile')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  if (teamId) url.searchParams.set('team', teamId)
  return url.toString()
}

export type SlackIdentity = { teamId: string; slackUserId: string; name?: string }

/** Exchanges a Sign in with Slack code for the Slack account that signed in. */
export async function slackIdentityFromCode(
  config: SlackAppConfig,
  code: string,
  redirectUri: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SlackIdentity> {
  const response = await fetchImpl(SLACK_OIDC_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: redirectUri,
    }),
  })
  const result = await response.json().catch((_error) => null) as { ok?: boolean; id_token?: string; error?: string } | null
  if (!response.ok || !result?.ok || !result.id_token) throw new Error('Slack sign-in failed: ' + (result?.error ?? response.status))
  const claims = JSON.parse(Buffer.from(result.id_token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>
  const teamId = claims['https://slack.com/team_id']
  const slackUserId = claims['https://slack.com/user_id'] ?? claims.sub
  if (typeof teamId !== 'string' || typeof slackUserId !== 'string') throw new Error('Slack sign-in returned no identity')
  return { teamId, slackUserId, ...(typeof claims.name === 'string' ? { name: claims.name } : {}) }
}

// ---- Sealed state: who started the install or link, through Slack and back.

export type SlackConnectState = {
  kind: 'install' | 'link'
  userId: string
  workspaceId: string
  returnTo?: string
}

function signingKey(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET is required for Slack connect state')
  return secret
}

const sign = (payload: string) => createHmac('sha256', signingKey()).update('overlay-slack-connect:v1:' + payload).digest('base64url')

export function sealSlackConnectState(state: SlackConnectState, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ ...state, expiresAt: now + STATE_TTL_MS })).toString('base64url')
  return payload + '.' + sign(payload)
}

export function openSlackConnectState(value: string | null | undefined, now = Date.now()): SlackConnectState | null {
  if (!value) return null
  const separator = value.lastIndexOf('.')
  if (separator <= 0) return null
  const payload = value.slice(0, separator)
  const provided = Buffer.from(value.slice(separator + 1))
  const wanted = Buffer.from(sign(payload))
  if (provided.length !== wanted.length || !timingSafeEqual(provided, wanted)) return null
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SlackConnectState & { expiresAt?: number }
    if (parsed.kind !== 'install' && parsed.kind !== 'link') return null
    if (!parsed.userId || !parsed.workspaceId || !parsed.expiresAt || parsed.expiresAt < now) return null
    return {
      kind: parsed.kind, userId: parsed.userId, workspaceId: parsed.workspaceId,
      ...(parsed.returnTo ? { returnTo: parsed.returnTo } : {}),
    }
  } catch (_error) {
    return null
  }
}

/** Only a same-origin path may be a return target, so the redirect cannot leave this deployment. */
export function sanitizeSlackReturnTo(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return undefined
  return trimmed.slice(0, 512)
}
