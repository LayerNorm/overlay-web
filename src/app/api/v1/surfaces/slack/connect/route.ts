import { NextResponse, type NextRequest } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getOverlaySession } from '@/server/auth/session'
import { enforceRateLimits, getClientIp } from '@/server/security/rate-limit'
import { getEndpointRateLimitSpecs } from '@/server/security/rate-limit-specs'
import { getBaseUrl } from '@/server/web/app-url'
import { logger } from '@/server/observability/logger'
import { slackConfigured } from '@/server/surfaces/chat'
import {
  sanitizeReturnTo,
  sealSlackConnectState,
  slackAuthorizeUrl,
  slackOAuthRedirectUri,
} from '@/server/surfaces/slack-oauth'
import { SurfaceServiceError } from '@/server/surfaces/SurfaceService'

/**
 * Slack connect entry point. This intentionally does NOT go through
 * handleBffRoute: the caller is a browser navigation that must end in a
 * redirect to Slack, not a JSON envelope. Auth is the Overlay session; the
 * sealed OAuth state carries the binding intent through the redirect.
 */
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const

function surfaceUrl(returnTo: string | undefined, params: Record<string, string>): string {
  const url = new URL(returnTo ?? '/app/agents', getBaseUrl())
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}

function failure(returnTo: string | undefined, reason: string): NextResponse {
  return NextResponse.redirect(surfaceUrl(returnTo, { surfaceError: reason }), { headers: NO_STORE })
}

export async function GET(request: NextRequest) {
  const rateLimited = await enforceRateLimits(
    request,
    getEndpointRateLimitSpecs({
      ip: getClientIp(request),
      method: request.method,
      pathname: request.nextUrl.pathname,
      userId: 'anonymous',
    }),
  ).catch((_error) => null)
  if (rateLimited) return rateLimited

  const params = request.nextUrl.searchParams
  const returnTo = sanitizeReturnTo(params.get('returnTo'))

  const session = await getOverlaySession(request)
  if (!session?.user?.id) {
    const signIn = new URL('/auth/sign-in', getBaseUrl())
    signIn.searchParams.set('redirect', `${request.nextUrl.pathname}${request.nextUrl.search}`)
    return NextResponse.redirect(signIn.toString(), { headers: NO_STORE })
  }

  const agentId = params.get('agentId')?.trim()
  if (!agentId) return failure(returnTo, 'missing_agent')

  if (!slackConfigured()) {
    logger.warn('[surfaces] Slack connect requested without Slack env configured')
    return failure(returnTo, 'slack_not_configured')
  }

  try {
    const serverContext = getOverlayServerContext()
    const access = await serverContext.workspaceService.resolveActiveWorkspace(
      session.user.id,
      params.get('workspaceId')?.trim() || undefined,
    )
    await serverContext.surfaceService.requireBindableAgent({
      actor: {
        userId: session.user.id,
        principalId: access.principal.id,
        workspaceRole: access.membership.role,
      },
      workspaceId: access.workspace.id,
      agentId,
    })

    const state = sealSlackConnectState({
      agentId,
      workspaceId: access.workspace.id,
      userId: session.user.id,
      returnTo,
    })
    return NextResponse.redirect(
      slackAuthorizeUrl({
        clientId: process.env.SLACK_CLIENT_ID!,
        redirectUri: slackOAuthRedirectUri(getBaseUrl()),
        state,
      }),
      { headers: NO_STORE },
    )
  } catch (error) {
    if (error instanceof SurfaceServiceError) {
      return failure(returnTo, error.code === 'not_found' ? 'agent_not_found' : error.code)
    }
    logger.error('[surfaces] Slack connect failed', error)
    return failure(returnTo, 'connect_failed')
  }
}
