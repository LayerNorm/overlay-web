import { NextResponse, type NextRequest } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getOverlaySession } from '@/server/auth/session'
import { enforceRateLimits, getClientIp } from '@/server/security/rate-limit'
import { getEndpointRateLimitSpecs } from '@/server/security/rate-limit-specs'
import { getBaseUrl } from '@/server/web/app-url'
import { sanitizeReturnTo } from '@/server/surfaces/slack-oauth'
import { authorizeUrl, githubAppConfigured, installPageUrl, sealGitHubConnectState } from '@/server/integrations/github/github-app'

/**
 * Starts connecting GitHub (internal/develop/thread-folders.md): GitHub asks the person to sign in and returns to this
 * deployment's callback, which connects the app installations they can see. `?install=1` instead opens the app's
 * install page. A browser navigation, so it ends in a redirect rather than JSON. The sealed state carries the person
 * and workspace through GitHub and back.
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
  const returnTo = sanitizeReturnTo(params.get('returnTo'))
  const session = await getOverlaySession(request)
  if (!session?.user?.id) {
    const signIn = new URL('/auth/sign-in', getBaseUrl())
    signIn.searchParams.set('redirect', `${request.nextUrl.pathname}${request.nextUrl.search}`)
    return NextResponse.redirect(signIn.toString(), { headers: NO_STORE })
  }
  if (!githubAppConfigured()) return back(returnTo, { githubError: 'not_configured' })
  if (params.get('install') === '1') return NextResponse.redirect(installPageUrl(), { headers: NO_STORE })
  try {
    const access = await getOverlayServerContext().workspaceService.resolveActiveWorkspace(
      session.user.id, params.get('workspaceId')?.trim() || undefined,
    )
    const state = sealGitHubConnectState({ userId: session.user.id, workspaceId: access.workspace.id, ...(returnTo ? { returnTo } : {}) })
    return NextResponse.redirect(authorizeUrl(state, `${getBaseUrl()}/api/v1/github/callback`), { headers: NO_STORE })
  } catch (_error) {
    return back(returnTo, { githubError: 'workspace' })
  }
}
