import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'
import { enforceRateLimits, getClientIp } from '@/server/security/rate-limit'
import { getEndpointRateLimitSpecs } from '@/server/security/rate-limit-specs'
import { getBaseUrl } from '@/server/web/app-url'

/** Shared plumbing for the Slack browser flows: they end in redirects back to Settings, never JSON. */

export const SLACK_NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const
export const SLACK_SETTINGS_PATH = '/app/settings?section=connected-apps&app=slack'

export function slackBack(returnTo: string | undefined, params: Record<string, string>): NextResponse {
  const url = new URL(returnTo ?? SLACK_SETTINGS_PATH, getBaseUrl())
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return NextResponse.redirect(url.toString(), { headers: SLACK_NO_STORE })
}

export function slackSignInRedirect(request: NextRequest): NextResponse {
  const signIn = new URL('/auth/sign-in', getBaseUrl())
  signIn.searchParams.set('redirect', request.nextUrl.pathname + request.nextUrl.search)
  return NextResponse.redirect(signIn.toString(), { headers: SLACK_NO_STORE })
}

export async function slackRateLimited(request: NextRequest): Promise<Response | null> {
  return await enforceRateLimits(request, getEndpointRateLimitSpecs({
    ip: getClientIp(request), method: request.method, pathname: request.nextUrl.pathname, userId: 'anonymous',
  })).catch((_error) => null)
}

export const slackInstallRedirectUri = () => getBaseUrl() + '/api/v1/integrations/slack/oauth'
export const slackLinkRedirectUri = () => getBaseUrl() + '/api/v1/integrations/slack/link/callback'
