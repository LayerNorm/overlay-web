import { NextResponse, type NextRequest } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getOverlaySession } from '@/server/auth/session'
import { enforceRateLimits, getClientIp } from '@/server/security/rate-limit'
import { getEndpointRateLimitSpecs } from '@/server/security/rate-limit-specs'
import { getBaseUrl } from '@/server/web/app-url'
import { logger } from '@/server/observability/logger'
import { getSlackAdapter, slackConfigured } from '@/server/surfaces/chat'
import { openSlackConnectState, slackOAuthRedirectUri } from '@/server/surfaces/slack-oauth'
import { SurfaceServiceError } from '@/server/surfaces/SurfaceService'

/**
 * Slack OAuth redirect target. Like the MCP callback this bypasses
 * handleBffRoute — the caller is Slack's browser redirect and the response must
 * be a redirect back into the app. Authorization is the sealed `state` value,
 * bound to the connecting user and re-checked against the live session.
 */
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const

function surfaceUrl(returnTo: string | undefined, params: Record<string, string>): string {
  const url = new URL(returnTo ?? '/app/agents', getBaseUrl())
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
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
  const state = openSlackConnectState(params.get('state'))
  const returnTo = state?.returnTo

  const fail = (reason: string) => NextResponse.redirect(
    surfaceUrl(returnTo, { surfaceError: reason }),
    { headers: NO_STORE },
  )

  // Consuming/validating the signature first means a forged or stale state
  // never reaches the token exchange.
  if (!state) return fail('expired_state')

  const providerError = params.get('error')?.trim()
  if (providerError) return fail('denied')
  if (!params.get('code')?.trim()) return fail('missing_code')

  if (!slackConfigured()) return fail('slack_not_configured')

  // The completing browser must hold the same user's session — otherwise a
  // leaked authorization URL could bind someone else's Slack workspace.
  const session = await getOverlaySession(request)
  if (!session?.user?.id || session.user.id !== state.userId) {
    logger.warn('[surfaces] Slack callback rejected: session binding mismatch')
    return fail('account_mismatch')
  }

  try {
    const serverContext = getOverlayServerContext()
    // Membership and bind permission are re-checked: the agent or the actor's
    // role may have changed while the user was on Slack's consent screen.
    const access = await serverContext.workspaceService.resolveActiveWorkspace(
      state.userId,
      state.workspaceId,
    )
    await serverContext.surfaceService.requireBindableAgent({
      actor: {
        userId: state.userId,
        principalId: access.principal.id,
        workspaceRole: access.membership.role,
      },
      workspaceId: access.workspace.id,
      agentId: state.agentId,
    })

    const result = await (await getSlackAdapter()).handleOAuthCallback(request, {
      redirectUri: slackOAuthRedirectUri(getBaseUrl()),
    })

    await serverContext.surfaceService.registerConnection({
      workspaceId: state.workspaceId,
      platform: 'slack',
      externalTeamId: result.teamId,
      externalTeamName: result.installation.teamName ?? null,
      externalEnterpriseId: result.enterpriseId ?? null,
      botUserId: result.installation.botUserId ?? null,
      installedByUserId: state.userId,
    })

    return NextResponse.redirect(
      surfaceUrl(returnTo, { surfaceConnected: 'slack', agentId: state.agentId }),
      { headers: NO_STORE },
    )
  } catch (error) {
    if (error instanceof SurfaceServiceError) {
      return fail(error.code === 'conflict' ? 'team_already_connected' : error.code)
    }
    logger.error('[surfaces] Slack OAuth callback failed', error)
    return fail('exchange_failed')
  }
}
