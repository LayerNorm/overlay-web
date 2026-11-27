import { NextResponse, type NextRequest } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getOverlaySession } from '@/server/auth/session'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { sanitizeSlackReturnTo, sealSlackConnectState, slackAppConfig, slackLinkUrl } from '@/server/integrations/slack/slack-app'
import {
  SLACK_NO_STORE, slackBack, slackLinkRedirectUri, slackRateLimited, slackSignInRedirect,
} from '@/server/integrations/slack/slack-routes'

/**
 * Starts linking a member's Slack account with Sign in with Slack (internal/develop/slack-integration.md). Reached
 * from Settings or from the link prompt Overlay shows in Slack. The workspace must already have Slack installed.
 */
export async function GET(request: NextRequest) {
  const rateLimited = await slackRateLimited(request)
  if (rateLimited) return rateLimited
  const params = request.nextUrl.searchParams
  const returnTo = sanitizeSlackReturnTo(params.get('returnTo'))
  const session = await getOverlaySession(request)
  if (!session?.user?.id) return slackSignInRedirect(request)
  const config = slackAppConfig()
  if (!config) return slackBack(returnTo, { slackError: 'not_configured' })
  try {
    const access = await getOverlayServerContext().workspaceService.resolveActiveWorkspace(
      session.user.id, params.get('workspaceId')?.trim() || undefined,
    )
    const installation = await convex.query<{ teamId: string } | null>('integrations/slack:installationByServer', {
      serverSecret: getInternalApiSecret(), workspaceId: access.workspace.id,
    }, { throwOnError: true })
    if (!installation) return slackBack(returnTo, { slackError: 'not_installed' })
    const state = sealSlackConnectState({
      kind: 'link', userId: session.user.id, workspaceId: access.workspace.id, ...(returnTo ? { returnTo } : {}),
    })
    return NextResponse.redirect(slackLinkUrl(config, state, slackLinkRedirectUri(), installation.teamId), { headers: SLACK_NO_STORE })
  } catch (_error) {
    return slackBack(returnTo, { slackError: 'workspace' })
  }
}
