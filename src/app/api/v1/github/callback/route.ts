import { NextResponse, type NextRequest } from 'next/server'
import { getOverlaySession } from '@/server/auth/session'
import { enforceRateLimits, getClientIp } from '@/server/security/rate-limit'
import { getEndpointRateLimitSpecs } from '@/server/security/rate-limit-specs'
import { getBaseUrl } from '@/server/web/app-url'
import { getOverlayServerContext } from '@/server/bootstrap'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { logger } from '@/server/observability/logger'
import {
  getInstallation, openGitHubConnectState, userCanSeeInstallation,
} from '@/server/integrations/github/github-app'

/**
 * GitHub returns here after the app is installed (internal/develop/thread-folders.md). The installation is saved
 * only when the signed-in person started the install and GitHub confirms they can see that installation, so a
 * forged installation id can't connect someone else's repositories.
 */
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const

function back(returnTo: string | undefined, params: Record<string, string>): NextResponse {
  const url = new URL(returnTo ?? '/app/agents', getBaseUrl())
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return NextResponse.redirect(url.toString(), { headers: NO_STORE })
}

export async function GET(request: NextRequest) {
  const rateLimited = await enforceRateLimits(request, getEndpointRateLimitSpecs({
    ip: getClientIp(request), method: request.method, pathname: request.nextUrl.pathname, userId: 'anonymous',
  })).catch((_error) => null)
  if (rateLimited) return rateLimited
  const params = request.nextUrl.searchParams
  const state = openGitHubConnectState(params.get('state'))
  if (!state) return back(undefined, { githubError: 'expired' })
  const session = await getOverlaySession(request)
  if (session?.user?.id !== state.userId) return back(state.returnTo, { githubError: 'signed_in_as_someone_else' })
  if (params.get('setup_action') === 'request') return back(state.returnTo, { githubError: 'awaiting_org_approval' })
  const installationId = Number(params.get('installation_id'))
  const code = params.get('code')
  if (!Number.isSafeInteger(installationId) || installationId <= 0 || !code) return back(state.returnTo, { githubError: 'missing_installation' })
  try {
    if (!await userCanSeeInstallation(code, installationId)) return back(state.returnTo, { githubError: 'not_yours' })
    const installation = await getInstallation(installationId)
    await convex.mutation('integrations/githubInstallations:addByServer', {
      serverSecret: getInternalApiSecret(), workspaceId: state.workspaceId, installationId,
      accountLogin: installation.account.login, accountType: installation.account.type,
      connectedByUserId: state.userId,
      ...(installation.repository_selection ? { repositorySelection: installation.repository_selection } : {}),
    }, { throwOnError: true })
    await getOverlayServerContext().auditService.record({
      action: 'integration.github.connected',
      actorType: 'user',
      actorUserId: state.userId,
      ipAddress: getClientIp(request),
      metadata: { installationId, account: installation.account.login },
      outcome: 'success',
      resourceId: state.workspaceId,
      resourceType: 'workspace',
    }).catch((error) => {
      logger.warn('[github] connect audit write failed', { reason: error instanceof Error ? error.message : 'unknown' })
    })
    return back(state.returnTo, { github: 'connected' })
  } catch (error) {
    logger.warn('[github] connect callback failed', { error: error instanceof Error ? error.message : String(error) })
    return back(state.returnTo, { githubError: 'connect_failed' })
  }
}
