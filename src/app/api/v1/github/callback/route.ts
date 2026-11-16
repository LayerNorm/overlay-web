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
  openGitHubConnectState, userInstallations, type GitHubConnectState, type UserInstallation,
} from '@/server/integrations/github/github-app'

/**
 * GitHub returns here after the person signs in (internal/develop/thread-folders.md). Every installation of the app
 * that their GitHub account can access is connected to the workspace that started connecting. Only installations
 * GitHub lists for that account are saved, so nobody can connect someone else's repositories. With none, the person
 * is asked to install the app first.
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
  const code = params.get('code')
  if (!code) return back(state.returnTo, { githubError: params.get('error') === 'access_denied' ? 'cancelled' : 'connect_failed' })
  try {
    const installations = await userInstallations(code, `${getBaseUrl()}/api/v1/github/callback`)
    if (installations.length === 0) return back(state.returnTo, { githubError: 'not_installed' })
    for (const installation of installations) await connectInstallation(request, state, installation)
    return back(state.returnTo, { github: 'connected' })
  } catch (error) {
    logger.warn('[github] connect callback failed', { error: error instanceof Error ? error.message : String(error) })
    return back(state.returnTo, { githubError: 'connect_failed' })
  }
}

async function connectInstallation(request: NextRequest, state: GitHubConnectState, installation: UserInstallation) {
  await convex.mutation('integrations/githubInstallations:addByServer', {
    serverSecret: getInternalApiSecret(), workspaceId: state.workspaceId, installationId: installation.id,
    accountLogin: installation.account.login, accountType: installation.account.type,
    connectedByUserId: state.userId,
    ...(installation.repositorySelection ? { repositorySelection: installation.repositorySelection } : {}),
  }, { throwOnError: true })
  await getOverlayServerContext().auditService.record({
    action: 'integration.github.connected',
    actorType: 'user',
    actorUserId: state.userId,
    ipAddress: getClientIp(request),
    metadata: { installationId: installation.id, account: installation.account.login },
    outcome: 'success',
    resourceId: state.workspaceId,
    resourceType: 'workspace',
  }).catch((error) => {
    logger.warn('[github] connect audit write failed', { reason: error instanceof Error ? error.message : 'unknown' })
  })
}
