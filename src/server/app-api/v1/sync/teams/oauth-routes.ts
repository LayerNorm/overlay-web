import 'server-only'

import { after, NextResponse, type NextRequest } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getOverlaySession } from '@/server/auth/session'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { logger } from '@/server/observability/logger'
import { enforceRateLimits, getClientIp } from '@/server/security/rate-limit'
import { getEndpointRateLimitSpecs } from '@/server/security/rate-limit-specs'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { sanitizeReturnTo } from '@/server/surfaces/slack-oauth'
import { graphAppToken, graphRequest, microsoftSyncCredentials, microsoftTokenRequest, teamsSyncConfigured } from '@/server/sync/teams/graph'
import { runTeamsMaintenance } from '@/server/sync/teams/inbound'
import {
  idTokenClaims,
  openTeamsState,
  sealTeamsState,
  TEAMS_SETTINGS_PATH,
  teamsAdminConsentUrl,
  teamsMemberAuthorizeUrl,
  teamsRedirectUri,
  type TeamsOAuthState,
} from '@/server/sync/teams/oauth'
import { sealSyncToken } from '@/server/sync/token-seal'
import { getBaseUrl } from '@/server/web/app-url'

/**
 * Browser legs of Teams sync: an owner or admin granting admin consent for
 * their tenant, and a member signing in to reply as themselves. Like the Slack
 * connect routes these bypass handleBffRoute because they must end in
 * redirects; the Overlay session authenticates, and the signed state carries
 * the intent through Microsoft and is bound to the same user on return.
 */
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const
const options = { throwOnError: true } as const

function settingsUrl(returnTo: string | undefined, params: Record<string, string>): string {
  const url = new URL(returnTo ?? TEAMS_SETTINGS_PATH, getBaseUrl())
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}

function redirect(url: string) {
  return NextResponse.redirect(url, { headers: NO_STORE })
}

async function rateLimited(request: NextRequest) {
  return await enforceRateLimits(request, getEndpointRateLimitSpecs({
    ip: getClientIp(request), method: request.method, pathname: request.nextUrl.pathname, userId: 'anonymous',
  })).catch((_error) => null)
}

async function start(request: NextRequest, purpose: TeamsOAuthState['purpose']) {
  const limited = await rateLimited(request)
  if (limited) return limited
  const params = request.nextUrl.searchParams
  const returnTo = sanitizeReturnTo(params.get('returnTo'))
  const session = await getOverlaySession(request)
  if (!session?.user?.id) {
    const signIn = new URL('/auth/sign-in', getBaseUrl())
    signIn.searchParams.set('redirect', request.nextUrl.pathname + request.nextUrl.search)
    return redirect(signIn.toString())
  }
  if (!teamsSyncConfigured()) return redirect(settingsUrl(returnTo, { syncError: 'teams_not_configured' }))
  try {
    const access = await getOverlayServerContext().workspaceService.resolveActiveWorkspace(session.user.id, params.get('workspaceId')?.trim() || undefined)
    const state = sealTeamsState({ purpose, workspaceId: access.workspace.id, userId: session.user.id, ...(returnTo ? { returnTo } : {}) })
    const { clientId } = microsoftSyncCredentials()
    const redirectUri = teamsRedirectUri(getBaseUrl(), purpose)
    if (purpose === 'connect') {
      if (access.membership.role !== 'owner' && access.membership.role !== 'admin') return redirect(settingsUrl(returnTo, { syncError: 'forbidden' }))
      return redirect(teamsAdminConsentUrl({ clientId, redirectUri, state }))
    }
    const connection = await convex.query<{ externalOrgId: string; status: string } | null>('sync/links:getConnection', {
      serverSecret: getInternalApiSecret(), workspaceId: access.workspace.id, provider: 'teams',
    }, options)
    if (!connection || connection.status !== 'connected') return redirect(settingsUrl(returnTo, { syncError: 'teams_not_connected' }))
    return redirect(teamsMemberAuthorizeUrl({ clientId, tenantId: connection.externalOrgId, redirectUri, state }))
  } catch (error) {
    logger.error('[sync/teams] ' + purpose + ' start failed', error)
    return redirect(settingsUrl(returnTo, { syncError: 'connect_failed' }))
  }
}

/** GET /api/v1/sync/teams/connect — sends an owner or admin to Microsoft's admin consent page for their tenant. */
export async function startTeamsConnect(request: NextRequest) {
  return await start(request, 'connect')
}

/** GET /api/v1/sync/teams/account/connect — sends a member to Microsoft sign-in to grant ChannelMessage.Send. */
export async function startTeamsAccountConnect(request: NextRequest) {
  return await start(request, 'account')
}

async function auditSyncConnect(request: NextRequest, state: TeamsOAuthState, action: string, metadata: Record<string, string>) {
  await getOverlayServerContext().auditService.record({
    action,
    actorType: 'user',
    actorUserId: state.userId,
    ipAddress: getClientIp(request),
    metadata,
    outcome: 'success',
    resourceId: state.workspaceId,
    resourceType: 'workspace',
  }).catch((error) => {
    logger.warn('[sync/teams] audit write failed', { reason: error instanceof Error ? error.message : 'unknown' })
  })
}

