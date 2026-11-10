import { NextResponse, type NextRequest } from 'next/server'
import { getOverlaySession } from '@/server/auth/session'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getBaseUrl } from '@/server/web/app-url'
import { enforceRateLimits, getClientIp } from '@/server/security/rate-limit'
import { getEndpointRateLimitSpecs } from '@/server/security/rate-limit-specs'
import { beginSlackIdentity, completeSlackIdentity, unlinkSlackIdentity } from './slack-identity-store'
import { exchangeSlackIdentity, openSlackIdentityState, sealSlackIdentityState, slackIdentityAuthorizeUrl } from './slack-identity-oauth'

const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer' }
const callbackUrl = () => new URL('/api/v1/surfaces/slack/identity/callback', getBaseUrl()).toString()
function page(message: string, status = 400) {
  return new NextResponse(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Slack identity</title><body><h1>Slack identity</h1><p>${message}</p></body></html>`, { status, headers })
}

async function rateLimit(request: NextRequest, userId: string) {
  return await enforceRateLimits(request, getEndpointRateLimitSpecs({
    ip: getClientIp(request), method: request.method, pathname: request.nextUrl.pathname, userId,
  })).catch((_error) => page('Identity linking is temporarily unavailable.', 503))
}

export async function startSlackIdentity(request: NextRequest) {
  const session = await getOverlaySession(request)
  const limited = await rateLimit(request, session?.user.id ?? 'anonymous')
  if (limited) return limited
  if (!session?.user.id) {
    const signIn = new URL('/auth/sign-in', getBaseUrl())
    signIn.searchParams.set('redirect', request.nextUrl.pathname + request.nextUrl.search)
    return NextResponse.redirect(signIn, { headers: { 'Cache-Control': 'no-store' } })
  }
  try {
    const workspaceId = request.nextUrl.searchParams.get('workspaceId') ?? ''
    const connectionId = request.nextUrl.searchParams.get('connectionId') ?? ''
    if (!workspaceId || !connectionId || !process.env.SLACK_CLIENT_ID) return page('The Slack linking request is incomplete.')
    const server = getOverlayServerContext()
    const access = await server.workspaceService.resolveActiveWorkspace(session.user.id, workspaceId)
    if (access.workspace.id !== workspaceId) return page('Workspace membership is required.', 403)
    const connection = (await server.surfaceService.listConnections({ workspaceId })).find(row => row.id === connectionId && row.platform === 'slack' && row.status === 'active')
    if (!connection) return page('This Slack workspace is not connected.', 403)
    const scope = { userId: session.user.id, workspaceId, connectionId, teamId: connection.externalTeamId }
    const sealed = sealSlackIdentityState(scope)
    await beginSlackIdentity({ ...scope, nonce: sealed.nonce })
    return NextResponse.redirect(slackIdentityAuthorizeUrl({ clientId: process.env.SLACK_CLIENT_ID, redirectUri: callbackUrl(), teamId: scope.teamId, ...sealed }), { headers: { 'Cache-Control': 'no-store' } })
  } catch (_error) { return page('Slack linking is unavailable or workspace access was denied.', 403) }
}

export async function callbackSlackIdentity(request: NextRequest) {
  try {
    const state = openSlackIdentityState(request.nextUrl.searchParams.get('state'))
    const session = await getOverlaySession(request)
    if (!state || !session?.user.id || session.user.id !== state.userId) return page('Invalid linking request. Sign in as the same Overlay user and start again.', 403)
    const limited = await rateLimit(request, session.user.id)
    if (limited) return limited
    const code = request.nextUrl.searchParams.get('code')
    if (!code) return page('Slack sign-in was cancelled or did not provide a code.')
    const identity = await exchangeSlackIdentity({ code, redirectUri: callbackUrl(), state })
    const result = await completeSlackIdentity(state, identity.externalUserId)
    if (result?.status === 'conflict') return page('This Slack user is already linked to a different Overlay account. Unlink it from that account or ask a workspace administrator.', 409)
    if (result?.status !== 'linked') return page('Slack linking could not be completed.')
    return page('Slack identity linked. You can return to Slack and send your message again.', 200)
  } catch (_error) { return page('Slack identity could not be verified, the link expired, or this request was already used. Start linking again.') }
}

export async function unlinkSlackIdentityRoute(request: NextRequest) {
  if (request.headers.get('origin') !== new URL(getBaseUrl()).origin) return page('Unlink must be requested from Overlay.', 403)
  const session = await getOverlaySession(request)
  if (!session?.user.id) return page('Sign in to Overlay before unlinking.', 401)
  const limited = await rateLimit(request, session.user.id)
  if (limited) return limited
  try {
    const body = await request.json() as { workspaceId?: unknown; linkId?: unknown }
    if (typeof body.workspaceId !== 'string' || typeof body.linkId !== 'string') return page('A workspace and identity link are required.')
    await unlinkSlackIdentity({ actorUserId: session.user.id, workspaceId: body.workspaceId, linkId: body.linkId })
    return page('Slack identity unlinked.', 200)
  } catch (_error) { return page('Only the linked user or a workspace administrator may unlink this identity.', 403) }
}
