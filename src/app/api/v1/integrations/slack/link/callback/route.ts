import type { NextRequest } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getOverlaySession } from '@/server/auth/session'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { getClientIp } from '@/server/security/rate-limit'
import { logger } from '@/server/observability/logger'
import { openSlackConnectState, slackAppConfig, slackIdentityFromCode } from '@/server/integrations/slack/slack-app'
import { slackBack, slackLinkRedirectUri, slackRateLimited } from '@/server/integrations/slack/slack-routes'

/**
 * Sign in with Slack returns here (internal/develop/slack-integration.md). Slack vouches for the Slack account; the
 * sealed state and live session vouch for the Overlay member. Convex saves the link only when that Slack workspace is
 * the one installed for the member's Overlay workspace.
 */
export async function GET(request: NextRequest) {
  const rateLimited = await slackRateLimited(request)
  if (rateLimited) return rateLimited
  const params = request.nextUrl.searchParams
  const state = openSlackConnectState(params.get('state'))
  if (!state || state.kind !== 'link') return slackBack(undefined, { slackError: 'expired' })
  const session = await getOverlaySession(request)
  if (session?.user?.id !== state.userId) return slackBack(state.returnTo, { slackError: 'signed_in_as_someone_else' })
  const code = params.get('code')
  if (!code) return slackBack(state.returnTo, { slackError: params.get('error') === 'access_denied' ? 'cancelled' : 'link_failed' })
  const config = slackAppConfig()
  if (!config) return slackBack(state.returnTo, { slackError: 'not_configured' })
  try {
    const identity = await slackIdentityFromCode(config, code, slackLinkRedirectUri())
    await convex.mutation('integrations/slack:linkByServer', {
      serverSecret: getInternalApiSecret(), workspaceId: state.workspaceId, teamId: identity.teamId,
      slackUserId: identity.slackUserId, userId: state.userId, ...(identity.name ? { slackUserName: identity.name } : {}),
    }, { throwOnError: true })
    await getOverlayServerContext().auditService.record({
      action: 'integration.slack.linked',
      actorType: 'user',
      actorUserId: state.userId,
      ipAddress: getClientIp(request),
      metadata: { teamId: identity.teamId },
      outcome: 'success',
      resourceId: state.workspaceId,
      resourceType: 'workspace',
    }).catch((error) => {
      logger.warn('[slack] link audit write failed', { reason: error instanceof Error ? error.message : 'unknown' })
    })
    return slackBack(state.returnTo, { slack: 'linked' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('[slack] link callback failed', { reason: message.slice(0, 200) })
    return slackBack(state.returnTo, { slackError: message.includes('SLACK_TEAM_NOT_INSTALLED') ? 'other_team' : 'link_failed' })
  }
}
