import type { NextRequest } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getOverlaySession } from '@/server/auth/session'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { getClientIp } from '@/server/security/rate-limit'
import { logger } from '@/server/observability/logger'
import { assertSingleWorkspaceInstall, openSlackConnectState, slackAppConfig, slackInstallErrorCode } from '@/server/integrations/slack/slack-app'
import { getSlackAdapter } from '@/server/integrations/slack/slack-bot'
import { slackBack, slackInstallRedirectUri, slackRateLimited } from '@/server/integrations/slack/slack-routes'

/**
 * Slack returns here after an install (internal/develop/slack-integration.md). The sealed state must belong to the
 * signed-in person; the Slack adapter exchanges the code and stores the encrypted bot token, and Convex binds the
 * Slack workspace to the Overlay workspace only for an owner or admin, and only when neither is bound elsewhere.
 */
export async function GET(request: NextRequest) {
  const rateLimited = await slackRateLimited(request)
  if (rateLimited) return rateLimited
  const params = request.nextUrl.searchParams
  const state = openSlackConnectState(params.get('state'))
  if (!state || state.kind !== 'install') return slackBack(undefined, { slackError: 'expired' })
  const session = await getOverlaySession(request)
  if (session?.user?.id !== state.userId) return slackBack(state.returnTo, { slackError: 'signed_in_as_someone_else' })
  if (!params.get('code')) return slackBack(state.returnTo, { slackError: params.get('error') === 'access_denied' ? 'cancelled' : 'install_failed' })
  if (!slackAppConfig()) return slackBack(state.returnTo, { slackError: 'not_configured' })
  const adapter = await getSlackAdapter()
  let teamId: string | undefined
  try {
    const result = await adapter.handleOAuthCallback(request, { redirectUri: slackInstallRedirectUri() })
    teamId = result.teamId
    assertSingleWorkspaceInstall(result)
    await convex.mutation('integrations/slack:installByServer', {
      serverSecret: getInternalApiSecret(), workspaceId: state.workspaceId, teamId,
      teamName: result.installation.teamName ?? teamId, installedByUserId: state.userId,
      ...(result.enterpriseId ? { enterpriseId: result.enterpriseId } : {}),
      ...(result.installation.botUserId ? { botUserId: result.installation.botUserId } : {}),
    }, { throwOnError: true })
  } catch (error) {
    const code = slackInstallErrorCode(error)
    logger.warn('[slack] install callback failed', { reason: code === 'install_failed' ? (error instanceof Error ? error.message : String(error)).slice(0, 200) : code })
    if (teamId) {
      await convex.mutation('integrations/slack:discardUnboundTokenByServer', {
        serverSecret: getInternalApiSecret(), teamId,
      }).catch((_error: unknown) => undefined)
    }
    return slackBack(state.returnTo, { slackError: code })
  }
  await getOverlayServerContext().auditService.record({
    action: 'integration.slack.installed',
    actorType: 'user',
    actorUserId: state.userId,
    ipAddress: getClientIp(request),
    metadata: { teamId },
    outcome: 'success',
    resourceId: state.workspaceId,
    resourceType: 'workspace',
  }).catch((error) => {
    logger.warn('[slack] install audit write failed', { reason: error instanceof Error ? error.message : 'unknown' })
  })
  return slackBack(state.returnTo, { slack: 'installed' })
}
