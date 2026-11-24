import { NextResponse, type NextRequest } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getOverlaySession } from '@/server/auth/session'
import { sanitizeSlackReturnTo, sealSlackConnectState, slackAppConfig, slackInstallUrl } from '@/server/integrations/slack/slack-app'
import {
  SLACK_NO_STORE, slackBack, slackInstallRedirectUri, slackRateLimited, slackSignInRedirect,
} from '@/server/integrations/slack/slack-routes'

/**
 * Starts adding Overlay to a Slack workspace (internal/develop/slack-integration.md). A browser navigation that ends
 * in a redirect to Slack's install page; the sealed state carries the person and workspace through Slack and back.
 * Only owners and admins can finish the install, which the callback enforces.
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
    const state = sealSlackConnectState({
      kind: 'install', userId: session.user.id, workspaceId: access.workspace.id, ...(returnTo ? { returnTo } : {}),
    })
    return NextResponse.redirect(slackInstallUrl(config, state, slackInstallRedirectUri()), { headers: SLACK_NO_STORE })
  } catch (_error) {
    return slackBack(returnTo, { slackError: 'workspace' })
  }
}