async function finish(request: NextRequest, purpose: TeamsOAuthState['purpose']) {
  const limited = await rateLimited(request)
  if (limited) return limited
  const params = request.nextUrl.searchParams
  const state = openTeamsState(params.get('state'), purpose)
  const fail = (reason: string) => redirect(settingsUrl(state?.returnTo, { syncError: reason }))
  if (!state) return fail('expired_state')
  if (params.get('error')) return fail('denied')
  if (!teamsSyncConfigured()) return fail('teams_not_configured')
  const session = await getOverlaySession(request)
  if (!session?.user?.id || session.user.id !== state.userId) {
    logger.warn('[sync/teams] callback rejected: session binding mismatch')
    return fail('account_mismatch')
  }
  return { state, fail }
}

/**
 * GET /api/v1/sync/teams/callback — Microsoft returns here after admin
 * consent with the tenant id. Records the tenant as the workspace's Teams
 * connection, then resubscribes any links the reconnect resumed.
 */
export async function finishTeamsConnect(request: NextRequest) {
  const finished = await finish(request, 'connect')
  if (finished instanceof Response) return finished
  const { state, fail } = finished
  const params = request.nextUrl.searchParams
  const tenantId = params.get('tenant')?.trim()
  if (params.get('admin_consent')?.toLowerCase() !== 'true' || !tenantId) return fail('denied')
  try {
    const access = await getOverlayServerContext().workspaceService.resolveActiveWorkspace(state.userId, state.workspaceId)
    if (access.membership.role !== 'owner' && access.membership.role !== 'admin') return fail('forbidden')
    // The tenant id arrives in the redirect URL, so it is only trusted once
    // Microsoft issues an app token for it, which requires consent in that tenant.
    const appToken = await graphAppToken(tenantId).catch((_error) => null)
    if (!appToken) return fail('consent_missing')
    const organization = await graphRequest<{ value?: Array<{ displayName?: string }> }>(appToken, '/organization?$select=displayName')
      .catch((_error) => null)
    const externalOrgName = organization?.value?.[0]?.displayName
    await convex.mutation('sync/links:connect', {
      serverSecret: getInternalApiSecret(), actorUserId: state.userId, workspaceId: state.workspaceId,
      provider: 'teams', externalOrgId: tenantId, ...(externalOrgName ? { externalOrgName } : {}),
    }, options)
    await auditSyncConnect(request, state, 'sync.teams.connected', { tenantId })
    after(async () => { await runTeamsMaintenance().catch((error) => logger.warn('[sync/teams] post-connect maintenance failed', { error: String(error) })) })
    return redirect(settingsUrl(state.returnTo, { syncConnected: 'teams' }))
  } catch (error) {
    if (error instanceof Error && error.message.includes('SYNC_ORG_CONNECTED_ELSEWHERE')) return fail('team_already_connected')
    if (error instanceof Error && error.message.includes('SYNC_ALREADY_CONNECTED')) return fail('already_connected')
    logger.error('[sync/teams] admin consent callback failed', error)
    return fail('connect_failed')
  }
}

/**
 * GET /api/v1/sync/teams/account/callback — exchanges the member's code,
 * checks they signed in to the workspace's connected tenant, and stores their
 * sealed access and refresh tokens. Tokens never reach the browser.
 */
export async function finishTeamsAccountConnect(request: NextRequest) {
  const finished = await finish(request, 'account')
  if (finished instanceof Response) return finished
  const { state, fail } = finished
  const code = request.nextUrl.searchParams.get('code')?.trim()
  if (!code) return fail('missing_code')
  try {
    const serverSecret = getInternalApiSecret()
    const connection = await convex.query<{ externalOrgId: string; status: string } | null>('sync/links:getConnection', {
      serverSecret, workspaceId: state.workspaceId, provider: 'teams',
    }, options)
    if (!connection || connection.status !== 'connected') return fail('teams_not_connected')
    const { clientId, clientSecret } = microsoftSyncCredentials()
    const tokens = await microsoftTokenRequest(connection.externalOrgId, {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: teamsRedirectUri(getBaseUrl(), 'account'),
    })
    if (typeof tokens.access_token !== 'string') return fail('exchange_failed')
    const claims = idTokenClaims(tokens.id_token)
    if (claims.tid !== connection.externalOrgId) return fail('wrong_organization')
    const me = await graphRequest<{ id: string; displayName?: string }>(tokens.access_token, '/me?$select=id,displayName')
    await convex.mutation('sync/teamsAccounts:connectAccount', {
      serverSecret,
      workspaceId: state.workspaceId,
      userId: state.userId,
      externalOrgId: connection.externalOrgId,
      externalUserId: me.id,
      ...(me.displayName ? { externalDisplayName: me.displayName } : {}),
      sealedToken: sealSyncToken(tokens.access_token),
      ...(typeof tokens.refresh_token === 'string' ? { sealedRefreshToken: sealSyncToken(tokens.refresh_token) } : {}),
      tokenExpiresAt: Date.now() + Number(tokens.expires_in ?? 3600) * 1000,
      scopes: typeof tokens.scope === 'string' ? tokens.scope.split(' ').filter(Boolean) : [],
    }, options)
    await auditSyncConnect(request, state, 'sync.teams.account_connected', { tenantId: connection.externalOrgId })
    return redirect(settingsUrl(state.returnTo, { syncAccountConnected: 'teams' }))
  } catch (error) {
    if (error instanceof Error && error.message.includes('SYNC_ACCOUNT_CLAIMED')) return fail('account_claimed')
    if (error instanceof Error && error.message.includes('SYNC_ACCOUNT_WRONG_ORG')) return fail('wrong_organization')
    logger.error('[sync/teams] account callback failed', error)
    return fail('exchange_failed')
  }
}
