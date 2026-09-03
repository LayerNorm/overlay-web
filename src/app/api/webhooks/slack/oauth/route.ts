import { NextResponse, type NextRequest } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { enforceRateLimits, getClientIp } from '@/server/security/rate-limit'
import { getEndpointRateLimitSpecs } from '@/server/security/rate-limit-specs'
import { logger } from '@/server/observability/logger'
import { SlackInstallService, exchangeSlackCode } from '@/server/slack/SlackInstallService'
import { encryptPlatformToken } from '@/server/slack/slack-token-crypto'
import { verifyInstallState } from '@/server/slack/slack-oauth-state'

/** Slack OAuth callback (unauthenticated by design; the signed state authorizes). */
export async function GET(request: NextRequest) {
  const rateLimited = await enforceRateLimits(
    request,
    getEndpointRateLimitSpecs({
      ip: getClientIp(request),
      method: request.method,
      pathname: request.nextUrl.pathname,
      userId: 'anonymous',
    }),
  ).catch((_limitError) => null)
  if (rateLimited) return rateLimited

  const url = new URL(request.url)
  const code = url.searchParams.get('code')?.trim()
  const state = url.searchParams.get('state')?.trim()
  const clientId = process.env.SLACK_CLIENT_ID?.trim()
  const clientSecret = process.env.SLACK_CLIENT_SECRET?.trim()
  const redirectUri = process.env.SLACK_REDIRECT_URI?.trim()
  const stateSecret = process.env.INTERNAL_API_SECRET?.trim()
  const encryptionKey = process.env.SLACK_ENCRYPTION_KEY?.trim()
  if (!code || !state || !clientId || !clientSecret || !redirectUri || !stateSecret || !encryptionKey) {
    return NextResponse.json({ error: 'Slack install is not configured or the callback is incomplete' }, { status: 400 })
  }
  try {
    const claimed = verifyInstallState({ state, secret: stateSecret })
    if (claimed.directory !== 'slack') throw new Error('PLATFORM_INSTALL_STATE_INVALID')
    const server = getOverlayServerContext()
    // The installing manager's user id authorizes the link; the state
    // signature proved a manager minted it minutes ago.
    const installer = await server.workspaceService.resolvePrincipal(claimed.principalId)
    if (!installer || installer.workspaceId !== claimed.workspaceId
      || installer.type !== 'human' || !installer.userId) {
      throw new Error('PLATFORM_INSTALL_STATE_INVALID')
    }
    const service = new SlackInstallService({
      governance: server.workspaceGovernanceService,
      exchangeCode: ({ code: authCode, redirectUri: uri }) => exchangeSlackCode({
        code: authCode,
        redirectUri: uri,
        clientId,
        clientSecret,
      }),
      encryptToken: (plaintext: string) => encryptPlatformToken({ plaintext, keyBase64: encryptionKey }),
    })
    const { workspaceId } = await service.completeInstall({
      code,
      claim: claimed,
      redirectUri,
      actorUserId: installer.userId,
    })
    // 303: Slack lands the installer on the agents directory of the linked workspace.
    const redirect = new URL(`/app/w/${encodeURIComponent(workspaceId)}/agents?install=slack-ok`, url.origin)
    return NextResponse.redirect(redirect, 303)
  } catch (error) {
    logger.warn('[slack-oauth] install failed', { error })
    return NextResponse.json({ error: 'Slack install failed' }, { status: 400 })
  }
}
