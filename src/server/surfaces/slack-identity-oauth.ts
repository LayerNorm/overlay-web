import 'server-only'

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import { sanitizeReturnTo } from './slack-oauth'

const TTL_MS = 10 * 60 * 1000
const slackKeys = createRemoteJWKSet(new URL('https://slack.com/openid/connect/keys'))

export type SlackIdentityState = {
  workspaceId: string
  connectionId: string
  userId: string
  teamId: string
  nonce: string
  returnTo?: string
}

function signature(payload: string): Buffer {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('Slack identity linking is not configured.')
  return createHmac('sha256', secret).update(`overlay-slack-identity:v1:${payload}`).digest()
}

export function sealSlackIdentityState(input: Omit<SlackIdentityState, 'nonce'>): {
  state: string
  nonce: string
} {
  const nonce = randomUUID()
  const payload = Buffer.from(JSON.stringify({
    ...input, returnTo: sanitizeReturnTo(input.returnTo), nonce, expiresAt: Date.now() + TTL_MS,
  })).toString('base64url')
  return { state: `${payload}.${signature(payload).toString('base64url')}`, nonce }
}

export function openSlackIdentityState(value: string | null): SlackIdentityState | null {
  if (!value || value.length > 4096) return null
  const [payload, encodedSignature, extra] = value.split('.')
  if (!payload || !encodedSignature || extra) return null
  const expected = signature(payload)
  const actual = Buffer.from(encodedSignature, 'base64url')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (!['workspaceId', 'connectionId', 'userId', 'teamId', 'nonce'].every(key =>
      typeof parsed[key] === 'string' && parsed[key].length > 0 && parsed[key].length <= 256)
      || typeof parsed.expiresAt !== 'number' || parsed.expiresAt < Date.now()
      || parsed.expiresAt > Date.now() + TTL_MS) return null
    return {
      workspaceId: parsed.workspaceId, connectionId: parsed.connectionId,
      userId: parsed.userId, teamId: parsed.teamId, nonce: parsed.nonce,
      returnTo: sanitizeReturnTo(typeof parsed.returnTo === 'string' ? parsed.returnTo : undefined),
    }
  } catch (_error) { return null }
}

export function slackIdentityAuthorizeUrl(input: {
  clientId: string
  redirectUri: string
  teamId: string
  state: string
  nonce: string
}): string {
  const url = new URL('https://slack.com/openid/connect/authorize')
  url.search = new URLSearchParams({
    client_id: input.clientId, redirect_uri: input.redirectUri, response_type: 'code',
    scope: 'openid', team: input.teamId, state: input.state, nonce: input.nonce,
  }).toString()
  return url.toString()
}

export function verifiedSlackIdentityClaims(payload: JWTPayload, state: SlackIdentityState) {
  const externalUserId = payload['https://slack.com/user_id']
  if (payload.nonce !== state.nonce || payload['https://slack.com/team_id'] !== state.teamId
    || typeof externalUserId !== 'string' || !externalUserId || payload.sub !== externalUserId) {
    throw new Error('Slack identity did not match the requested workspace.')
  }
  return { externalUserId, externalTeamId: state.teamId }
}

export async function exchangeSlackIdentity(input: {
  code: string
  redirectUri: string
  state: SlackIdentityState
}) {
  const clientId = process.env.SLACK_CLIENT_ID
  const clientSecret = process.env.SLACK_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('Slack identity linking is not configured.')
  const response = await fetch('https://slack.com/api/openid.connect.token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret, code: input.code,
      grant_type: 'authorization_code', redirect_uri: input.redirectUri,
    }),
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
    redirect: 'error',
  })
  if (!response.ok) throw new Error('Slack identity exchange failed.')
  const result = await response.json() as { ok?: boolean; id_token?: string }
  if (result.ok !== true || typeof result.id_token !== 'string') throw new Error('Slack identity exchange failed.')
  const { payload } = await jwtVerify(result.id_token, slackKeys, {
    issuer: 'https://slack.com', audience: clientId, algorithms: ['RS256'], maxTokenAge: '10m',
    requiredClaims: ['exp', 'iat', 'sub', 'nonce'],
  })
  return verifiedSlackIdentityClaims(payload, input.state)
}
